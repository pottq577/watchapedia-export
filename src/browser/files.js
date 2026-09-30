"use strict";

const { buildCsv } = require("../core/csv");

function selectCsvFile(documentRef = document) {
  return new Promise((resolve, reject) => {
    const input = documentRef.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.style.display = "none";
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        input.remove();
        if (file) resolve(file);
        else reject(new Error("CSV 파일 선택이 취소되었습니다."));
      },
      { once: true },
    );
    documentRef.body.appendChild(input);
    input.click();
  });
}

function localDateString(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function downloadCsv(rows, columns, env = globalThis) {
  const documentRef = env.document;
  const blob = new env.Blob(["\uFEFF", buildCsv(rows, columns)], {
    type: "text/csv;charset=utf-8",
  });
  const url = env.URL.createObjectURL(blob);
  const anchor = documentRef.createElement("a");
  anchor.href = url;
  anchor.download = `watchapedia-ratings-${localDateString()}.csv`;
  documentRef.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  env.setTimeout(() => env.URL.revokeObjectURL(url), 1_000);
}

module.exports = { selectCsvFile, localDateString, downloadCsv };
