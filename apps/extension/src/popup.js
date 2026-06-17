const statusEl = document.getElementById("status");

document.getElementById("collectJobs").addEventListener("click", async () => {
  await sendToActiveTab({ type: "COLLECT_VISIBLE_JOBS" });
});

document.getElementById("collectConversations").addEventListener("click", async () => {
  await sendToActiveTab({ type: "COLLECT_CONVERSATIONS" });
});

document.getElementById("runApproved").addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "RUN_APPROVED_TASKS" });
  statusEl.textContent = response?.message || "已请求执行审批任务";
});

async function sendToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.includes("zhipin.com")) {
    statusEl.textContent = "请先切到 BOSS 直聘页面";
    return;
  }
  const response = await chrome.tabs.sendMessage(tab.id, message).catch((error) => ({ ok: false, error: error.message }));
  statusEl.textContent = response?.message || response?.error || "操作完成";
}
