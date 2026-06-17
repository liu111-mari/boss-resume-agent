const API_BASE = "http://localhost:3000";
let running = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "RUN_APPROVED_TASKS") return false;
  runApprovedTasks().then(sendResponse);
  return true;
});

async function runApprovedTasks() {
  if (running) return { ok: false, message: "任务正在执行中" };
  running = true;
  try {
    const { tasks } = await fetch(`${API_BASE}/api/tasks/approved`).then((res) => res.json());
    if (!tasks?.length) return { ok: true, message: "没有已审批任务" };

    for (const task of tasks) {
      const result = await runOneTask(task);
      await fetch(`${API_BASE}/api/tasks/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          status: result.ok ? "sent" : "failed",
          failureReason: result.error || ""
        })
      });
      if (result.pause) break;
      await delay(2500);
    }
    return { ok: true, message: "审批任务执行完成，请回工作台查看状态" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "执行失败" };
  } finally {
    running = false;
  }
}

async function runOneTask(task) {
  if (!task.detailUrl) return { ok: false, error: "岗位没有详情链接" };
  const tab = await chrome.tabs.create({ url: task.detailUrl, active: true });
  await waitForTabComplete(tab.id);
  await delay(1200);
  const response = await chrome.tabs.sendMessage(tab.id, { type: "SEND_GREETING", task }).catch((error) => ({
    ok: false,
    error: error.message,
    pause: true
  }));
  return response;
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
