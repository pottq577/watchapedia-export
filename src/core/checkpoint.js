"use strict";

function validateCheckpointRun(run, supportedSchemaVersion) {
  if (!run || typeof run !== "object") {
    return { ok: false, code: "invalid", reason: "체크포인트 데이터가 없습니다." };
  }
  if (run.schema_version !== supportedSchemaVersion) {
    return {
      ok: false,
      code: "unsupported_schema",
      reason: `지원하지 않는 체크포인트 형식입니다. 저장 형식 ${run.schema_version ?? "unknown"}, 현재 ${supportedSchemaVersion}`,
    };
  }
  if (!(["initial", "update"].includes(run.mode))) {
    return { ok: false, code: "invalid_mode", reason: "알 수 없는 작업 유형입니다." };
  }
  if (!(["ratings", "details"].includes(run.phase))) {
    return { ok: false, code: "invalid_phase", reason: "알 수 없는 수집 단계입니다." };
  }
  if (typeof run.user_code !== "string" || !run.user_code) {
    return { ok: false, code: "invalid_user", reason: "사용자 코드가 없습니다." };
  }
  if (!Array.isArray(run.current_rows)) {
    return { ok: false, code: "invalid_rows", reason: "수집 행 데이터가 올바르지 않습니다." };
  }
  if (run.phase === "ratings") {
    const state = run.ratings_state;
    if (!state || !(["movies", "tv_seasons"].includes(state.stage))) {
      return { ok: false, code: "invalid_ratings_state", reason: "평가 수집 상태가 올바르지 않습니다." };
    }
  }
  return { ok: true, code: "ok", reason: "" };
}

function progressMap(progressRows) {
  return new Map((progressRows ?? []).map((item) => [item.content_code, item]));
}

module.exports = { validateCheckpointRun, progressMap };
