"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCsv, buildCsv } = require("../src/core/csv");

const columns = [
  "type",
  "title",
  "year",
  "rating",
  "genres",
  "countries",
  "content_code",
];

test("CSV build/parse round trip preserves commas, quotes and newlines", () => {
  const rows = [
    {
      type: "movie",
      title: 'A, "B"\nC',
      year: "2026",
      rating: "4.5",
      genres: "공포|스릴러",
      countries: "미국",
      content_code: "m1",
    },
  ];

  const parsed = parseCsv(`\uFEFF${buildCsv(rows, columns)}`);
  assert.deepEqual(parsed, rows);
});

test("CSV parser rejects files without content_code", () => {
  assert.throws(() => parseCsv("title,rating\r\nA,5"), /content_code/);
});

test("CSV parser rejects an unclosed quoted field", () => {
  assert.throws(
    () => parseCsv('content_code,title\r\n"m1","broken'),
    /따옴표/,
  );
});
