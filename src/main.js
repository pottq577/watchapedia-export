"use strict";

const config = require("./config");
const { createCheckpointStorage } = require("./browser/storage");
const { createWatchaClient } = require("./browser/watchapedia");
const metadata = require("./browser/metadata");
const files = require("./browser/files");
const { createUi } = require("./ui");
const { createWorkflow } = require("./workflow");

function main(env = globalThis) {
  if (env.document.querySelector("#wpe-launcher")) return;

  const ui = createUi(env.document);
  const storage = createCheckpointStorage(config, env);
  const client = createWatchaClient({ config, ui, env });
  const workflow = createWorkflow({
    config,
    client,
    storage,
    metadata,
    files,
    ui,
    env,
  });
  ui.setActionHandler((action) => workflow.run(action));
  workflow.refreshCheckpointUi();
}

main();

module.exports = { main };
