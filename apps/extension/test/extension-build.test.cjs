const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

test("build emits Chrome-loadable JavaScript files instead of CJS content scripts", () => {
  const appRoot = path.join(__dirname, "..");
  execFileSync(process.execPath, [path.join(appRoot, "scripts", "build-extension.mjs")], {
    cwd: appRoot,
    stdio: "pipe"
  });

  const dist = path.join(appRoot, "dist");
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, "manifest.json"), "utf8"));
  const background = fs.readFileSync(path.join(dist, "background.js"), "utf8");

  assert.deepEqual(manifest.content_scripts[0].js, [
    "job-extractor.js",
    "boss-page-adapter.js",
    "content.js"
  ]);
  assert.match(background, /import "\.\/task-runner\.js";/);
  assert.match(background, /import "\.\/job-enrichment-runner\.js";/);
  assert.equal(fs.existsSync(path.join(dist, "job-extractor.js")), true);
  assert.equal(fs.existsSync(path.join(dist, "boss-page-adapter.js")), true);
  assert.equal(fs.existsSync(path.join(dist, "task-runner.js")), true);
  assert.equal(fs.existsSync(path.join(dist, "job-enrichment-runner.js")), true);
  assert.equal(fs.existsSync(path.join(dist, "workbench-bridge.js")), true);
  assert.deepEqual(manifest.content_scripts[1], {
    matches: ["http://localhost:3000/*"],
    js: ["workbench-bridge.js"],
    run_at: "document_start"
  });
  assert.equal(
    fs.readdirSync(dist, { recursive: true }).some((name) => String(name).endsWith(".cjs")),
    false
  );
});
