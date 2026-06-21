const test = require("node:test");
const assert = require("node:assert/strict");

const { createTaskRunner, waitForTabComplete } = require("../src/task-runner.cjs");

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

test("a click without confirmation evidence never posts sent", async () => {
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
    sendMessage: async () => ({ ok: true }),
    delay: async () => {}
  });

  await runner.runApprovedTasks();
  assert.deepEqual(updates.map((item) => item.status), ["sending", "failed"]);
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
