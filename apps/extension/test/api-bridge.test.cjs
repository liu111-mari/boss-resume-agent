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

test("job extractor and BOSS page adapter load before the content script", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../src/manifest.json"), "utf8"));
  const scripts = manifest.content_scripts[0].js;

  assert.deepEqual(scripts, ["job-extractor.cjs", "boss-page-adapter.cjs", "content.js"]);
});

test("content script automatically collects jobs on supported BOSS job pages", () => {
  const content = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");

  assert.match(content, /scheduleAutomaticJobCollection/);
  assert.match(content, /MutationObserver/);
  assert.match(content, /web\/geek\/jobs/);
});

test("content script delegates greeting interactions to BossPageAdapter", () => {
  const content = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");

  assert.match(content, /INSPECT_GREETING_PAGE/);
  assert.match(content, /PREPARE_GREETING/);
  assert.match(content, /SEND_GREETING_IN_CHAT/);
  assert.match(content, /BossPageAdapter\.inspectGreetingPage\(document/);
  assert.match(content, /BossPageAdapter\.prepareGreeting\(document,\s*window/);
  assert.match(content, /BossPageAdapter\.sendGreetingInChat\(document,\s*window,\s*message\.task/);
  assert.match(content, /BossPageAdapter\.getVisibleJobSignature\(document/);
  assert.doesNotMatch(content, /COLLECT_CONVERSATIONS/);
  assert.doesNotMatch(content, /function\s+(collectConversations|sendGreeting|hasRiskBlocker|findEditor|setEditorText|findClickable|delay)\b/);
  assert.doesNotMatch(content, /\.(querySelector|querySelectorAll|closest|matches)\s*\(/);
  assert.doesNotMatch(content, /textarea|contenteditable|job_detail/);
});

test("popup no longer exposes conversation collection", () => {
  const html = fs.readFileSync(path.join(__dirname, "../src/popup.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "../src/popup.js"), "utf8");

  assert.doesNotMatch(html, /collectConversations|采集消息线索/);
  assert.doesNotMatch(script, /collectConversations|COLLECT_CONVERSATIONS/);
});

test("background reinjects page scripts, inspects chat targets, and closes completed task tabs", () => {
  const background = fs.readFileSync(path.join(__dirname, "../src/background.js"), "utf8");

  assert.match(background, /function\s+sendToBossTab/);
  assert.match(background, /Receiving end does not exist|Could not establish connection/);
  assert.match(
    background,
    /files:\s*\[\s*"job-extractor\.js",\s*"boss-page-adapter\.js",\s*"content\.js"\s*\]/
  );
  assert.match(background, /inspectTab:\s*\(tabId\).*INSPECT_GREETING_PAGE/s);
  assert.match(background, /closeTab:\s*\(tabId\).*chrome\.tabs\.remove/s);
  assert.match(background, /tabs:\s*chrome\.tabs/);
});

test("popup injects the content scripts and retries when a BOSS tab has no receiver", () => {
  const script = fs.readFileSync(path.join(__dirname, "../src/popup.js"), "utf8");

  assert.match(script, /chrome\.scripting\.executeScript/);
  assert.match(
    script,
    /files:\s*\[\s*"job-extractor\.js",\s*"boss-page-adapter\.js",\s*"content\.js"\s*\]/
  );
  assert.match(script, /Receiving end does not exist|Could not establish connection/);
});
