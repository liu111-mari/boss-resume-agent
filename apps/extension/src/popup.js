const statusEl = document.getElementById("status");
const approvedEl = document.getElementById("approvedCount");
const quotaEl = document.getElementById("quota");
const pausedEl = document.getElementById("pausedReason");

document.getElementById("collectJobs").addEventListener("click", async () => {
  const collectionMessage = await sendToActiveTab({ type: "COLLECT_VISIBLE_JOBS" });
  await refreshStatus(collectionMessage);
});

document.getElementById("runApproved").addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "RUN_APPROVED_TASKS" });
  const executionMessage = response?.message || "已请求执行审批任务";
  await refreshStatus(executionMessage);
});

async function refreshStatus(preserveMessage = "") {
  statusEl.textContent = "正在检查本地工作台…";
  let approvedResponse;
  let summaryResponse;
  try {
    [approvedResponse, summaryResponse] = await Promise.all([
      chrome.runtime.sendMessage({
        type: "LOCAL_API_REQUEST",
        method: "GET",
        path: "/api/tasks/approved"
      }),
      chrome.runtime.sendMessage({
        type: "LOCAL_API_REQUEST",
        method: "GET",
        path: "/api/run-summary"
      })
    ]);
  } catch (error) {
    approvedEl.textContent = "--";
    quotaEl.textContent = "-- / --";
    pausedEl.textContent = "--";
    const healthError = error instanceof Error ? error.message : "无法连接本地工作台";
    statusEl.textContent = preserveMessage ? `${preserveMessage}；状态刷新失败：${healthError}` : healthError;
    return;
  }

  if (!approvedResponse?.ok || !summaryResponse?.ok) {
    const healthError = approvedResponse?.error || summaryResponse?.error || "无法连接本地工作台";
    statusEl.textContent = preserveMessage ? `${preserveMessage}；状态刷新失败：${healthError}` : healthError;
    return;
  }

  const approved = approvedResponse.data;
  const summary = summaryResponse.data;
  statusEl.textContent = preserveMessage || "本地工作台已连接";
  approvedEl.textContent = String(approved.approvedCount ?? approved.tasks?.length ?? 0);
  quotaEl.textContent = `${approved.quota?.used ?? 0} / ${approved.quota?.limit ?? 0}`;
  pausedEl.textContent = summary.pausedReason || "无";
}

async function sendToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.includes("zhipin.com")) {
    return "请先切到 BOSS 直聘页面";
  }

  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const missingReceiver =
      errorMessage.includes("Receiving end does not exist") ||
      errorMessage.includes("Could not establish connection");
    if (!missingReceiver) return errorMessage;

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["job-extractor.js", "boss-page-adapter.js", "content.js"]
      });
      response = await chrome.tabs.sendMessage(tab.id, message);
    } catch (injectionError) {
      const injectionMessage =
        injectionError instanceof Error ? injectionError.message : String(injectionError);
      return `页面脚本注入失败：${injectionMessage}`;
    }
  }

  return response?.message || response?.error || "操作完成";
}

refreshStatus();
