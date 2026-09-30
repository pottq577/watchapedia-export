// ==UserScript==
// @name         WatchaPedia Ratings Exporter
// @namespace    watchapedia-ratings-exporter
// @version      0.1.0
// @description  왓챠피디아 영화·시리즈 평가를 CSV로 백업하고 기존 백업을 증분 갱신합니다.
// @match        https://pedia.watcha.com/ko/*
// @license      MIT
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const CONFIG = {
    API_DELAY_MS: 300,
    DETAIL_DELAY_MS: 800,
    RETRY_LIMIT: 5,
    CSV_COLUMNS: [
      "type",
      "title",
      "year",
      "rating",
      "genres",
      "countries",
      "content_code",
    ],
  };

  const state = {
    running: false,
    deviceId: "",
    headers: null,
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function getCookie(name) {
    return (
      document.cookie
        .split("; ")
        .find((value) => value.startsWith(`${name}=`))
        ?.split("=")
        .slice(1)
        .join("=") ?? ""
    );
  }

  function getDeviceId() {
    const cookieValue = getCookie("_c_pdi");
    if (cookieValue) {
      return decodeURIComponent(cookieValue);
    }

    return (
      window.__INITIAL_DATA__?.headers?.["x-frograms-device-identifier"] ?? ""
    );
  }

  function createApiHeaders(deviceId) {
    return {
      accept: "application/vnd.frograms+json;version=2.1.0",
      "x-frograms-app-code": "Galaxy",
      "x-frograms-client": "Galaxy-Web-App",
      "x-frograms-client-version": "2.1.0",
      "x-frograms-version": "2.1.0",
      "x-frograms-device-identifier": deviceId,
      "x-frograms-galaxy-language": "ko",
      "x-frograms-galaxy-region": "KR",
    };
  }

  async function requestJson(url, attempt = 0) {
    await sleep(CONFIG.API_DELAY_MS);

    const response = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
      headers: state.headers,
    });

    if (response.ok) {
      return response.json();
    }

    if (
      (response.status === 429 || response.status >= 500) &&
      attempt < CONFIG.RETRY_LIMIT
    ) {
      const delay = 2_000 * 2 ** attempt;
      setStatus(
        `요청 제한/서버 오류 (${response.status}). 잠시 후 재시도합니다.`,
      );
      await sleep(delay);
      return requestJson(url, attempt + 1);
    }

    const body = await response.text();
    console.error("WatchaPedia API request failed", {
      status: response.status,
      url,
      body,
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "왓챠피디아 로그인 상태를 확인한 뒤 페이지를 새로고침해 주세요.",
      );
    }

    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }

  async function requestHtml(contentCode, attempt = 0) {
    await sleep(CONFIG.DETAIL_DELAY_MS);

    const url = `/ko/contents/${encodeURIComponent(contentCode)}`;
    const response = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
      headers: {
        accept: "text/html,application/xhtml+xml",
      },
    });

    if (response.ok) {
      return response.text();
    }

    if (
      (response.status === 429 || response.status >= 500) &&
      attempt < CONFIG.RETRY_LIMIT
    ) {
      const delay = 3_000 * 2 ** attempt;
      setStatus(
        `상세 정보 요청 실패 (${response.status}). 잠시 후 재시도합니다.`,
      );
      await sleep(delay);
      return requestHtml(contentCode, attempt + 1);
    }

    throw new Error(
      `상세 페이지 요청 실패 (${response.status}): ${contentCode}`,
    );
  }

  async function getCurrentUserCode() {
    try {
      const json = await requestJson("/api/users/me");
      const code = json?.result?.code ?? json?.code ?? "";
      if (code) {
        return code;
      }
    } catch (error) {
      console.warn("/api/users/me lookup failed, trying page fallback", error);
    }

    const profileLink = [...document.querySelectorAll('a[href*="/ko/users/"]')]
      .map((anchor) => anchor.getAttribute("href") ?? "")
      .find((href) => /^\/ko\/users\/[^/?#]+$/.test(href));

    const match = profileLink?.match(/^\/ko\/users\/([^/?#]+)$/);
    if (match?.[1]) {
      return match[1];
    }

    throw new Error(
      "현재 로그인 사용자의 WatchaPedia 사용자 코드를 찾지 못했습니다.",
    );
  }

  function parseRatingsPage(json) {
    if (Array.isArray(json?.result?.result)) {
      return {
        items: json.result.result,
        next: json.result.next_uri ?? json.result.nextUri ?? null,
      };
    }

    if (Array.isArray(json?.result)) {
      return {
        items: json.result,
        next: json.next_uri ?? json.nextUri ?? null,
      };
    }

    console.error("Unknown ratings response", json);
    throw new Error("평가 목록 API 응답 구조를 인식하지 못했습니다.");
  }

  function normalizeRating(item, type) {
    const action = item.user_content_action ?? item.userContentAction ?? {};
    const content = item.content ?? {};
    const rawRating = action.rating ?? item.rating ?? null;

    const contentCode =
      content.code ??
      action.content_code ??
      action.contentCode ??
      item.content_code ??
      item.contentCode ??
      "";

    if (!contentCode) {
      throw new Error(
        `content_code가 없는 평가 항목을 발견했습니다: ${content.title ?? "unknown"}`,
      );
    }

    return {
      type,
      title: content.title ?? "",
      year: content.year ?? "",
      rating: typeof rawRating === "number" ? rawRating / 2 : "",
      genres: "",
      countries: "",
      content_code: contentCode,
    };
  }

  async function collectRatings(userCode, contentType, type) {
    let next = `/api/users/${encodeURIComponent(userCode)}/contents/${contentType}/ratings`;
    const rows = [];
    let page = 1;

    while (next) {
      setStatus(
        `${type === "movie" ? "영화" : "시리즈"} 평가 수집 중 · ${rows.length}개`,
      );
      const json = await requestJson(next);
      const parsed = parseRatingsPage(json);
      rows.push(...parsed.items.map((item) => normalizeRating(item, type)));
      next = parsed.next;
      page += 1;
    }

    console.info(
      `[WatchaPedia Exporter] ${type}: ${rows.length} items, ${page - 1} pages`,
    );
    return rows;
  }

  function normalizeText(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractGenresFromJsonLd(doc, title) {
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
          if (Array.isArray(value["@graph"])) {
            value["@graph"].forEach(add);
          }
        };
        add(parsed);
      } catch {
        // Ignore unrelated or malformed JSON-LD blocks.
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
    if (Array.isArray(genre)) {
      return genre.map(normalizeText).filter(Boolean);
    }
    if (genre) {
      return [normalizeText(genre)].filter(Boolean);
    }
    return [];
  }

  function looksLikeCountry(value) {
    if (!value) return false;
    if (value.length > 50) return false;
    if (/시간|분|관람|청불|개봉|예매|방영|에피소드|평균|평가/.test(value)) {
      return false;
    }
    return true;
  }

  function extractCountryFromRenderedHtml(doc, row, genres) {
    const year = String(row.year ?? "").slice(0, 4);
    const candidates = [...doc.querySelectorAll("div, span, p")]
      .map((element) => ({
        element,
        text: normalizeText(element.textContent),
      }))
      .filter(({ text }) => text && text.length <= 140 && text.includes("·"))
      .filter(({ text }) => !year || text.startsWith(year));

    let metadata = null;

    if (genres.length) {
      metadata = candidates.find(({ text }) =>
        genres.some((genre) => text.includes(genre)),
      );
    }

    metadata ??= candidates[0] ?? null;
    if (!metadata) {
      return [];
    }

    const parts = metadata.text
      .split("·")
      .map((part) => part.trim())
      .filter(Boolean);

    let genreIndex = -1;
    if (genres.length) {
      genreIndex = parts.findIndex((part) =>
        genres.some((genre) => part.includes(genre)),
      );
    }

    if (genreIndex >= 0) {
      const inlineCountry = parts[genreIndex + 1];
      if (looksLikeCountry(inlineCountry)) {
        return inlineCountry
          .split(/[\/,]/)
          .map((value) => value.trim())
          .filter(Boolean);
      }
    }

    let sibling = metadata.element.nextElementSibling;
    for (
      let i = 0;
      sibling && i < 3;
      i += 1, sibling = sibling.nextElementSibling
    ) {
      const candidate = normalizeText(sibling.textContent);
      if (!candidate || candidate.includes("·")) {
        continue;
      }
      if (looksLikeCountry(candidate)) {
        return candidate
          .split(/[\/,]/)
          .map((value) => value.trim())
          .filter(Boolean);
      }
    }

    return [];
  }

  function parseDetailMetadata(html, row) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const genres = extractGenresFromJsonLd(doc, row.title);
    const countries = extractCountryFromRenderedHtml(doc, row, genres);

    return {
      genres: [...new Set(genres)].join("|"),
      countries: [...new Set(countries)].join("|"),
    };
  }

  async function enrichRows(rows) {
    const targets = rows.filter((row) => !row.genres || !row.countries);
    let failed = 0;

    for (let index = 0; index < targets.length; index += 1) {
      const row = targets[index];
      setStatus(
        `상세 정보 수집 중 · ${index + 1}/${targets.length} · ${row.title}`,
      );

      try {
        const html = await requestHtml(row.content_code);
        Object.assign(row, parseDetailMetadata(html, row));
      } catch (error) {
        failed += 1;
        console.error(
          `[WatchaPedia Exporter] detail failed: ${row.title}`,
          error,
        );
      }
    }

    return failed;
  }

  function selectCsvFile() {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".csv,text/csv";
      input.style.display = "none";

      input.addEventListener(
        "change",
        () => {
          const file = input.files?.[0];
          input.remove();
          if (file) resolve(file);
          else reject(new Error("CSV 파일 선택이 취소되었습니다."));
        },
        { once: true },
      );

      document.body.appendChild(input);
      input.click();
    });
  }

  function parseCsv(text) {
    const source = text.replace(/^\uFEFF/, "");
    const table = [];
    let row = [];
    let value = "";
    let quoted = false;

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];

      if (quoted) {
        if (char === '"') {
          if (source[index + 1] === '"') {
            value += '"';
            index += 1;
          } else {
            quoted = false;
          }
        } else {
          value += char;
        }
        continue;
      }

      if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        row.push(value);
        value = "";
      } else if (char === "\n") {
        row.push(value);
        table.push(row);
        row = [];
        value = "";
      } else if (char !== "\r") {
        value += char;
      }
    }

    if (value.length || row.length) {
      row.push(value);
      table.push(row);
    }

    if (!table.length) {
      return [];
    }

    const headers = table[0].map((header) => header.trim());
    const required = ["content_code"];
    const missing = required.filter((header) => !headers.includes(header));
    if (missing.length) {
      throw new Error(
        `지원하지 않는 CSV입니다. 필수 컬럼 누락: ${missing.join(", ")}`,
      );
    }

    return table
      .slice(1)
      .filter((values) => values.some((item) => item !== ""))
      .map((values) =>
        Object.fromEntries(
          headers.map((header, index) => [header, values[index] ?? ""]),
        ),
      );
  }

  function mergeWithExisting(currentRows, oldRows) {
    const oldByCode = new Map(oldRows.map((row) => [row.content_code, row]));
    const currentCodes = new Set(currentRows.map((row) => row.content_code));

    let added = 0;
    let changed = 0;
    let reused = 0;

    for (const row of currentRows) {
      const old = oldByCode.get(row.content_code);
      if (!old) {
        added += 1;
        continue;
      }

      const ratingChanged =
        String(old.rating ?? "") !== String(row.rating ?? "");
      const titleChanged = String(old.title ?? "") !== String(row.title ?? "");
      const yearChanged = String(old.year ?? "") !== String(row.year ?? "");
      const typeChanged = String(old.type ?? "") !== String(row.type ?? "");
      if (ratingChanged || titleChanged || yearChanged || typeChanged) {
        changed += 1;
      }

      row.genres = old.genres ?? "";
      row.countries = old.countries ?? "";
      reused += 1;
    }

    const removed = oldRows.filter(
      (row) => !currentCodes.has(row.content_code),
    ).length;

    return { rows: currentRows, added, changed, removed, reused };
  }

  function csvEscape(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  function buildCsv(rows) {
    return [
      CONFIG.CSV_COLUMNS.join(","),
      ...rows.map((row) =>
        CONFIG.CSV_COLUMNS.map((column) => csvEscape(row[column])).join(","),
      ),
    ].join("\r\n");
  }

  function localDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function downloadCsv(rows) {
    const blob = new Blob(["\uFEFF", buildCsv(rows)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `watchapedia-ratings-${localDateString()}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  async function collectCurrentRatings() {
    const userCode = await getCurrentUserCode();
    const movies = await collectRatings(userCode, "movies", "movie");
    const series = await collectRatings(userCode, "tv_seasons", "series");
    return {
      movies,
      series,
      rows: [...movies, ...series],
    };
  }

  async function runInitialBackup() {
    const collected = await collectCurrentRatings();
    const failed = await enrichRows(collected.rows);
    downloadCsv(collected.rows);

    setSummary(
      `새 백업 완료 · 영화 ${collected.movies.length} · 시리즈 ${collected.series.length} · 총 ${collected.rows.length}` +
        (failed ? ` · 상세정보 실패 ${failed}` : ""),
    );
  }

  async function runUpdateBackup() {
    setStatus("기존 WatchaPedia CSV를 선택해 주세요.");
    const file = await selectCsvFile();
    const oldRows = parseCsv(await file.text());

    setStatus(`기존 백업 ${oldRows.length}개 확인 · 현재 평가를 조회합니다.`);
    const collected = await collectCurrentRatings();
    const merged = mergeWithExisting(collected.rows, oldRows);
    const detailTargets = merged.rows.filter(
      (row) => !row.genres || !row.countries,
    ).length;

    setSummary(
      `업데이트 비교 · 기존 ${oldRows.length} · 현재 ${merged.rows.length} · 신규 ${merged.added} · 변경 ${merged.changed} · 삭제 ${merged.removed} · 상세조회 ${detailTargets}`,
    );

    const failed = await enrichRows(merged.rows);
    downloadCsv(merged.rows);

    setSummary(
      `업데이트 완료 · 총 ${merged.rows.length} · 신규 ${merged.added} · 변경 ${merged.changed} · 삭제 ${merged.removed}` +
        (failed ? ` · 상세정보 실패 ${failed}` : ""),
    );
  }

  async function run(action) {
    if (state.running) return;

    state.deviceId = getDeviceId();
    if (!state.deviceId) {
      setSummary(
        "기기 식별자를 찾지 못했습니다. 로그인 상태에서 페이지를 새로고침해 주세요.",
      );
      return;
    }
    state.headers = createApiHeaders(state.deviceId);
    state.running = true;
    setButtonsDisabled(true);

    try {
      if (action === "initial") {
        await runInitialBackup();
      } else {
        await runUpdateBackup();
      }
    } catch (error) {
      console.error("[WatchaPedia Exporter]", error);
      setSummary(
        `실패 · ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      state.running = false;
      setButtonsDisabled(false);
    }
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #wpe-launcher {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 2147483646;
        border: 0;
        border-radius: 999px;
        padding: 11px 16px;
        background: #ff0558;
        color: #fff;
        font: 600 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 6px 24px rgba(0,0,0,.18);
        cursor: pointer;
      }
      #wpe-panel {
        position: fixed;
        right: 20px;
        bottom: 72px;
        z-index: 2147483647;
        width: min(360px, calc(100vw - 40px));
        box-sizing: border-box;
        border: 1px solid rgba(0,0,0,.12);
        border-radius: 14px;
        padding: 16px;
        background: #fff;
        color: #222;
        box-shadow: 0 12px 36px rgba(0,0,0,.2);
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #wpe-panel[hidden] { display: none; }
      #wpe-panel h2 { margin: 0 0 4px; font-size: 17px; }
      #wpe-panel p { margin: 0; }
      #wpe-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 14px; }
      #wpe-actions button {
        border: 0;
        border-radius: 9px;
        padding: 10px 8px;
        background: #292a32;
        color: #fff;
        font-weight: 600;
        cursor: pointer;
      }
      #wpe-actions button:disabled { opacity: .45; cursor: default; }
      #wpe-status, #wpe-summary {
        margin-top: 12px;
        padding-top: 10px;
        border-top: 1px solid #eee;
        white-space: pre-wrap;
        word-break: keep-all;
      }
      #wpe-status { color: #666; }
      #wpe-summary { color: #222; font-weight: 600; }
      #wpe-note { margin-top: 10px !important; color: #888; font-size: 11px; }
    `;
    document.head.appendChild(style);
  }

  function createUi() {
    if (document.querySelector("#wpe-launcher")) return;

    injectStyles();

    const launcher = document.createElement("button");
    launcher.id = "wpe-launcher";
    launcher.type = "button";
    launcher.textContent = "WP Export";

    const panel = document.createElement("section");
    panel.id = "wpe-panel";
    panel.hidden = true;
    panel.innerHTML = `
      <h2>WatchaPedia Exporter</h2>
      <p>영화·시리즈 평가를 CSV로 백업하고 기존 백업을 갱신합니다.</p>
      <div id="wpe-actions">
        <button id="wpe-initial" type="button">새 백업 만들기</button>
        <button id="wpe-update" type="button">기존 백업 업데이트</button>
      </div>
      <div id="wpe-status">대기 중</div>
      <div id="wpe-summary"></div>
      <p id="wpe-note">상세 장르·국가 정보는 순차적으로 조회합니다.</p>
    `;

    launcher.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
    });
    panel
      .querySelector("#wpe-initial")
      .addEventListener("click", () => run("initial"));
    panel
      .querySelector("#wpe-update")
      .addEventListener("click", () => run("update"));

    document.body.append(panel, launcher);
  }

  function setButtonsDisabled(disabled) {
    document.querySelectorAll("#wpe-actions button").forEach((button) => {
      button.disabled = disabled;
    });
  }

  function setStatus(message) {
    const element = document.querySelector("#wpe-status");
    if (element) element.textContent = message;
  }

  function setSummary(message) {
    const element = document.querySelector("#wpe-summary");
    if (element) element.textContent = message;
  }

  createUi();
})();
