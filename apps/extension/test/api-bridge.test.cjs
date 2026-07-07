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
  assert.match(content, /job_detail/);
  assert.match(content, /location\.href/);
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
  assert.doesNotMatch(content, /textarea|contenteditable/);
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

test("popup checks local workbench before opening it", () => {
  const html = fs.readFileSync(path.join(__dirname, "../src/popup.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "../src/popup.js"), "utf8");

  assert.match(html, /id="openWorkbench"/);
  assert.doesNotMatch(html, /<a[^>]+href="http:\/\/localhost:3000"[^>]*>打开工作台<\/a>/);
  assert.match(script, /const WORKBENCH_URL = "http:\/\/localhost:3000"/);
  assert.match(script, /async function openWorkbenchWhenReady/);
  assert.match(script, /fetch\(WORKBENCH_URL/);
  assert.match(script, /chrome\.tabs\.create\(\{\s*url:\s*WORKBENCH_URL\s*\}\)/);
  assert.match(script, /本地工作台未启动/);
});

test("repository includes a Windows one-click workbench launcher", () => {
  const launcher = fs.readFileSync(path.join(__dirname, "../../../start-workbench.bat"), "utf8");

  assert.match(launcher, /npm run dev/);
  assert.match(launcher, /http:\/\/localhost:3000/);
  assert.match(launcher, /pause/i);
});

test("workbench bridge accepts only same-window localhost requests and preserves request ids", () => {
  const bridge = fs.readFileSync(path.join(__dirname, "../src/workbench-bridge.js"), "utf8");

  assert.match(bridge, /http:\/\/localhost:3000/);
  assert.match(bridge, /event\.source\s*!==\s*window/);
  assert.match(bridge, /event\.origin\s*!==\s*WORKBENCH_ORIGIN/);
  assert.match(bridge, /boss-agent-workbench/);
  assert.match(bridge, /boss-agent-extension/);
  assert.match(bridge, /requestId/);
  assert.match(bridge, /BOSS_AGENT_BRIDGE_PING/);
  assert.match(bridge, /BOSS_AGENT_BRIDGE_READY/);
});

test("workbench bridge forwards only approved-task execution to the background", () => {
  const bridge = fs.readFileSync(path.join(__dirname, "../src/workbench-bridge.js"), "utf8");

  assert.match(bridge, /message\.type\s*!==\s*"RUN_APPROVED_TASKS"/);
  assert.match(bridge, /chrome\.runtime\.sendMessage\(\{\s*type:\s*"RUN_APPROVED_TASKS"\s*\}\)/);
  assert.match(bridge, /RUN_APPROVED_TASKS_RESULT/);
});

test("background acknowledges a batch immediately and rejects duplicate starts", () => {
  const background = fs.readFileSync(path.join(__dirname, "../src/background.js"), "utf8");

  assert.match(background, /let activeRun = null/);
  assert.match(background, /if \(activeRun\)[\s\S]*reason: "already_running"/);
  assert.match(background, /activeRun = runner\.runApprovedTasks\(\)/);
  assert.match(background, /reason: "started"/);
  assert.doesNotMatch(background, /runner\.runApprovedTasks\(\)\.then\(sendResponse\)/);
});
