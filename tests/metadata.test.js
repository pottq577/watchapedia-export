"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { enrichRows } = require("../src/browser/metadata");

function ui() {
  return { setStatus() {} };
}

test("enrichRows keeps failed items retryable and records successful progress", async () => {
  const rows = [
    { title: "A", genres: "", countries: "", content_code: "a" },
    { title: "B", genres: "", countries: "", content_code: "b" },
  ];
  const progress = [];
  const storage = {
    async saveProgress(row, status, error = "") {
      progress.push({ content_code: row.content_code, status, error });
    },
  };
  const client = {
    async requestHtml(code) {
      if (code === "b") throw new Error("network");
      return "html";
    },
  };

  const result = await enrichRows({
    rows,
    client,
    storage,
    progressByCode: new Map(),
    ui: ui(),
    parseMetadata: () => ({ genres: "공포", countries: "미국" }),
    logger: { error() {} },
  });

  assert.equal(result.completed, 1);
  assert.equal(result.failedRows.length, 1);
  assert.deepEqual(progress.map((item) => item.status), ["complete", "failed"]);
});

test("completed checkpoint progress skips a blank metadata row on resume", async () => {
  const rows = [{ title: "A", genres: "", countries: "", content_code: "a" }];
  let requests = 0;
  const result = await enrichRows({
    rows,
    client: { async requestHtml() { requests += 1; return "html"; } },
    storage: { async saveProgress() {} },
    progressByCode: new Map([["a", { status: "complete" }]]),
    ui: ui(),
    parseMetadata: () => ({ genres: "", countries: "" }),
  });

  assert.equal(requests, 0);
  assert.equal(result.attempted, 0);
});

test("successful but incomplete metadata is a warning, not a retry failure", async () => {
  const row = { title: "A", genres: "", countries: "", content_code: "a" };
  const result = await enrichRows({
    rows: [row],
    client: { async requestHtml() { return "html"; } },
    storage: { async saveProgress() {} },
    progressByCode: new Map(),
    ui: ui(),
    parseMetadata: () => ({ genres: "공포", countries: "" }),
  });

  assert.equal(result.failedRows.length, 0);
  assert.equal(result.metadataWarnings, 1);
});
