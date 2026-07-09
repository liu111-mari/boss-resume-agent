const test = require("node:test");
const assert = require("node:assert/strict");

const { createTaskRunner, waitForChatTarget, waitForTabComplete } = require("../src/task-runner.cjs");

function createChromeTabsHarness() {
  const listeners = new Set();
  return {
    listeners,
    tabs: {
      onUpdated: {
        addListener(listener) {
          listeners.add(listener);
        },
        removeListener(listener) {
          listeners.delete(listener);
        }
      }
    }
  };
}

test("tab load timeout rejects and always removes its listener", async () => {
  const harness = createChromeTabsHarness();
  await assert.rejects(
    waitForTabComplete(harness.tabs, 7, 10),
    /tab_load_timeout/
  );
  assert.equal(harness.listeners.size, 0);
});

test("waitForChatTarget accepts a ready chat in the source tab", async () => {
  const tabs = {
    get: async () => ({ id: 7, url: "https://www.zhipin.com/web/geek/chat" }),
    query: async () => []
  };

  const result = await waitForChatTarget(
    tabs,
    7,
    async () => ({ ok: true, state: "ready" }),
    async () => {}
  );

  assert.equal(result.ok, true);
  assert.equal(result.tab.id, 7);
});

test("waitForChatTarget follows an opener-linked BOSS chat tab", async () => {
  const tabs = {
    get: async () => ({ id: 7, url: "https://www.zhipin.com/job_detail/example.html" }),
    query: async () => [{ id: 8, openerTabId: 7, url: "https://www.zhipin.com/web/geek/chat" }]
  };

  const result = await waitForChatTarget(
    tabs,
    7,
    async (tabId) => tabId === 8
      ? { ok: true, state: "ready" }
      : { ok: true, state: "entry_available" },
    async () => {}
  );

  assert.equal(result.ok, true);
  assert.equal(result.tab.id, 8);
});

test("waitForChatTarget retries missing receivers and stops on a risk result", async () => {
  let attempts = 0;
  const tabs = {
    get: async () => ({ id: 7, url: "https://www.zhipin.com/web/geek/chat" }),
    query: async () => []
  };

  const result = await waitForChatTarget(
    tabs,
    7,
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Receiving end does not exist");
      return { ok: false, pause: true, code: "risk_blocker", error: "检测到安全验证" };
    },
    async () => {},
    { now: (() => { let time = 0; return () => (time += 100); })(), timeoutMs: 1000, pollMs: 100 }
  );

  assert.equal(attempts, 2);
  assert.equal(result.ok, false);
  assert.equal(result.code, "risk_blocker");
});

test("waitForChatTarget tolerates a transient missing entry after the communication click", async () => {
  let attempts = 0;
  const tabs = {
    get: async () => ({ id: 7, url: "https://www.zhipin.com/web/geek/chat" }),
    query: async () => []
  };

  const result = await waitForChatTarget(
    tabs,
    7,
    async () => {
      attempts += 1;
      return attempts === 1
        ? { ok: false, pause: true, code: "communication_entry_missing" }
        : { ok: true, state: "ready" };
    },
    async () => {},
    { now: (() => { let time = 0; return () => (time += 100); })(), timeoutMs: 1000, pollMs: 100 }
  );

  assert.equal(result.ok, true);
  assert.equal(attempts, 2);
});

test("waitForChatTarget advances a newly appeared already-sent dialog and waits for chat readiness", async () => {
  let inspections = 0;
  const advancedTabs = [];
  const tabs = {
    get: async () => ({ id: 7, url: "https://www.zhipin.com/job_detail/example.html" }),
    query: async () => []
  };

  const result = await waitForChatTarget(
    tabs,
    7,
    async () => {
      inspections += 1;
      return inspections === 1
        ? { ok: true, state: "continue_required" }
        : { ok: true, state: "ready" };
    },
    async () => {},
    {
      advanceTab: async (tabId) => {
        advancedTabs.push(tabId);
        return { ok: true, state: "opening_chat", interactionAttempted: true };
      },
      now: (() => { let time = 0; return () => (time += 100); })(),
      timeoutMs: 1000,
      pollMs: 100
    }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(advancedTabs, [7]);
});

test("waitForChatTarget stops with a specific error when an already-sent dialog cannot be advanced", async () => {
  let time = 0;
  let advances = 0;
  const result = await waitForChatTarget(
    {
      get: async () => ({ id: 7, url: "https://www.zhipin.com/job_detail/example.html" }),
      query: async () => []
    },
    7,
    async () => ({ ok: true, state: "continue_required" }),
    async (ms) => { time += ms; },
    {
      advanceTab: async () => {
        advances += 1;
        return { ok: true, state: "opening_chat", interactionAttempted: true };
      },
      maxAdvanceAttempts: 2,
      now: () => time,
      timeoutMs: 1000,
      pollMs: 10
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "continue_dialog_stuck");
  assert.equal(advances, 2);
});

test("waitForChatTarget returns a stage-specific timeout", async () => {
  let time = 0;
  const result = await waitForChatTarget(
    {
      get: async () => ({ id: 7, url: "https://www.zhipin.com/job_detail/example.html" }),
      query: async () => []
    },
    7,
    async () => ({ ok: true, state: "entry_available" }),
    async (ms) => { time += ms; },
    { now: () => time, timeoutMs: 20, pollMs: 10 }
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "wait_chat_timeout");
  assert.equal(result.pause, true);
});

test("runner marks a ready chat as a platform-default greeting without sending custom text", async () => {
  const updates = [];
  const sentMessages = [];
  const closedTabs = [];
  let claimed = false;
  const runner = createTaskRunner({
    request: async (path, options = {}) => {
      if (path === "/api/tasks/approved") {
        if (claimed) return { tasks: [], quota: { used: 1, limit: 5, reserved: 0, remaining: 4, blocked: false } };
        claimed = true;
        return {
          tasks: [{ id: "task-1", status: "sending", detailUrl: "https://www.zhipin.com/job_detail/1", messageDraft: "您好" }],
          quota: { used: 0, limit: 5, reserved: 1, remaining: 4, blocked: false }
        };
      }
      const update = JSON.parse(options.body);
      updates.push(update);
      return { task: { id: update.taskId, status: update.status } };
    },
    createTab: async () => ({ id: 1 }),
    waitForTab: async () => {},
    tabs: {
      get: async () => ({ id: 1, url: "https://www.zhipin.com/job_detail/1" }),
      query: async () => [{ id: 2, openerTabId: 1, url: "https://www.zhipin.com/web/geek/chat" }]
    },
    inspectTab: async (tabId) => tabId === 2
      ? { ok: true, state: "ready" }
      : { ok: true, state: "entry_available" },
    sendMessage: async (tabId, message) => {
      sentMessages.push({ tabId, type: message.type });
      if (message.type === "PREPARE_GREETING") return { ok: true, state: "opening_chat" };
      throw new Error("custom greeting send must not run");
    },
    closeTab: async (tabId) => closedTabs.push(tabId),
    delay: async () => {},
    settleMs: 0,
    pacingMs: 0
  });

  const result = await runner.runApprovedTasks();

  assert.equal(result.reason, "completed");
  assert.deepEqual(sentMessages, [{ tabId: 1, type: "PREPARE_GREETING" }]);
  assert.deepEqual(updates.map((item) => item.status), ["sending", "sent"]);
  assert.deepEqual(JSON.parse(updates[1].confirmationEvidence), {
    type: "platform_default_greeting",
    state: "chat_ready"
  });
  assert.deepEqual(closedTabs.sort((left, right) => left - right), [1, 2]);
});

test("a pre-click page mismatch fails one task and continues the approved batch", async () => {
  const updates = [];
  const preparedTaskIds = [];
  const tasks = [
    { id: "task-1", status: "sending", detailUrl: "https://www.zhipin.com/job_detail/1" },
    { id: "task-2", status: "sending", detailUrl: "https://www.zhipin.com/job_detail/2" }
  ];
  let claimed = 0;
  let opened = 0;
  const runner = createTaskRunner({
    request: async (path, options = {}) => {
      if (path === "/api/tasks/approved") {
        if (claimed >= tasks.length) {
          return { tasks: [], quota: { used: 1, limit: 5, reserved: 0, remaining: 4, blocked: false } };
        }
        const task = tasks[claimed++];
        return {
          tasks: [task],
          quota: { used: 0, limit: 5, reserved: 1, remaining: 4, blocked: false }
        };
      }
      const update = JSON.parse(options.body);
      updates.push(update);
      return { task: { id: update.taskId, status: update.status } };
    },
    createTab: async () => ({ id: ++opened }),
    waitForTab: async () => {},
    sendMessage: async (_tabId, message) => {
      preparedTaskIds.push(message.task.id);
      return message.task.id === "task-1"
        ? {
            ok: false,
            pause: true,
            interactionAttempted: false,
            code: "communication_entry_missing",
            error: "未找到沟通入口"
          }
        : { ok: true, state: "ready" };
    },
    closeTab: async () => {},
    delay: async () => {},
    settleMs: 0,
    pacingMs: 0
  });

  const result = await runner.runApprovedTasks();

  assert.equal(result.reason, "completed");
  assert.deepEqual(preparedTaskIds, ["task-1", "task-2"]);
  assert.deepEqual(updates.map((item) => [item.taskId, item.status]), [
    ["task-1", "sending"],
    ["task-1", "failed"],
    ["task-2", "sending"],
    ["task-2", "sent"]
  ]);
});

test("quota blocked stops before opening a tab", async () => {
  let opened = 0;
  const runner = createTaskRunner({
    request: async () => ({
      tasks: [],
      quota: { used: 1, limit: 1, reserved: 0, remaining: 0, blocked: true }
    }),
    createTab: async () => {
      opened += 1;
      return { id: 1 };
    },
    waitForTab: async () => {},
    sendMessage: async () => ({ ok: true, confirmationEvidence: "message:1" }),
    delay: async () => {}
  });

  const result = await runner.runApprovedTasks();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "quota_blocked");
  assert.equal(opened, 0);
});

test("a failed task is marked failed", async () => {
  const updates = [];
  let claimed = false;
  const runner = createTaskRunner({
    request: async (path, options = {}) => {
      if (path === "/api/tasks/approved") {
        if (claimed) return { tasks: [], quota: { used: 0, limit: 5, reserved: 0, remaining: 5, blocked: false } };
        claimed = true;
        return {
          tasks: [{ id: "task-1", status: "sending", detailUrl: "https://example.com", messageDraft: "您好" }],
          quota: { used: 0, limit: 5, reserved: 1, remaining: 4, blocked: false }
        };
      }
      const update = JSON.parse(options.body);
      updates.push(update);
      return { task: { id: update.taskId, status: update.status } };
    },
    createTab: async () => ({ id: 1 }),
    waitForTab: async () => {},
    sendMessage: async () => ({ ok: false, error: "editor_missing" }),
    delay: async () => {}
  });

  await runner.runApprovedTasks();
  assert.deepEqual(updates.map((item) => item.status), ["sending", "failed"]);
});

test("risk pause marks paused and stops the remaining loop", async () => {
  const updates = [];
  let opened = 0;
  const runner = createTaskRunner({
    request: async (path, options = {}) => {
      if (path === "/api/tasks/approved") {
        return {
          tasks: [{ id: "task-1", status: "sending", detailUrl: "https://example.com/1", messageDraft: "您好" }],
          quota: { used: 0, limit: 5, reserved: 1, remaining: 4, blocked: false }
        };
      }
      const update = JSON.parse(options.body);
      updates.push(update);
      return { task: { id: update.taskId, status: update.status } };
    },
    createTab: async () => ({ id: ++opened }),
    waitForTab: async () => {},
    sendMessage: async () => ({ ok: false, pause: true, error: "risk_blocker" }),
    delay: async () => {}
  });

  const result = await runner.runApprovedTasks();
  assert.equal(result.reason, "paused");
  assert.equal(opened, 1);
  assert.deepEqual(updates.map((item) => item.status), ["sending", "paused"]);
});

test("an already-ready chat is sufficient evidence for a platform-default greeting", async () => {
  const updates = [];
  let claimed = false;
  const runner = createTaskRunner({
    request: async (path, options = {}) => {
      if (path === "/api/tasks/approved") {
        if (claimed) return { tasks: [], quota: { used: 0, limit: 5, reserved: 0, remaining: 5, blocked: false } };
        claimed = true;
        return {
          tasks: [{ id: "task-1", status: "sending", detailUrl: "https://example.com", messageDraft: "您好" }],
          quota: { used: 0, limit: 5, reserved: 1, remaining: 4, blocked: false }
        };
      }
      const update = JSON.parse(options.body);
      updates.push(update);
      return { task: { id: update.taskId, status: update.status } };
    },
    createTab: async () => ({ id: 1 }),
    waitForTab: async () => {},
    sendMessage: async (_tabId, message) => {
      assert.equal(message.type, "PREPARE_GREETING");
      return { ok: true, state: "ready" };
    },
    delay: async () => {}
  });

  await runner.runApprovedTasks();
  assert.deepEqual(updates.map((item) => item.status), ["sending", "sent"]);
});

test("a malformed claimed task response stops before opening a tab", async () => {
  let opened = 0;
  const runner = createTaskRunner({
    request: async (path) => {
      if (path === "/api/tasks/approved") {
        return {
          tasks: [{ id: "task-1", status: "approved", detailUrl: "https://example.com", messageDraft: "您好" }],
          quota: { used: 0, limit: 5, reserved: 1, remaining: 4, blocked: false }
        };
      }
      throw new Error("unexpected status call");
    },
    createTab: async () => {
      opened += 1;
      return { id: 1 };
    },
    waitForTab: async () => {},
    sendMessage: async () => ({ ok: true, confirmationEvidence: "message:1" }),
    delay: async () => {}
  });

  const result = await runner.runApprovedTasks();
  assert.equal(result.reason, "malformed_api");
  assert.equal(opened, 0);
});

test("object confirmation evidence is persisted as sent and clears the local pending record", async () => {
  const updates = [];
  const pending = [];
  let claimed = false;
  const runner = createTaskRunner({
    request: async (path, options = {}) => {
      if (path === "/api/tasks/approved") {
        if (claimed) {
          return {
            tasks: [],
            quota: { used: 1, limit: 5, reserved: 0, remaining: 4, blocked: false }
          };
        }
        claimed = true;
        return {
          tasks: [{ id: "task-1", status: "sending", detailUrl: "https://example.com", messageDraft: "您好" }],
          quota: { used: 0, limit: 5, reserved: 1, remaining: 4, blocked: false }
        };
      }
      const update = JSON.parse(options.body);
      updates.push(update);
      return { task: { id: update.taskId, status: update.status } };
    },
    createTab: async () => ({ id: 1 }),
    waitForTab: async () => {},
    sendMessage: async () => ({ ok: true, confirmationEvidence: { id: "message-1", count: 1 } }),
    delay: async () => {},
    listPendingConfirmations: async () => pending.slice(),
    savePendingConfirmation: async (item) => pending.push(item),
    removePendingConfirmation: async (taskId) => {
      const index = pending.findIndex((item) => item.taskId === taskId);
      if (index >= 0) pending.splice(index, 1);
    }
  });

  const result = await runner.runApprovedTasks();
  assert.equal(result.reason, "completed");
  assert.deepEqual(updates.map((item) => item.status), ["sending", "sent"]);
  assert.deepEqual(JSON.parse(updates[1].confirmationEvidence), { id: "message-1", count: 1 });
  assert.deepEqual(pending, []);
});
