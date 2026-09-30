"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractUserCodeFromMeResponse,
  extractUserCodeFromInitialData,
  extractUserCodeFromScriptTexts,
} = require("../src/core/identity");

test("extracts user code from /api/users/me response", () => {
  assert.equal(extractUserCodeFromMeResponse({ result: { code: "user-1" } }), "user-1");
});

test("initial data fallback only accepts one unambiguous explicit userCode", () => {
  const data = {
    page: {
      action: { userCode: "user-1" },
      nested: [{ user_code: "user-1" }],
    },
    content: { code: "content-code" },
  };
  assert.equal(extractUserCodeFromInitialData(data), "user-1");
});

test("initial data fallback rejects ambiguous user codes", () => {
  assert.equal(
    extractUserCodeFromInitialData({ a: { userCode: "u1" }, b: { userCode: "u2" } }),
    "",
  );
});


test("script fallback accepts only one explicit serialized userCode", () => {
  assert.equal(
    extractUserCodeFromScriptTexts([
      'window.x = ["userCode","user-1","contentCode","m1"]',
      '{"user_code":"user-1"}',
    ]),
    "user-1",
  );
});

test("script fallback rejects ambiguous serialized user codes", () => {
  assert.equal(
    extractUserCodeFromScriptTexts([
      '{"userCode":"u1"}',
      '{"userCode":"u2"}',
    ]),
    "",
  );
});
