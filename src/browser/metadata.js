"use strict";

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function collectJsonLdObjects(doc) {
  const objects = [];
  for (const script of doc.querySelectorAll(
    'script[type="application/ld+json"]',
  )) {
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
  return objects;
}

function selectContentObject(objects, title) {
  const normalizedTitle = normalizeText(title);
  const isContentObject = (object) =>
    object?.["@type"] !== "Organization" &&
    (object?.genre ||
      object?.countryOfOrigin ||
      object?.productionCountry ||
      object?.countries ||
      object?.country ||
      object?.nations ||
      object?.nation);
  return (
    objects.find(
      (object) =>
        normalizeText(object?.name) === normalizedTitle &&
        isContentObject(object),
    ) ??
    objects.find(isContentObject) ??
    null
  );
}

function extractGenresFromJsonLd(contentObject) {
  const genre = contentObject?.genre;
  if (Array.isArray(genre)) return genre.map(normalizeText).filter(Boolean);
  return genre ? [normalizeText(genre)].filter(Boolean) : [];
}

function splitCountryValues(value) {
  if (Array.isArray(value)) return value.flatMap(splitCountryValues);
  if (value && typeof value === "object") {
    return splitCountryValues(
      value.name ?? value.addressCountry ?? value.value ?? "",
    );
  }
  return normalizeText(value)
    .split(/[\/,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractCountriesFromJsonLd(contentObject) {
  if (!contentObject) return [];
  const keys = [
    "countryOfOrigin",
    "productionCountry",
    "countries",
    "country",
    "nations",
    "nation",
  ];
  return keys.flatMap((key) => splitCountryValues(contentObject[key]));
}

function looksLikeCountry(value) {
  if (!value || value.length > 50) return false;
  return !/시간|분|관람|청불|개봉|예매|방영|에피소드|평균|평가|시즌/.test(
    value,
  );
}

function extractCountryFromMetadataText(text, row, genres) {
  const normalized = normalizeText(text);
  if (!normalized.includes("·")) return [];

  const year = String(row.year ?? "").slice(0, 4);
  const parts = normalized
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
  const yearIndex = year
    ? parts.findIndex((part) => part === year || part.startsWith(`${year} `))
    : 0;
  if (year && yearIndex < 0) return [];

  const genreTokens = genres.flatMap((genre) =>
    normalizeText(genre)
      .split(/[\/,]/)
      .map((value) => value.trim())
      .filter(Boolean),
  );

  const trailingParts = parts.slice(yearIndex + 1);
  if (!genreTokens.length) {
    for (let index = trailingParts.length - 1; index >= 0; index -= 1) {
      if (looksLikeCountry(trailingParts[index])) {
        return splitCountryValues(trailingParts[index]);
      }
    }
    return [];
  }

  for (const part of trailingParts) {
    const tokens = part
      .split(/[\/,]/)
      .map((value) => value.trim())
      .filter(Boolean);
    const isGenrePart =
      tokens.length > 0 && tokens.every((token) => genreTokens.includes(token));
    if (isGenrePart || !looksLikeCountry(part)) continue;
    return splitCountryValues(part);
  }
  return [];
}

function extractCountryFromRenderedHtml(doc, row, genres) {
  const year = String(row.year ?? "").slice(0, 4);
  const candidates = [...doc.querySelectorAll("div, span, p, li, a")]
    .map((element) => ({ element, text: normalizeText(element.textContent) }))
    .filter(({ text }) => text && text.length <= 180 && text.includes("·"))
    .filter(({ text }) => !year || text.includes(year))
    .filter(
      ({ text }) =>
        !genres.length || genres.some((genre) => text.includes(genre)),
    )
    .sort((a, b) => a.text.length - b.text.length);

  for (const candidate of candidates) {
    const countries = extractCountryFromMetadataText(
      candidate.text,
      row,
      genres,
    );
    if (countries.length) return countries;
  }

  const metadata = candidates[0] ?? null;
  if (!metadata) return [];
  let sibling = metadata.element.nextElementSibling;
  for (
    let index = 0;
    sibling && index < 3;
    index += 1, sibling = sibling.nextElementSibling
  ) {
    const candidate = normalizeText(sibling.textContent);
    if (!candidate || candidate.includes("·")) continue;
    if (looksLikeCountry(candidate)) return splitCountryValues(candidate);
  }
  return [];
}

function parseDetailMetadata(html, row, env = globalThis) {
  const Parser = env.DOMParser;
  if (!Parser) throw new Error("DOMParser를 사용할 수 없습니다.");
  const doc = new Parser().parseFromString(html, "text/html");
  const contentObject = selectContentObject(
    collectJsonLdObjects(doc),
    row.title,
  );
  const genres = extractGenresFromJsonLd(contentObject);
  const countries = [
    ...extractCountriesFromJsonLd(contentObject),
    ...extractCountryFromRenderedHtml(doc, row, genres),
  ];
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
      const complete = Boolean(row.genres && row.countries);
      if (!complete) metadataWarnings += 1;
      if (persistProgress) {
        await storage.saveProgress(row, complete ? "complete" : "partial");
      }
      completed += 1;
    } catch (error) {
      failedRows.push({
        content_code: row.content_code,
        title: row.title,
        error,
      });
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
  extractCountriesFromJsonLd,
  extractCountryFromMetadataText,
  parseDetailMetadata,
  enrichRows,
};
