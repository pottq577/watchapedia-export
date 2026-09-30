"use strict";

const { parseCsv } = require("./core/csv");
const {
  parseRatingsPage,
  normalizeRating,
  ratingsUrl,
  mergeWithExisting,
} = require("./core/ratings");
const { validateCheckpointRun } = require("./core/checkpoint");

function createWorkflow({
  config,
  client,
  storage,
  metadata,
  files,
  ui,
  env = globalThis,
}) {
  let running = false;

  async function createCheckpointRun(mode, oldRows = [], sourceFileName = "") {
    const userCode = await client.getCurrentUserCode();
    const now = new Date().toISOString();
    const run = {
      id: config.CHECKPOINT_ID,
      schema_version: config.CHECKPOINT_SCHEMA_VERSION,
      mode,
      phase: "ratings",
      user_code: userCode,
      source_file_name: sourceFileName,
      created_at: now,
      updated_at: now,
      old_rows: mode === "update" ? oldRows : [],
      current_rows: [],
      ratings_state: {
        stage: "movies",
        next: ratingsUrl(userCode, "movies"),
        movies: 0,
        series: 0,
      },
      merge_stats: null,
      detail_failures: [],
    };
    await storage.saveRun(run);
    await refreshCheckpointUi();
    return run;
  }

  async function collectRatingsWithCheckpoint(run) {
    while (run.phase === "ratings") {
      const ratingsState = run.ratings_state;

      if (!ratingsState.next) {
        if (ratingsState.stage === "movies") {
          ratingsState.stage = "tv_seasons";
          ratingsState.next = ratingsUrl(run.user_code, "tv_seasons");
          await storage.saveRun(run);
          continue;
        }

        run.phase = "details";
        if (run.mode === "update") {
          const merged = mergeWithExisting(
            run.current_rows,
            run.old_rows ?? [],
          );
          run.current_rows = merged.rows;
          run.merge_stats = {
            old: run.old_rows?.length ?? 0,
            current: merged.rows.length,
            added: merged.added,
            changed: merged.changed,
            removed: merged.removed,
            reused: merged.reused,
          };
          run.old_rows = [];
        }
        await storage.saveRun(run);
        break;
      }

      const isMovie = ratingsState.stage === "movies";
      const type = isMovie ? "movie" : "series";
      ui.setStatus(
        `${isMovie ? "영화" : "시리즈"} 평가 수집 중 · ${
          isMovie ? ratingsState.movies : ratingsState.series
        }개`,
      );

      const parsed = parseRatingsPage(
        await client.requestJson(ratingsState.next),
      );
      const normalized = parsed.items.map((item) =>
        normalizeRating(item, type),
      );
      run.current_rows.push(...normalized);
      if (isMovie) ratingsState.movies += normalized.length;
      else ratingsState.series += normalized.length;
      ratingsState.next = parsed.next;
      await storage.saveRun(run);
    }
    return run;
  }

  async function confirmReplaceCheckpoint() {
    const checkpoint = await storage.loadRun();
    if (!checkpoint) return true;
    const confirmed = env.confirm(
      "중단된 수집 작업이 있습니다. 새 작업을 시작하면 기존 임시 저장 내용을 삭제합니다. 계속할까요?",
    );
    if (!confirmed) return false;
    await storage.clear();
    await refreshCheckpointUi();
    return true;
  }

  function formatRunSummary(run, metadataWarnings = 0) {
    const warning = metadataWarnings
      ? ` · 메타데이터 누락 ${metadataWarnings}`
      : "";
    if (run.mode === "update") {
      const stats = run.merge_stats ?? {};
      return `업데이트 완료 · 총 ${run.current_rows.length} · 신규 ${stats.added ?? 0} · 변경 ${stats.changed ?? 0} · 삭제 ${stats.removed ?? 0}${warning}`;
    }
    return `새 백업 완료 · 영화 ${run.ratings_state.movies} · 시리즈 ${run.ratings_state.series} · 총 ${run.current_rows.length}${warning}`;
  }

  async function executeCheckpointRun(run) {
    const validation = validateCheckpointRun(
      run,
      config.CHECKPOINT_SCHEMA_VERSION,
    );
    if (!validation.ok) throw new Error(validation.reason);

    if (run.phase === "ratings") run = await collectRatingsWithCheckpoint(run);

    const hydrated = await storage.hydrateRows(run);
    const rows = hydrated.rows;
    run.current_rows = rows;

    if (run.mode === "update" && run.merge_stats) {
      const stats = run.merge_stats;
      const detailTargets = rows.filter((row) => {
        if (row.genres && row.countries) return false;
        return (
          hydrated.progressByCode.get(row.content_code)?.status !== "complete"
        );
      }).length;
      ui.setSummary(
        `업데이트 비교 · 기존 ${stats.old} · 현재 ${stats.current} · 신규 ${stats.added} · 변경 ${stats.changed} · 삭제 ${stats.removed} · 상세조회 ${detailTargets}`,
      );
    }

    const result = await metadata.enrichRows({
      rows,
      client,
      storage,
      progressByCode: hydrated.progressByCode,
      ui,
      persistProgress: true,
    });
    run.current_rows = rows;
    run.detail_failures = result.failedRows.map((item) => ({
      content_code: item.content_code,
      title: item.title,
      message:
        item.error instanceof Error ? item.error.message : String(item.error),
    }));
    await storage.saveRun(run);

    if (result.failedRows.length) {
      ui.setStatus("일부 상세 정보 수집에 실패했습니다.");
      ui.setSummary(
        `상세 정보 ${result.failedRows.length}건 실패 · 완료된 진행상태는 보존했습니다. 잠시 후 중단된 작업 이어서 진행으로 실패 항목만 다시 시도하세요.`,
      );
      return false;
    }

    files.downloadCsv(rows, config.CSV_COLUMNS, env);
    const metadataWarnings = rows.filter(
      (row) => !row.genres || !row.countries,
    ).length;
    const summary = formatRunSummary(run, metadataWarnings);
    await storage.clear();
    await refreshCheckpointUi();
    ui.setStatus("완료");
    ui.setSummary(summary);
    return true;
  }

  async function runInitialBackup() {
    if (!(await confirmReplaceCheckpoint())) return;
    await executeCheckpointRun(await createCheckpointRun("initial"));
  }

  async function runUpdateBackup() {
    ui.setStatus("기존 WatchaPedia CSV를 선택해 주세요.");
    const file = await files.selectCsvFile(env.document);
    const oldRows = parseCsv(await file.text());
    if (!(await confirmReplaceCheckpoint())) return;
    const run = await createCheckpointRun("update", oldRows, file.name);
    ui.setStatus(
      `기존 백업 ${oldRows.length}개 확인 · 현재 평가를 조회합니다.`,
    );
    await executeCheckpointRun(run);
  }

  async function runResumeBackup() {
    const run = await storage.loadRun();
    if (!run) {
      ui.setSummary("이어갈 중단 작업이 없습니다.");
      await refreshCheckpointUi();
      return;
    }

    const validation = validateCheckpointRun(
      run,
      config.CHECKPOINT_SCHEMA_VERSION,
    );
    if (!validation.ok) {
      throw new Error(
        `${validation.reason} 새 작업을 시작하면 기존 임시 데이터를 삭제할 수 있습니다.`,
      );
    }

    const currentUserCode = await client.getCurrentUserCode();
    if (currentUserCode !== run.user_code) {
      throw new Error(
        "임시 저장된 작업과 현재 로그인 계정이 다릅니다. 기존 작업을 이어갈 수 없습니다.",
      );
    }

    ui.setStatus(
      `중단된 ${run.mode === "update" ? "업데이트" : "새 백업"} 작업을 이어서 진행합니다.`,
    );
    await executeCheckpointRun(run);
  }

  async function refreshCheckpointUi() {
    try {
      const checkpoint = await storage.loadRun();
      if (!checkpoint) {
        ui.setResumeButton({ visible: false });
        return;
      }
      const validation = validateCheckpointRun(
        checkpoint,
        config.CHECKPOINT_SCHEMA_VERSION,
      );
      if (!validation.ok) {
        ui.setResumeButton({ visible: false });
        if (!running)
          ui.setStatus(`호환되지 않는 중단 작업 있음 · ${validation.reason}`);
        return;
      }
      const kind = checkpoint.mode === "update" ? "업데이트" : "새 백업";
      const phase =
        checkpoint.phase === "ratings" ? "평가 목록 수집" : "상세 정보 수집";
      ui.setResumeButton({ visible: true, text: `중단된 ${kind} 이어서 진행` });
      if (!running) ui.setStatus(`중단된 작업 있음 · ${phase} 단계`);
    } catch (error) {
      console.error("[WatchaPedia Exporter] checkpoint lookup failed", error);
    }
  }

  async function run(action) {
    if (running) return;
    running = true;
    ui.setButtonsDisabled(true);
    try {
      client.prepare();
      if (action === "initial") await runInitialBackup();
      else if (action === "update") await runUpdateBackup();
      else await runResumeBackup();
    } catch (error) {
      console.error("[WatchaPedia Exporter]", error);
      ui.setSummary(
        `실패 · ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      running = false;
      ui.setButtonsDisabled(false);
      await refreshCheckpointUi();
    }
  }

  return { run, refreshCheckpointUi };
}

module.exports = { createWorkflow };
