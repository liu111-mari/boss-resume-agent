const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("content script delegates local API calls to the extension background", () => {
  const content = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");
  const background = fs.readFileSync(path.join(__dirname, "../src/background.js"), "utf8");

  assert.match(content, /LOCAL_API_REQUEST/);
  assert.doesNotMatch(content, /fetch\(`\$\{API_BASE\}/);
  assert.match(background, /LOCAL_API_REQUEST/);
  assert.match(background, /fetch\(`\$\{API_BASE\}/);
});

test("job extractor loads before the content script", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../src/manifest.json"), "utf8"));
  const scripts = manifest.content_scripts[0].js;

  assert.deepEqual(scripts.slice(0, 2), ["job-extractor.cjs", "content.js"]);
});
