import "./task-runner.cjs";

const API_BASE = "http://localhost:3000";

const runner = globalThis.GreetingTaskRunner.createTaskRunner({
  request: requestApi,
  createTab: (url) => chrome.tabs.create({ url, active: true }),
  waitForTab: (tabId) =>
    globalThis.GreetingTaskRunner.waitForTabComplete(chrome.tabs, tabId, 15_000),
  sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  listPendingConfirmations: async () => {
    const result = await chrome.storage.local.get("pendingConfirmations");
    return Array.isArray(result.pendingConfirmations) ? result.pendingConfirmations : [];
  },
  savePendingConfirmation: async (pending) => {
    const result = await chrome.storage.local.get("pendingConfirmations");
    const current = Array.isArray(result.pendingConfirmations) ? result.pendingConfirmations : [];
    const next = current.filter((item) => item.taskId !== pending.taskId);
    next.push(pending);
    await chrome.storage.local.set({ pendingConfirmations: next });
  },
  removePendingConfirmation: async (taskId) => {
    const result = await chrome.storage.local.get("pendingConfirmations");
    const current = Array.isArray(result.pendingConfirmations) ? result.pendingConfirmations : [];
    await chrome.storage.local.set({
      pendingConfirmations: current.filter((item) => item.taskId !== taskId)
    });
  },
  pacingMs: 2_500
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "RUN_APPROVED_TASKS") {
    runner.runApprovedTasks().then(sendResponse).catch((error) => {
      sendResponse({ ok: false, message: error instanceof Error ? error.message : "执行失败" });
    });
    return true;
  }
  if (message.type === "LOCAL_API_REQUEST") {
    requestLocalApi(message.path, message.body, message.method).then(sendResponse);
    return true;
  }
  return false;
});

async function requestApi(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error || `本地工作台接口失败：${response.status}`);
    error.code = data?.error;
    error.status = response.status;
    throw error;
  }
  return data;
}

async function requestLocalApi(path, body, method) {
  try {
    const resolvedMethod = method ?? (body === undefined ? "GET" : "POST");
    const options = { method: resolvedMethod, headers: {} };
    if (body !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    const data = await requestApi(path, options);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "无法连接本地工作台"
    };
  }
}
