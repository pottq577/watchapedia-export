"use strict";

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function extractGenresFromJsonLd(doc, title) {
  const objects = [];
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.textContent ?? "null");
      const add = (value) => {
        if (!value) return;
        if (Array.isArray(value)) {
          value.forEach(add);
          return;
        }
        if (typeof value !== "object") return;
        objects.push(value);
        if (Array.isArray(value["@graph"])) value["@graph"].forEach(add);
      };
      add(parsed);
    } catch {
      // 관련 없는 JSON-LD 블록은 무시합니다.
    }
  }

  const normalizedTitle = normalizeText(title);
  const contentObject =
    objects.find(
      (object) =>
        normalizeText(object?.name) === normalizedTitle &&
        object?.["@type"] !== "Organization" &&
        object?.genre,
    ) ??
    objects.find(
      (object) => object?.["@type"] !== "Organization" && object?.genre,
    );

  const genre = contentObject?.genre;
  if (Array.isArray(genre)) return genre.map(normalizeText).filter(Boolean);
  return genre ? [normalizeText(genre)].filter(Boolean) : [];
}

function looksLikeCountry(value) {
  if (!value || value.length > 50) return false;
  return !/시간|분|관람|청불|개봉|예매|방영|에피소드|평균|평가/.test(value);
}

function extractCountryFromRenderedHtml(doc, row, genres) {
  const year = String(row.year ?? "").slice(0, 4);
  const candidates = [...doc.querySelectorAll("div, span, p")]
    .map((element) => ({ element, text: normalizeText(element.textContent) }))
    .filter(({ text }) => text && text.length <= 140 && text.includes("·"))
    .filter(({ text }) => !year || text.startsWith(year));

  let metadata = null;
  if (genres.length) {
    metadata = candidates.find(({ text }) =>
      genres.some((genre) => text.includes(genre)),
    );
  }
  metadata ??= candidates[0] ?? null;
  if (!metadata) return [];

  const parts = metadata.text
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
  const genreIndex = genres.length
    ? parts.findIndex((part) => genres.some((genre) => part.includes(genre)))
    : -1;

  if (genreIndex >= 0) {
    const inlineCountry = parts[genreIndex + 1];
    if (looksLikeCountry(inlineCountry)) {
      return inlineCountry.split(/[\/,]/).map((value) => value.trim()).filter(Boolean);
    }
  }

  let sibling = metadata.element.nextElementSibling;
  for (let index = 0; sibling && index < 3; index += 1, sibling = sibling.nextElementSibling) {
    const candidate = normalizeText(sibling.textContent);
    if (!candidate || candidate.includes("·")) continue;
    if (looksLikeCountry(candidate)) {
      return candidate.split(/[\/,]/).map((value) => value.trim()).filter(Boolean);
    }
  }
  return [];
}

function parseDetailMetadata(html, row, env = globalThis) {
  const Parser = env.DOMParser;
  if (!Parser) throw new Error("DOMParser를 사용할 수 없습니다.");
  const doc = new Parser().parseFromString(html, "text/html");
  const genres = extractGenresFromJsonLd(doc, row.title);
  const countries = extractCountryFromRenderedHtml(doc, row, genres);
  return {
    genres: [...new Set(genres)].join("|"),
    countries: [...new Set(countries)].join("|"),
  };
}

async function enrichRows({
  rows,
  client,
  storage,
  progressByCode = new Map(),
  ui,
  persistProgress = true,
  parseMetadata = parseDetailMetadata,
  logger = console,
}) {
  const targets = rows.filter((row) => {
    if (row.genres && row.countries) return false;
    return progressByCode.get(row.content_code)?.status !== "complete";
  });
  const failedRows = [];
  let completed = 0;
  let metadataWarnings = 0;

  for (let index = 0; index < targets.length; index += 1) {
    const row = targets[index];
    ui.setStatus(
      `상세 정보 수집 중 · ${index + 1}/${targets.length} · ${row.title}`,
    );
    try {
      const html = await client.requestHtml(row.content_code);
      const metadata = parseMetadata(html, row);
      Object.assign(row, metadata);
      if (!row.genres || !row.countries) metadataWarnings += 1;
      if (persistProgress) await storage.saveProgress(row, "complete");
      completed += 1;
    } catch (error) {
      failedRows.push({ content_code: row.content_code, title: row.title, error });
      if (persistProgress) {
        await storage.saveProgress(
          row,
          "failed",
          error instanceof Error ? error.message : String(error),
        );
      }
      logger.error(`[WatchaPedia Exporter] detail failed: ${row.title}`, error);
    }
  }

  return {
    attempted: targets.length,
    completed,
    metadataWarnings,
    failedRows,
  };
}

module.exports = {
  normalizeText,
  looksLikeCountry,
  parseDetailMetadata,
  enrichRows,
};
