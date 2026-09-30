// ==UserScript==
// @name         WatchaPedia Ratings Exporter
// @namespace    watchapedia-ratings-exporter
// @version      0.2.0
// @description  왓챠피디아 영화·시리즈 평가를 CSV로 백업하고 기존 백업을 증분 갱신합니다.
// @match        https://pedia.watcha.com/ko
// @match        https://pedia.watcha.com/ko/*
// @updateURL    https://raw.githubusercontent.com/pottq577/watchapedia-export/main/watchapedia-exporter.user.js
// @downloadURL  https://raw.githubusercontent.com/pottq577/watchapedia-export/main/watchapedia-exporter.user.js
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
    CHECKPOINT_DB_NAME: "watchapedia-exporter",
    CHECKPOINT_DB_VERSION: 1,
    CHECKPOINT_RUN_STORE: "runs",
    CHECKPOINT_PROGRESS_STORE: "progress",
    CHECKPOINT_ID: "active",
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
    checkpoint: null,
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function openCheckpointDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(
        CONFIG.CHECKPOINT_DB_NAME,
        CONFIG.CHECKPOINT_DB_VERSION,
      );

      request.addEventListener("upgradeneeded", () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(CONFIG.CHECKPOINT_RUN_STORE)) {
          db.createObjectStore(CONFIG.CHECKPOINT_RUN_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(CONFIG.CHECKPOINT_PROGRESS_STORE)) {
          const store = db.createObjectStore(CONFIG.CHECKPOINT_PROGRESS_STORE, {
            keyPath: ["run_id", "content_code"],
          });
          store.createIndex("run_id", "run_id", { unique: false });
        }
      });

      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () =>
        reject(request.error ?? new Error("IndexedDB를 열 수 없습니다.")),
      );
    });
  }

  function waitForTransaction(transaction) {
    return new Promise((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve());
      transaction.addEventListener("abort", () =>
        reject(
          transaction.error ?? new Error("IndexedDB 작업이 중단되었습니다."),
        ),
      );
      transaction.addEventListener("error", () =>
        reject(
          transaction.error ?? new Error("IndexedDB 작업에 실패했습니다."),
        ),
      );
    });
  }

  function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () =>
        reject(request.error ?? new Error("IndexedDB 요청에 실패했습니다.")),
      );
    });
  }

  async function loadCheckpointRun() {
    const db = await openCheckpointDb();
    try {
      const transaction = db.transaction(
        CONFIG.CHECKPOINT_RUN_STORE,
        "readonly",
      );
      const request = transaction
        .objectStore(CONFIG.CHECKPOINT_RUN_STORE)
        .get(CONFIG.CHECKPOINT_ID);
      return (await requestValue(request)) ?? null;
    } finally {
      db.close();
    }
  }

  async function saveCheckpointRun(run) {
    const db = await openCheckpointDb();
    try {
      const transaction = db.transaction(
        CONFIG.CHECKPOINT_RUN_STORE,
        "readwrite",
      );
      run.updated_at = new Date().toISOString();
      transaction.objectStore(CONFIG.CHECKPOINT_RUN_STORE).put(run);
      await waitForTransaction(transaction);
      state.checkpoint = run;
    } finally {
      db.close();
    }
  }

  async function saveCheckpointProgress(row) {
    const db = await openCheckpointDb();
    try {
      const transaction = db.transaction(
        CONFIG.CHECKPOINT_PROGRESS_STORE,
        "readwrite",
      );
      transaction.objectStore(CONFIG.CHECKPOINT_PROGRESS_STORE).put({
        run_id: CONFIG.CHECKPOINT_ID,
        content_code: row.content_code,
        genres: row.genres ?? "",
        countries: row.countries ?? "",
        updated_at: new Date().toISOString(),
      });
      await waitForTransaction(transaction);
    } finally {
      db.close();
    }
  }

  async function loadCheckpointProgress() {
    const db = await openCheckpointDb();
    try {
      const transaction = db.transaction(
        CONFIG.CHECKPOINT_PROGRESS_STORE,
        "readonly",
      );
      const request = transaction
        .objectStore(CONFIG.CHECKPOINT_PROGRESS_STORE)
        .index("run_id")
        .getAll(CONFIG.CHECKPOINT_ID);
      return (await requestValue(request)) ?? [];
    } finally {
      db.close();
    }
  }

  async function clearCheckpoint() {
    const db = await openCheckpointDb();
    try {
      const transaction = db.transaction(
        [CONFIG.CHECKPOINT_RUN_STORE, CONFIG.CHECKPOINT_PROGRESS_STORE],
        "readwrite",
      );
      transaction
        .objectStore(CONFIG.CHECKPOINT_RUN_STORE)
        .delete(CONFIG.CHECKPOINT_ID);

      const progressIndex = transaction
        .objectStore(CONFIG.CHECKPOINT_PROGRESS_STORE)
        .index("run_id");
      const cursorRequest = progressIndex.openCursor(
        IDBKeyRange.only(CONFIG.CHECKPOINT_ID),
      );
      cursorRequest.addEventListener("success", () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      });

      await waitForTransaction(transaction);
      state.checkpoint = null;
    } finally {
      db.close();
    }
  }

  async function hydrateCheckpointRows(run) {
    const rows = (run.current_rows ?? []).map((row) => ({ ...row }));
    const progress = await loadCheckpointProgress();
    const progressByCode = new Map(
      progress.map((item) => [item.content_code, item]),
    );

    for (const row of rows) {
      const saved = progressByCode.get(row.content_code);
      if (!saved) continue;
      row.genres = saved.genres ?? row.genres ?? "";
      row.countries = saved.countries ?? row.countries ?? "";
    }

    return rows;
  }

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

  function ratingsUrl(userCode, contentType) {
    return `/api/users/${encodeURIComponent(userCode)}/contents/${contentType}/ratings`;
  }

  async function createCheckpointRun(mode, oldRows = [], sourceFileName = "") {
    const userCode = await getCurrentUserCode();
    const now = new Date().toISOString();
    const run = {
      id: CONFIG.CHECKPOINT_ID,
      schema_version: 1,
      mode,
      phase: "ratings",
      user_code: userCode,
      source_file_name: sourceFileName,
      created_at: now,
      updated_at: now,
      old_rows: mode === "update" ? oldRows : [],
      current_rows: [],
      ratings_state: {
        stage: "movies",
        next: ratingsUrl(userCode, "movies"),
        movies: 0,
        series: 0,
      },
      merge_stats: null,
    };

    await saveCheckpointRun(run);
    await refreshCheckpointUi();
    return run;
  }

  async function collectRatingsWithCheckpoint(run) {
    while (run.phase === "ratings") {
      const ratingsState = run.ratings_state;

      if (!ratingsState.next) {
        if (ratingsState.stage === "movies") {
          ratingsState.stage = "tv_seasons";
          ratingsState.next = ratingsUrl(run.user_code, "tv_seasons");
          await saveCheckpointRun(run);
          continue;
        }

        run.phase = "details";
        if (run.mode === "update") {
          const merged = mergeWithExisting(
            run.current_rows,
            run.old_rows ?? [],
          );
          run.current_rows = merged.rows;
          run.merge_stats = {
            old: run.old_rows?.length ?? 0,
            current: merged.rows.length,
            added: merged.added,
            changed: merged.changed,
            removed: merged.removed,
            reused: merged.reused,
          };
          run.old_rows = [];
        }
        await saveCheckpointRun(run);
        break;
      }

      const isMovie = ratingsState.stage === "movies";
      const type = isMovie ? "movie" : "series";
      setStatus(
        `${isMovie ? "영화" : "시리즈"} 평가 수집 중 · ${
          isMovie ? ratingsState.movies : ratingsState.series
        }개`,
      );

      const json = await requestJson(ratingsState.next);
      const parsed = parseRatingsPage(json);
      const normalized = parsed.items.map((item) =>
        normalizeRating(item, type),
      );
      run.current_rows.push(...normalized);
      if (isMovie) {
        ratingsState.movies += normalized.length;
      } else {
        ratingsState.series += normalized.length;
      }
      ratingsState.next = parsed.next;
      await saveCheckpointRun(run);
    }

    return run;
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

  async function enrichRows(rows, persistProgress = false) {
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
        if (persistProgress) {
          await saveCheckpointProgress(row);
        }
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

  async function confirmReplaceCheckpoint() {
    const checkpoint = await loadCheckpointRun();
    if (!checkpoint) return true;

    const confirmed = window.confirm(
      "중단된 수집 작업이 있습니다. 새 작업을 시작하면 기존 임시 저장 내용을 삭제합니다. 계속할까요?",
    );
    if (!confirmed) return false;

    await clearCheckpoint();
    await refreshCheckpointUi();
    return true;
  }

  function formatRunSummary(run, failed) {
    if (run.mode === "update") {
      const stats = run.merge_stats ?? {};
      return (
        `업데이트 완료 · 총 ${run.current_rows.length} · 신규 ${stats.added ?? 0} · 변경 ${stats.changed ?? 0} · 삭제 ${stats.removed ?? 0}` +
        (failed ? ` · 상세정보 실패 ${failed}` : "")
      );
    }

    return (
      `새 백업 완료 · 영화 ${run.ratings_state.movies} · 시리즈 ${run.ratings_state.series} · 총 ${run.current_rows.length}` +
      (failed ? ` · 상세정보 실패 ${failed}` : "")
    );
  }

  async function executeCheckpointRun(run) {
    if (run.phase === "ratings") {
      run = await collectRatingsWithCheckpoint(run);
    }

    const rows = await hydrateCheckpointRows(run);
    run.current_rows = rows;

    if (run.mode === "update" && run.merge_stats) {
      const stats = run.merge_stats;
      const detailTargets = rows.filter(
        (row) => !row.genres || !row.countries,
      ).length;
      setSummary(
        `업데이트 비교 · 기존 ${stats.old} · 현재 ${stats.current} · 신규 ${stats.added} · 변경 ${stats.changed} · 삭제 ${stats.removed} · 상세조회 ${detailTargets}`,
      );
    }

    const failed = await enrichRows(rows, true);
    run.current_rows = rows;
    downloadCsv(rows);
    const summary = formatRunSummary(run, failed);
    await clearCheckpoint();
    await refreshCheckpointUi();
    setStatus("완료");
    setSummary(summary);
  }

  async function runInitialBackup() {
    if (!(await confirmReplaceCheckpoint())) return;
    const run = await createCheckpointRun("initial");
    await executeCheckpointRun(run);
  }

  async function runUpdateBackup() {
    setStatus("기존 WatchaPedia CSV를 선택해 주세요.");
    const file = await selectCsvFile();
    const oldRows = parseCsv(await file.text());

    if (!(await confirmReplaceCheckpoint())) return;
    const run = await createCheckpointRun("update", oldRows, file.name);
    setStatus(`기존 백업 ${oldRows.length}개 확인 · 현재 평가를 조회합니다.`);
    await executeCheckpointRun(run);
  }

  async function runResumeBackup() {
    const run = await loadCheckpointRun();
    if (!run) {
      setSummary("이어갈 중단 작업이 없습니다.");
      await refreshCheckpointUi();
      return;
    }

    const currentUserCode = await getCurrentUserCode();
    if (currentUserCode !== run.user_code) {
      throw new Error(
        "임시 저장된 작업과 현재 로그인 계정이 다릅니다. 기존 작업을 이어갈 수 없습니다.",
      );
    }

    setStatus(
      `중단된 ${run.mode === "update" ? "업데이트" : "새 백업"} 작업을 이어서 진행합니다.`,
    );
    await executeCheckpointRun(run);
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
      } else if (action === "update") {
        await runUpdateBackup();
      } else {
        await runResumeBackup();
      }
    } catch (error) {
      console.error("[WatchaPedia Exporter]", error);
      setSummary(
        `실패 · ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      state.running = false;
      setButtonsDisabled(false);
      await refreshCheckpointUi();
    }
  }

  async function refreshCheckpointUi() {
    const resumeButton = document.querySelector("#wpe-resume");
    if (!resumeButton) return;

    try {
      const checkpoint = await loadCheckpointRun();
      state.checkpoint = checkpoint;
      resumeButton.hidden = !checkpoint;

      if (checkpoint && !state.running) {
        const kind = checkpoint.mode === "update" ? "업데이트" : "새 백업";
        const phase =
          checkpoint.phase === "ratings" ? "평가 목록 수집" : "상세 정보 수집";
        resumeButton.textContent = `중단된 ${kind} 이어서 진행`;
        setStatus(`중단된 작업 있음 · ${phase} 단계`);
      }
    } catch (error) {
      console.error("[WatchaPedia Exporter] checkpoint lookup failed", error);
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
      #wpe-resume { grid-column: 1 / -1; background: #ff0558 !important; }
      #wpe-resume[hidden] { display: none; }
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
        <button id="wpe-resume" type="button" hidden>중단된 작업 이어서 진행</button>
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
    panel
      .querySelector("#wpe-resume")
      .addEventListener("click", () => run("resume"));

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
  refreshCheckpointUi();
})();
