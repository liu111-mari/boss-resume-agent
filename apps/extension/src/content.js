const API_BASE = "http://localhost:3000";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "COLLECT_VISIBLE_JOBS") {
    collectVisibleJobs().then(sendResponse);
    return true;
  }
  if (message.type === "COLLECT_CONVERSATIONS") {
    collectConversations().then(sendResponse);
    return true;
  }
  if (message.type === "SEND_GREETING") {
    sendGreeting(message.task).then(sendResponse);
    return true;
  }
  return false;
});

async function collectVisibleJobs() {
  if (hasRiskBlocker()) return { ok: false, message: "检测到验证码/登录/安全提示，已暂停" };
  const cards = findJobCards();
  const jobs = cards.map((card, index) => extractJob(card, index)).filter(Boolean);
  await postJSON("/api/extension/ingest", { jobs });
  return { ok: true, message: `已采集 ${jobs.length} 个岗位` };
}

async function collectConversations() {
  if (hasRiskBlocker()) return { ok: false, message: "检测到验证码/登录/安全提示，已暂停" };
  const nodes = Array.from(document.querySelectorAll(".chat-list li, .chat-item, [class*='chat'] li, [class*='conversation']"));
  const fallback = nodes.length ? nodes : Array.from(document.querySelectorAll("li")).slice(0, 30);
  const conversations = fallback.map((node, index) => {
    const text = normalize(node.textContent || "");
    if (!text || text.length < 8) return null;
    return {
      id: stableId(`${location.href}-${index}-${text.slice(0, 30)}`),
      company: pickByLine(text, 1),
      jobTitle: pickJobTitle(text),
      hrName: pickByLine(text, 0),
      lastMessages: [text.slice(0, 260)],
      resumeRequested: /发简历|简历发|投递简历|方便发简历|发送简历/.test(text),
      jobDetailUrl: "",
      status: "new",
      collectedAt: new Date().toISOString()
    };
  }).filter(Boolean);
  await postJSON("/api/extension/ingest", { conversations });
  return { ok: true, message: `已采集 ${conversations.length} 条消息线索` };
}

async function sendGreeting(task) {
  if (hasRiskBlocker()) return { ok: false, error: "检测到验证码/登录/安全提示", pause: true };
  const communicateButton = findClickable(["立即沟通", "开聊", "继续沟通", "沟通"]);
  if (communicateButton) {
    communicateButton.click();
    await delay(900);
  }
  const editor = findEditor();
  if (!editor) return { ok: false, error: "没有找到消息输入框", pause: true };
  setEditorText(editor, task.messageDraft);
  await delay(500);
  const sendButton = findClickable(["发送", "打招呼", "立即发送"]);
  if (!sendButton) return { ok: false, error: "没有找到发送按钮", pause: true };
  sendButton.click();
  return { ok: true };
}

function findJobCards() {
  const selectors = [".job-card-wrapper", ".job-list-box li", ".job-primary", ".job-card-body", "[class*='job-card']", "li"];
  for (const selector of selectors) {
    const nodes = Array.from(document.querySelectorAll(selector)).filter((node) => {
      const text = normalize(node.textContent || "");
      return text.length > 20 && /实习|产品|数据|运营|实施|AI|Agent|SQL|北京|上海/.test(text);
    });
    if (nodes.length) return nodes.slice(0, 30);
  }
  return [];
}

function extractJob(card, index) {
  const text = normalize(card.textContent || "");
  const link = card.querySelector("a[href*='job_detail']") || card.closest("a[href*='job_detail']");
  const href = link ? new URL(link.getAttribute("href"), location.origin).href : location.href;
  const title = pickJobTitle(text) || pickByLine(text, 0) || "未知岗位";
  const company = pickCompany(text) || "未知公司";
  const city = pickCity(text) || "";
  const salary = (text.match(/\d+[Kk]-\d+[Kk]|\d+-\d+\/天|\d+元\/天/) || [""])[0];
  return {
    id: stableId(`${href}-${title}-${company}`),
    title,
    company,
    city,
    salary,
    hrName: pickHr(text),
    hrActiveText: pickActive(text),
    detailUrl: href,
    sourcePage: location.href,
    jdText: text.slice(0, 3000),
    collectedAt: new Date().toISOString()
  };
}

function hasRiskBlocker() {
  const text = normalize(document.body.textContent || "");
  return /验证码|安全验证|登录后继续|账号异常|访问过于频繁/.test(text);
}

function findEditor() {
  return document.querySelector("textarea") ||
    document.querySelector("[contenteditable='true']") ||
    document.querySelector("input[type='text']");
}

function setEditorText(editor, text) {
  editor.focus();
  if (editor.isContentEditable) {
    editor.textContent = text;
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  } else {
    editor.value = text;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function findClickable(labels) {
  const candidates = Array.from(document.querySelectorAll("button, a, [role='button'], .btn"));
  return candidates.find((node) => {
    const text = normalize(node.textContent || "");
    const visible = node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
    return visible && labels.some((label) => text.includes(label));
  });
}

function pickJobTitle(text) {
  const match = text.match(/(AI[^，。,\s]{0,18}|数据分析|商业分析|产品经理|产品运营|实施顾问|AI Agent|大模型应用|RAG)[^，。,\s]{0,16}/i);
  return match?.[0] || "";
}

function pickCompany(text) {
  const lines = text.split(/\s+/).filter(Boolean);
  return lines.find((line) => /科技|信息|智能|网络|数据|咨询|软件|云/.test(line) && line.length <= 24) || "";
}

function pickCity(text) {
  const match = text.match(/北京|上海|杭州|深圳|广州|天津|南京|成都/);
  return match?.[0] || "";
}

function pickHr(text) {
  const match = text.match(/[\u4e00-\u9fa5]{1,4}(女士|先生|经理|HR|招聘)/);
  return match?.[0] || "";
}

function pickActive(text) {
  const match = text.match(/刚刚活跃|今日活跃|\d+小时内活跃|\d+日内活跃/);
  return match?.[0] || "";
}

function pickByLine(text, index) {
  return text.split(/\s+/).filter(Boolean)[index] || "";
}

function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
}

function stableId(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return `boss-${Math.abs(hash)}`;
}

async function postJSON(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`本地工作台接口失败：${response.status}`);
  return response.json();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
