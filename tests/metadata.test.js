"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  enrichRows,
  extractCountriesFromJsonLd,
  extractCountryFromMetadataText,
} = require("../src/browser/metadata");

function ui() {
  return { setStatus() {} };
}

test("extracts country from the compact content metadata line", () => {
  assert.deepEqual(
    extractCountryFromMetadataText(
      "2022 · 로맨스/드라마/미스터리/범죄/스릴러 · 한국",
      { year: 2022 },
      ["로맨스", "드라마", "미스터리", "범죄", "스릴러"],
    ),
    ["한국"],
  );
});

test("extracts multiple countries from JSON-LD country fields", () => {
  assert.deepEqual(
    extractCountriesFromJsonLd({
      countryOfOrigin: [{ name: "미국" }, { name: "영국" }],
    }),
    ["미국", "영국"],
  );
});

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

test("partial metadata remains retryable on resume", async () => {
  const rows = [{ title: "A", genres: "공포", countries: "", content_code: "a" }];
  let requests = 0;
  const statuses = [];
  const result = await enrichRows({
    rows,
    client: {
      async requestHtml() {
        requests += 1;
        return "html";
      },
    },
    storage: {
      async saveProgress(row, status) {
        statuses.push(status);
      },
    },
    progressByCode: new Map([["a", { status: "partial" }]]),
    ui: ui(),
    parseMetadata: () => ({ genres: "공포", countries: "한국" }),
  });

  assert.equal(requests, 1);
  assert.equal(result.attempted, 1);
  assert.deepEqual(statuses, ["complete"]);
});

test("successful but incomplete metadata is stored as partial", async () => {
  const row = { title: "A", genres: "", countries: "", content_code: "a" };
  const statuses = [];
  const result = await enrichRows({
    rows: [row],
    client: { async requestHtml() { return "html"; } },
    storage: {
      async saveProgress(current, status) {
        statuses.push(status);
      },
    },
    progressByCode: new Map(),
    ui: ui(),
    parseMetadata: () => ({ genres: "공포", countries: "" }),
  });

  assert.equal(result.failedRows.length, 0);
  assert.equal(result.metadataWarnings, 1);
  assert.deepEqual(statuses, ["partial"]);
});
