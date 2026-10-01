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

test("rating normalization keeps the rating registration timestamp", () => {
  const row = normalizeRating(
    {
      user_content_action: {
        rating: 9,
        rate_created_at: "2026-08-29T23:41:33+09:00",
      },
      content: { code: "m1", title: "Movie", year: 2026 },
    },
    "movie",
  );
  assert.equal(row.rating, 4.5);
  assert.equal(row.rated_at, "2026-08-29T23:41:33+09:00");
  assert.equal(row.content_code, "m1");
});

test("merge reuses metadata while keeping current rated_at", () => {
  const oldRows = [
    {
      type: "movie",
      title: "A",
      year: "2020",
      rating: "4",
      rated_at: "",
      genres: "공포",
      countries: "미국",
      content_code: "a",
    },
    {
      type: "movie",
      title: "B",
      year: "2021",
      rating: "3",
      rated_at: "",
      genres: "드라마",
      countries: "한국",
      content_code: "b",
    },
  ];
  const currentRows = [
    {
      type: "movie",
      title: "A",
      year: "2020",
      rating: 4.5,
      rated_at: "2026-09-22T20:00:44+09:00",
      genres: "",
      countries: "",
      content_code: "a",
    },
    {
      type: "series",
      title: "C",
      year: "2026",
      rating: 5,
      rated_at: "2026-10-01T10:00:00+09:00",
      genres: "",
      countries: "",
      content_code: "c",
    },
  ];

  const result = mergeWithExisting(currentRows, oldRows);
  assert.equal(result.added, 1);
  assert.equal(result.changed, 1);
  assert.equal(result.removed, 1);
  assert.equal(result.reused, 1);
  assert.equal(result.rows[0].genres, "공포");
  assert.equal(result.rows[0].countries, "미국");
  assert.equal(result.rows[0].rated_at, "2026-09-22T20:00:44+09:00");
});
