"use strict";

const { progressMap } = require("../core/checkpoint");

function createCheckpointStorage(config, env = globalThis) {
  const indexedDBRef = env.indexedDB;
  const IDBKeyRangeRef = env.IDBKeyRange;

  if (!indexedDBRef || !IDBKeyRangeRef) {
    throw new Error("이 브라우저에서는 IndexedDB를 사용할 수 없습니다.");
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDBRef.open(
        config.CHECKPOINT_DB_NAME,
        config.CHECKPOINT_DB_VERSION,
      );
      request.addEventListener("upgradeneeded", () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(config.CHECKPOINT_RUN_STORE)) {
          db.createObjectStore(config.CHECKPOINT_RUN_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(config.CHECKPOINT_PROGRESS_STORE)) {
          const store = db.createObjectStore(config.CHECKPOINT_PROGRESS_STORE, {
            keyPath: ["run_id", "content_code"],
          });
          store.createIndex("run_id", "run_id", { unique: false });
        }
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () =>
        reject(request.error ?? new Error("IndexedDB를 열 수 없습니다.")),
      );
    });
  }

  function waitForTransaction(transaction) {
    return new Promise((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve());
      transaction.addEventListener("abort", () =>
        reject(transaction.error ?? new Error("IndexedDB 작업이 중단되었습니다.")),
      );
      transaction.addEventListener("error", () =>
        reject(transaction.error ?? new Error("IndexedDB 작업에 실패했습니다.")),
      );
    });
  }

  function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () =>
        reject(request.error ?? new Error("IndexedDB 요청에 실패했습니다.")),
      );
    });
  }

  async function loadRun() {
    const db = await openDb();
    try {
      const transaction = db.transaction(config.CHECKPOINT_RUN_STORE, "readonly");
      const request = transaction
        .objectStore(config.CHECKPOINT_RUN_STORE)
        .get(config.CHECKPOINT_ID);
      return (await requestValue(request)) ?? null;
    } finally {
      db.close();
    }
  }

  async function saveRun(run) {
    const db = await openDb();
    try {
      const transaction = db.transaction(config.CHECKPOINT_RUN_STORE, "readwrite");
      run.updated_at = new Date().toISOString();
      transaction.objectStore(config.CHECKPOINT_RUN_STORE).put(run);
      await waitForTransaction(transaction);
    } finally {
      db.close();
    }
  }

  async function saveProgress(row, status = "complete", error = "") {
    const db = await openDb();
    try {
      const transaction = db.transaction(
        config.CHECKPOINT_PROGRESS_STORE,
        "readwrite",
      );
      transaction.objectStore(config.CHECKPOINT_PROGRESS_STORE).put({
        run_id: config.CHECKPOINT_ID,
        content_code: row.content_code,
        genres: row.genres ?? "",
        countries: row.countries ?? "",
        status,
        error,
        updated_at: new Date().toISOString(),
      });
      await waitForTransaction(transaction);
    } finally {
      db.close();
    }
  }

  async function loadProgress() {
    const db = await openDb();
    try {
      const transaction = db.transaction(
        config.CHECKPOINT_PROGRESS_STORE,
        "readonly",
      );
      const request = transaction
        .objectStore(config.CHECKPOINT_PROGRESS_STORE)
        .index("run_id")
        .getAll(config.CHECKPOINT_ID);
      return (await requestValue(request)) ?? [];
    } finally {
      db.close();
    }
  }

  async function clear() {
    const db = await openDb();
    try {
      const transaction = db.transaction(
        [config.CHECKPOINT_RUN_STORE, config.CHECKPOINT_PROGRESS_STORE],
        "readwrite",
      );
      transaction
        .objectStore(config.CHECKPOINT_RUN_STORE)
        .delete(config.CHECKPOINT_ID);

      const cursorRequest = transaction
        .objectStore(config.CHECKPOINT_PROGRESS_STORE)
        .index("run_id")
        .openCursor(IDBKeyRangeRef.only(config.CHECKPOINT_ID));
      cursorRequest.addEventListener("success", () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      });
      await waitForTransaction(transaction);
    } finally {
      db.close();
    }
  }

  async function hydrateRows(run) {
    const rows = (run.current_rows ?? []).map((row) => ({ ...row }));
    const progress = await loadProgress();
    const byCode = progressMap(progress);

    for (const row of rows) {
      const saved = byCode.get(row.content_code);
      if (!saved || saved.status !== "complete") continue;
      row.genres = saved.genres ?? row.genres ?? "";
      row.countries = saved.countries ?? row.countries ?? "";
    }

    return { rows, progressByCode: byCode };
  }

  return { loadRun, saveRun, saveProgress, loadProgress, clear, hydrateRows };
}

module.exports = { createCheckpointStorage };
