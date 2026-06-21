chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "COLLECT_VISIBLE_JOBS") {
    collectVisibleJobs().then(sendResponse).catch((error) => {
      sendResponse({ ok: false, message: error instanceof Error ? error.message : "岗位采集失败" });
    });
    return true;
  }
  if (message.type === "SEND_GREETING") {
    globalThis.BossPageAdapter.sendGreeting(document, window, message.task)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "发送失败", pause: true });
      });
    return true;
  }
  return false;
});

scheduleAutomaticJobCollection();

function scheduleAutomaticJobCollection() {
  const supportedPath =
    location.pathname.includes("/web/geek/jobs") ||
    /^\/c\d+/.test(location.pathname) ||
    location.pathname.includes("/zhaopin");
  if (!supportedPath) return;

  let collectedSignature = "";
  let timer;

  const attemptCollection = async () => {
    const signature = globalThis.BossPageAdapter.getVisibleJobSignature(document);
    if (!signature || signature === collectedSignature) return;

    const result = await collectVisibleJobs().catch(() => null);
    if (result?.ok) collectedSignature = signature;
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(attemptCollection, 900);
  };

  schedule();
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 30000);
}

async function collectVisibleJobs() {
  const risk = globalThis.BossPageAdapter.detectRiskBlocker(document);
  if (!risk.ok) return { ok: false, message: "检测到验证码/登录/安全提示，已暂停" };
  const jobs = globalThis.BossJobExtractor.extractVisibleJobs(document, location.href);
  if (!jobs.length) {
    return { ok: false, message: "当前页面未识别到岗位，请确认已打开 BOSS 推荐或搜索结果页" };
  }
  await postJSON("/api/extension/ingest", { jobs });
  return { ok: true, message: `已采集 ${jobs.length} 个岗位` };
}

async function postJSON(path, body) {
  const response = await chrome.runtime.sendMessage({
    type: "LOCAL_API_REQUEST",
    path,
    body
  });
  if (!response?.ok) throw new Error(response?.error || "无法连接本地工作台");
  return response.data;
}
