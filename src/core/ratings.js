"use strict";

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
    rated_at: action.rate_created_at ?? action.rateCreatedAt ?? "",
    genres: "",
    countries: "",
    content_code: contentCode,
  };
}

function ratingsUrl(userCode, contentType) {
  return `/api/users/${encodeURIComponent(userCode)}/contents/${contentType}/ratings`;
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

    if (
      String(old.rating ?? "") !== String(row.rating ?? "") ||
      String(old.title ?? "") !== String(row.title ?? "") ||
      String(old.year ?? "") !== String(row.year ?? "") ||
      String(old.type ?? "") !== String(row.type ?? "")
    ) {
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

module.exports = {
  parseRatingsPage,
  normalizeRating,
  ratingsUrl,
  mergeWithExisting,
};
