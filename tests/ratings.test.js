"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseRatingsPage,
  normalizeRating,
  mergeWithExisting,
} = require("../src/core/ratings");

test("ratings API parser supports nested result shape", () => {
  const parsed = parseRatingsPage({
    result: { result: [{ id: 1 }], next_uri: "/next" },
  });
  assert.deepEqual(parsed, { items: [{ id: 1 }], next: "/next" });
});

test("rating normalization converts the internal 10 point scale to 5 points", () => {
  const row = normalizeRating(
    {
      user_content_action: { rating: 9 },
      content: { code: "m1", title: "Movie", year: 2026 },
    },
    "movie",
  );
  assert.equal(row.rating, 4.5);
  assert.equal(row.content_code, "m1");
});

test("merge reuses metadata and counts add/change/remove", () => {
  const oldRows = [
    { type: "movie", title: "A", year: "2020", rating: "4", genres: "공포", countries: "미국", content_code: "a" },
    { type: "movie", title: "B", year: "2021", rating: "3", genres: "드라마", countries: "한국", content_code: "b" },
  ];
  const currentRows = [
    { type: "movie", title: "A", year: "2020", rating: 4.5, genres: "", countries: "", content_code: "a" },
    { type: "series", title: "C", year: "2026", rating: 5, genres: "", countries: "", content_code: "c" },
  ];

  const result = mergeWithExisting(currentRows, oldRows);
  assert.equal(result.added, 1);
  assert.equal(result.changed, 1);
  assert.equal(result.removed, 1);
  assert.equal(result.reused, 1);
  assert.equal(result.rows[0].genres, "공포");
  assert.equal(result.rows[0].countries, "미국");
});
