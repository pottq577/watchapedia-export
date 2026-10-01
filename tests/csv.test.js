"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCsv, buildCsv } = require("../src/core/csv");

const columns = [
  "type",
  "title",
  "year",
  "rating",
  "rated_at",
  "genres",
  "countries",
  "content_code",
];

test("CSV build/parse round trip preserves rated_at and escaped text", () => {
  const rows = [
    {
      type: "movie",
      title: 'A, "B"\nC',
      year: "2026",
      rating: "4.5",
      rated_at: "2026-08-29T23:41:33+09:00",
      genres: "공포|스릴러",
      countries: "미국",
      content_code: "m1",
    },
  ];

  const parsed = parseCsv(`\uFEFF${buildCsv(rows, columns)}`);
  assert.deepEqual(parsed, rows);
});

test("CSV parser accepts older backups without rated_at", () => {
  const parsed = parseCsv(
    "type,title,year,rating,genres,countries,content_code\r\n" +
      '"movie","A","2026","5","공포","한국","m1"',
  );
  assert.equal(parsed[0].content_code, "m1");
  assert.equal(parsed[0].rated_at, undefined);
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
