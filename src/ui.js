"use strict";

function createUi(documentRef = document) {
  if (documentRef.querySelector("#wpe-launcher")) {
    throw new Error("WatchaPedia Exporter UI가 이미 초기화되었습니다.");
  }

  const style = documentRef.createElement("style");
  style.textContent = `
    #wpe-launcher {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483646;
      border: 0; border-radius: 999px; padding: 11px 16px;
      background: #ff0558; color: #fff;
      font: 600 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-shadow: 0 6px 24px rgba(0,0,0,.18); cursor: pointer;
    }
    #wpe-panel {
      position: fixed; right: 20px; bottom: 72px; z-index: 2147483647;
      width: min(360px, calc(100vw - 40px)); box-sizing: border-box;
      border: 1px solid rgba(0,0,0,.12); border-radius: 14px; padding: 16px;
      background: #fff; color: #222; box-shadow: 0 12px 36px rgba(0,0,0,.2);
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #wpe-panel[hidden] { display: none; }
    #wpe-panel h2 { margin: 0 0 4px; font-size: 17px; }
    #wpe-panel p { margin: 0; }
    #wpe-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 14px; }
    #wpe-actions button {
      border: 0; border-radius: 9px; padding: 10px 8px;
      background: #292a32; color: #fff; font-weight: 600; cursor: pointer;
    }
    #wpe-actions button:disabled { opacity: .45; cursor: default; }
    #wpe-resume { grid-column: 1 / -1; background: #ff0558 !important; }
    #wpe-resume[hidden] { display: none; }
    #wpe-status, #wpe-summary {
      margin-top: 12px; padding-top: 10px; border-top: 1px solid #eee;
      white-space: pre-wrap; word-break: keep-all;
    }
    #wpe-status { color: #666; }
    #wpe-summary { color: #222; font-weight: 600; }
    #wpe-note { margin-top: 10px !important; color: #888; font-size: 11px; }
  `;
  documentRef.head.appendChild(style);

  const launcher = documentRef.createElement("button");
  launcher.id = "wpe-launcher";
  launcher.type = "button";
  launcher.textContent = "WP Export";

  const panel = documentRef.createElement("section");
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

  let actionHandler = () => {};
  launcher.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });
  panel
    .querySelector("#wpe-initial")
    .addEventListener("click", () => actionHandler("initial"));
  panel
    .querySelector("#wpe-update")
    .addEventListener("click", () => actionHandler("update"));
  panel
    .querySelector("#wpe-resume")
    .addEventListener("click", () => actionHandler("resume"));
  documentRef.body.append(panel, launcher);

  function setActionHandler(handler) {
    actionHandler = handler;
  }

  function setButtonsDisabled(disabled) {
    documentRef.querySelectorAll("#wpe-actions button").forEach((button) => {
      button.disabled = disabled;
    });
  }

  function setStatus(message) {
    const element = documentRef.querySelector("#wpe-status");
    if (element) element.textContent = message;
  }

  function setSummary(message) {
    const element = documentRef.querySelector("#wpe-summary");
    if (element) element.textContent = message;
  }

  function setResumeButton({ visible, text = "중단된 작업 이어서 진행" }) {
    const button = documentRef.querySelector("#wpe-resume");
    if (!button) return;
    button.hidden = !visible;
    button.textContent = text;
  }

  return {
    setActionHandler,
    setButtonsDisabled,
    setStatus,
    setSummary,
    setResumeButton,
  };
}

module.exports = { createUi };
