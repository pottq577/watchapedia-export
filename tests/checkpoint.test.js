"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateCheckpointRun } = require("../src/core/checkpoint");

function run(overrides = {}) {
  return {
    schema_version: 2,
    mode: "initial",
    phase: "ratings",
    user_code: "u1",
    current_rows: [],
    ratings_state: { stage: "movies", next: "/next", movies: 0, series: 0 },
    ...overrides,
  };
}

test("accepts the current checkpoint schema", () => {
  assert.equal(validateCheckpointRun(run(), 2).ok, true);
});

test("rejects an older checkpoint schema", () => {
  const result = validateCheckpointRun(run({ schema_version: 1 }), 2);
  assert.equal(result.ok, false);
  assert.equal(result.code, "unsupported_schema");
});

test("rejects malformed checkpoint phases", () => {
  const result = validateCheckpointRun(run({ phase: "unknown" }), 2);
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_phase");
});
