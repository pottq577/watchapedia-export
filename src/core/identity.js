"use strict";

function extractUserCodeFromMeResponse(json) {
  const code = json?.result?.code ?? json?.code ?? "";
  return typeof code === "string" ? code.trim() : "";
}

function collectExplicitUserCodes(value, output, seen) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectExplicitUserCodes(item, output, seen);
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (
      (key === "userCode" || key === "user_code") &&
      typeof nested === "string" &&
      nested.trim()
    ) {
      output.add(nested.trim());
    }
    if (nested && typeof nested === "object") {
      collectExplicitUserCodes(nested, output, seen);
    }
  }
}

function extractUserCodeFromInitialData(initialData) {
  if (!initialData || typeof initialData !== "object") return "";

  const directCandidates = [
    initialData.currentUser?.code,
    initialData.current_user?.code,
    initialData.me?.code,
  ].filter((value) => typeof value === "string" && value.trim());

  if (directCandidates.length) {
    const unique = [...new Set(directCandidates.map((value) => value.trim()))];
    if (unique.length === 1) return unique[0];
  }

  const codes = new Set();
  collectExplicitUserCodes(initialData, codes, new Set());
  return codes.size === 1 ? [...codes][0] : "";
}

function extractUserCodeFromScriptTexts(scriptTexts) {
  const codes = new Set();
  const patterns = [
    /["']userCode["']\s*[:,]\s*["']([^"']+)["']/g,
    /["']user_code["']\s*[:,]\s*["']([^"']+)["']/g,
  ];

  for (const text of scriptTexts ?? []) {
    if (typeof text !== "string") continue;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        if (match[1]?.trim()) codes.add(match[1].trim());
      }
    }
  }

  return codes.size === 1 ? [...codes][0] : "";
}

module.exports = {
  extractUserCodeFromMeResponse,
  extractUserCodeFromInitialData,
  extractUserCodeFromScriptTexts,
};
