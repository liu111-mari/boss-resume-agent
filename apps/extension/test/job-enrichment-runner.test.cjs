const test = require("node:test");
const assert = require("node:assert/strict");

const { createJobEnrichmentRunner } = require("../src/job-enrichment-runner.cjs");

function job(id) {
  return { id, detailUrl: `https://www.zhipin.com/job_detail/${id}.html` };
}

test("enriches detail pages sequentially, paces requests, and closes tabs", async () => {
  const events = [];
  let nextTabId = 1;
  const runner = createJobEnrichmentRunner({
    createTab: async (url) => {
      events.push(`open:${url}`);
      return { id: nextTabId++ };
    },
    waitForTab: async (tabId) => events.push(`wait:${tabId}`),
    collectTab: async (tabId) => {
      events.push(`collect:${tabId}`);
      return { ok: true, message: "已采集 1 个岗位" };
    },
    closeTab: async (tabId) => events.push(`close:${tabId}`),
    delay: async (ms) => events.push(`delay:${ms}`),
    settleMs: 100,
    pacingMs: 200
  });

  const result = await runner.runJobs([job("job-1"), job("job-2")]);

  assert.deepEqual(result, {
    ok: true,
    reason: "completed",
    total: 2,
    completed: 2,
    failed: 0,
    message: "岗位详情补全完成：成功 2，失败 0"
  });
  assert.deepEqual(events, [
    "open:https://www.zhipin.com/job_detail/job-1.html",
    "wait:1",
    "delay:100",
    "collect:1",
    "close:1",
    "delay:200",
    "open:https://www.zhipin.com/job_detail/job-2.html",
    "wait:2",
    "delay:100",
    "collect:2",
    "close:2"
  ]);
});

test("stops the batch immediately when BOSS reports login or verification risk", async () => {
  const opened = [];
  const runner = createJobEnrichmentRunner({
    createTab: async (url) => {
      opened.push(url);
      return { id: opened.length };
    },
    waitForTab: async () => {},
    collectTab: async () => ({ ok: false, message: "检测到验证码/登录/安全提示，已暂停" }),
    closeTab: async () => {},
    delay: async () => {},
    settleMs: 0,
    pacingMs: 0
  });

  const result = await runner.runJobs([job("job-1"), job("job-2")]);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "paused");
  assert.equal(result.completed, 0);
  assert.equal(result.failed, 1);
  assert.equal(opened.length, 1);
});

test("rejects a second enrichment run while one is active", async () => {
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const runner = createJobEnrichmentRunner({
    createTab: async () => ({ id: 1 }),
    waitForTab: async () => blocked,
    collectTab: async () => ({ ok: true }),
    closeTab: async () => {},
    delay: async () => {},
    settleMs: 0,
    pacingMs: 0
  });

  const first = runner.runJobs([job("job-1")]);
  const second = await runner.runJobs([job("job-2")]);
  release();
  await first;

  assert.deepEqual(second, {
    ok: false,
    reason: "already_running",
    total: 0,
    completed: 0,
    failed: 0,
    message: "岗位详情补全正在执行中"
  });
});
