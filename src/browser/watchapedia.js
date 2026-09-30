"use strict";

const {
  extractUserCodeFromMeResponse,
  extractUserCodeFromInitialData,
  extractUserCodeFromScriptTexts,
} = require("../core/identity");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCookie(documentRef, name) {
  return (
    documentRef.cookie
      .split("; ")
      .find((value) => value.startsWith(`${name}=`))
      ?.split("=")
      .slice(1)
      .join("=") ?? ""
  );
}

function getDeviceId(windowRef, documentRef) {
  const cookieValue = getCookie(documentRef, "_c_pdi");
  if (cookieValue) return decodeURIComponent(cookieValue);
  return (
    windowRef.__INITIAL_DATA__?.headers?.["x-frograms-device-identifier"] ?? ""
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

function createWatchaClient({ config, ui, env = globalThis }) {
  const windowRef = env.window ?? env;
  const documentRef = env.document;
  const fetchImpl = env.fetch.bind(env);
  let headers = null;

  function prepare() {
    const deviceId = getDeviceId(windowRef, documentRef);
    if (!deviceId) {
      throw new Error(
        "기기 식별자를 찾지 못했습니다. 로그인 상태에서 페이지를 새로고침해 주세요.",
      );
    }
    headers = createApiHeaders(deviceId);
  }

  async function requestJson(url, attempt = 0) {
    await sleep(config.API_DELAY_MS);
    const response = await fetchImpl(url, {
      method: "GET",
      credentials: "same-origin",
      headers,
    });

    if (response.ok) return response.json();

    if (
      (response.status === 429 || response.status >= 500) &&
      attempt < config.RETRY_LIMIT
    ) {
      const delay = 2_000 * 2 ** attempt;
      ui.setStatus(`요청 제한/서버 오류 (${response.status}). 잠시 후 재시도합니다.`);
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
    await sleep(config.DETAIL_DELAY_MS);
    const url = `/ko/contents/${encodeURIComponent(contentCode)}`;
    const response = await fetchImpl(url, {
      method: "GET",
      credentials: "same-origin",
      headers: { accept: "text/html,application/xhtml+xml" },
    });

    if (response.ok) return response.text();

    if (
      (response.status === 429 || response.status >= 500) &&
      attempt < config.RETRY_LIMIT
    ) {
      const delay = 3_000 * 2 ** attempt;
      ui.setStatus(`상세 정보 요청 실패 (${response.status}). 잠시 후 재시도합니다.`);
      await sleep(delay);
      return requestHtml(contentCode, attempt + 1);
    }
    throw new Error(`상세 페이지 요청 실패 (${response.status}): ${contentCode}`);
  }

  async function getCurrentUserCode() {
    try {
      const code = extractUserCodeFromMeResponse(await requestJson("/api/users/me"));
      if (code) return code;
    } catch (error) {
      console.warn(
        "[WatchaPedia Exporter] /api/users/me 조회 실패. 초기 페이지 데이터만 확인합니다.",
        error,
      );
    }

    const initialDataCode = extractUserCodeFromInitialData(windowRef.__INITIAL_DATA__);
    if (initialDataCode) return initialDataCode;

    const scriptCode = extractUserCodeFromScriptTexts(
      [...documentRef.scripts].map((script) => script.textContent ?? ""),
    );
    if (scriptCode) return scriptCode;

    throw new Error(
      "현재 로그인 사용자를 안전하게 식별하지 못했습니다. 임의의 프로필 링크는 사용하지 않습니다.",
    );
  }

  return { prepare, requestJson, requestHtml, getCurrentUserCode };
}

module.exports = { createWatchaClient, getDeviceId, createApiHeaders };
