"use strict";

module.exports = {
  API_DELAY_MS: 300,
  DETAIL_DELAY_MS: 800,
  RETRY_LIMIT: 5,
  CHECKPOINT_DB_NAME: "watchapedia-exporter",
  CHECKPOINT_DB_VERSION: 1,
  CHECKPOINT_RUN_STORE: "runs",
  CHECKPOINT_PROGRESS_STORE: "progress",
  CHECKPOINT_ID: "active",
  CHECKPOINT_SCHEMA_VERSION: 3,
  CSV_COLUMNS: [
    "type",
    "title",
    "year",
    "rating",
    "rated_at",
    "genres",
    "countries",
    "content_code",
  ],
};
