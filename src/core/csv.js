"use strict";

function parseCsv(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const table = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      table.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }

  if (quoted) {
    throw new Error("CSV의 따옴표가 닫히지 않았습니다.");
  }

  if (value.length || row.length) {
    row.push(value);
    table.push(row);
  }

  if (!table.length) return [];

  const headers = table[0].map((header) => header.trim());
  const missing = ["content_code"].filter(
    (header) => !headers.includes(header),
  );
  if (missing.length) {
    throw new Error(
      `지원하지 않는 CSV입니다. 필수 컬럼 누락: ${missing.join(", ")}`,
    );
  }

  return table
    .slice(1)
    .filter((values) => values.some((item) => item !== ""))
    .map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [header, values[index] ?? ""]),
      ),
    );
}

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function buildCsv(rows, columns) {
  return [
    columns.join(","),
    ...rows.map((row) =>
      columns.map((column) => csvEscape(row[column])).join(","),
    ),
  ].join("\r\n");
}

module.exports = { parseCsv, csvEscape, buildCsv };
