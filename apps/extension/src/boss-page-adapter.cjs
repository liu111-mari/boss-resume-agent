(function initializeBossPageAdapter(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BossPageAdapter = api;
})(typeof globalThis === "object" ? globalThis : this, function createBossPageAdapter() {
  const RISK_SURFACE_TOKENS = ["modal", "dialog", "verify", "captcha", "login", "security", "risk", "error"];
  const RISK_SURFACE_SELECTORS = [
    "[role='dialog']",
    "[aria-modal='true']",
    "dialog",
    ...RISK_SURFACE_TOKENS.flatMap((token) => [
      `[class*='${token}' i]`,
      `[data-${token}]`,
      `[data-testid*='${token}' i]`,
      `[data-state*='${token}' i]`,
      `[data-type*='${token}' i]`,
      `[data-component*='${token}' i]`,
      `[data-name*='${token}' i]`
    ])
  ].join(", ");

  const SELECTORS = Object.freeze({
    actionable: "button, a[href], [role='button'], input[type='button'], input[type='submit'], .btn",
    editor: "textarea, [contenteditable], input[type='text']",
    preferredEditorContainer:
      "[data-chat-container], [data-message-container], [role='dialog'], .chat-dialog, .chat-container, .message-dialog, [class*='chat-dialog'], [class*='chat-container'], [class*='message-dialog']",
    history:
      "[data-chat-history], [role='log'], .chat-history, .message-list, .chat-record, [class*='chat-history'], [class*='message-list'], [class*='chat-record']",
    message:
      "[data-message], .message-item, .message-content, [class*='message-item'], [class*='message-content']",
    outgoingMessage:
      "[data-direction='outgoing'], [data-self='true'], [data-owner='self'], .message-self, .message-mine, .message-outgoing, .item-myself, [class*='message-right'], [class*='message-self'], [class*='message-mine'], [class*='outgoing']",
    incomingMessage:
      "[data-direction='incoming'], [data-self='false'], [data-owner='other'], .message-incoming, .message-other, [class*='message-left'], [class*='incoming']",
    editable: "textarea, input, [contenteditable]",
    jobDetailLink: "a[href*='/job_detail/']",
    riskSurface: RISK_SURFACE_SELECTORS
  });

  const RISK_LABELS = ["验证码", "安全验证", "登录后继续", "账号异常", "访问过于频繁", "操作频繁", "风险提示"];
  const COMMUNICATION_LABELS = new Set(["立即沟通", "开聊", "继续沟通", "沟通"]);
  const SEND_LABELS = new Set(["发送", "打招呼", "立即发送"]);

  function normalize(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function normalizeLabel(text) {
    return String(text || "").replace(/\s+/g, "");
  }

  function isJsdom(document) {
    return /jsdom/i.test(document.defaultView?.navigator?.userAgent || "");
  }

  function isVisible(element, options = {}) {
    if (!element || element.nodeType !== 1 || !element.isConnected) return false;
    const interactive = options.interactive === true;

    for (let current = element; current; current = current.parentElement) {
      if (
        current.hidden ||
        current.hasAttribute("inert") ||
        current.inert === true ||
        current.getAttribute("aria-hidden") === "true"
      ) {
        return false;
      }
      const style = current.ownerDocument.defaultView?.getComputedStyle(current);
      if (style) {
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          Number.parseFloat(style.opacity || "1") === 0
        ) {
          return false;
        }
        if (interactive && style.pointerEvents === "none") return false;
      }
    }

    if (typeof element.checkVisibility === "function") {
      try {
        if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      } catch {
        // Older browsers may expose a partial implementation; semantic and rect checks remain.
      }
    }

    if (!isJsdom(element.ownerDocument) && typeof element.getBoundingClientRect === "function") {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }
    return true;
  }

  function isEnabled(element) {
    if ("disabled" in element && element.disabled) return false;
    if (element.getAttribute("aria-disabled") === "true") return false;
    return !element.classList.contains("disabled");
  }

  function visibleText(element) {
    const document = element.ownerDocument;
    const nodeFilter = document.defaultView?.NodeFilter;
    if (!nodeFilter) return normalize(element.textContent);

    const walker = document.createTreeWalker(element, nodeFilter.SHOW_TEXT);
    const parts = [];
    let textNode = walker.nextNode();
    while (textNode) {
      if (isVisible(textNode.parentElement)) parts.push(textNode.nodeValue || "");
      textNode = walker.nextNode();
    }
    return normalize(parts.join(" "));
  }

  function actionableLabel(element) {
    return normalizeLabel(
      element.getAttribute("aria-label") ||
      ("value" in element ? element.value : "") ||
      visibleText(element)
    );
  }

  function finderResult(candidates, reasonDetails = {}) {
    if (candidates.length === 1) return { ok: true, element: candidates[0] };
    return {
      ok: false,
      reason: candidates.length === 0 ? "missing" : "ambiguous",
      details: { ...reasonDetails, count: candidates.length }
    };
  }

  function detectRiskBlocker(document) {
    const root = document.body || document.documentElement;
    if (!root) return { ok: true, element: null };

    const pathname = document.defaultView?.location?.pathname || "";
    const title = normalizeLabel(document.title);
    if (pathname.includes("/security.html") || title.includes("请稍候")) {
      return {
        ok: false,
        reason: "risk_blocker",
        details: { matchedLabel: "security_redirect", text: document.title || pathname },
        element: root
      };
    }

    const findBlocker = (element) => {
      if (!isVisible(element)) return null;
      const text = visibleText(element);
      const compactText = normalizeLabel(text);
      const matchedLabel = RISK_LABELS.find((label) => compactText.includes(label));
      return matchedLabel ? { text, matchedLabel } : null;
    };

    for (const surface of root.querySelectorAll(RISK_SURFACE_SELECTORS)) {
      const blocker = findBlocker(surface);
      if (blocker) {
        return {
          ok: false,
          reason: "risk_blocker",
          details: blocker,
          element: surface
        };
      }
    }

    const bodyBlocker = findBlocker(root);
    if (bodyBlocker && normalize(bodyBlocker.text).length <= 500) {
      return {
        ok: false,
        reason: "risk_blocker",
        details: bodyBlocker,
        element: root
      };
    }
    return { ok: true, element: null };
  }

  function findExactAction(root, labels) {
    const candidates = Array.from(root.querySelectorAll(SELECTORS.actionable)).filter((element) => {
      return isVisible(element, { interactive: true }) && isEnabled(element) && labels.has(actionableLabel(element));
    });
    return finderResult(candidates, { labels: Array.from(labels) });
  }

  function findCommunicationEntry(document) {
    const candidates = Array.from(document.querySelectorAll(SELECTORS.actionable)).filter((element) => {
      return (
        isVisible(element, { interactive: true }) &&
        isEnabled(element) &&
        COMMUNICATION_LABELS.has(actionableLabel(element))
      );
    });
    const preferred = candidates.filter((element) => element.matches(".btn-startchat"));
    return finderResult(preferred.length ? preferred : candidates, {
      labels: Array.from(COMMUNICATION_LABELS),
      priority: preferred.length ? "boss_start_chat" : "page"
    });
  }

  function isSearchEditor(element) {
    if (element.matches("input[type='search'], [role='searchbox']")) return true;
    const identity = normalize([
      element.getAttribute("placeholder"),
      element.getAttribute("aria-label"),
      element.getAttribute("name"),
      element.id,
      element.className
    ].join(" "));
    return /搜索|search/i.test(identity);
  }

  function findUniqueChatEditor(document) {
    const candidates = Array.from(document.querySelectorAll(SELECTORS.editor)).filter((element) => {
      const contenteditable = element.getAttribute("contenteditable");
      const editable = contenteditable === null || contenteditable.toLowerCase() !== "false";
      return isVisible(element, { interactive: true }) && isEnabled(element) && editable && !isSearchEditor(element);
    });
    const preferred = candidates.filter((element) => element.closest(SELECTORS.preferredEditorContainer));
    return finderResult(preferred.length ? preferred : candidates, {
      priority: preferred.length ? "chat_container" : "page"
    });
  }

  function setEditorText(editor, text, window = editor?.ownerDocument?.defaultView) {
    if (!editor || !window) return { ok: false, reason: "set_failed", details: { message: "editor unavailable" } };
    const value = String(text ?? "");
    editor.focus();

    const contenteditable = editor.getAttribute("contenteditable");
    const isContentEditable =
      editor.isContentEditable ||
      (contenteditable !== null && contenteditable.toLowerCase() !== "false");
    if (isContentEditable) {
      editor.textContent = value;
      let inputEvent;
      try {
        inputEvent = new window.InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: value
        });
      } catch {
        inputEvent = new window.Event("input", { bubbles: true });
      }
      editor.dispatchEvent(inputEvent);
      if (normalize(editor.textContent) !== normalize(value)) {
        return { ok: false, reason: "set_failed", details: { expected: value, actual: editor.textContent || "" } };
      }
      return { ok: true, element: editor };
    }

    const prototype = editor.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement?.prototype
      : window.HTMLInputElement?.prototype;
    const setter = prototype && Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(editor, value);
    else editor.value = value;
    editor.dispatchEvent(new window.Event("input", { bubbles: true }));
    editor.dispatchEvent(new window.Event("change", { bubbles: true }));

    if (editor.value !== value) {
      return { ok: false, reason: "set_failed", details: { expected: value, actual: editor.value } };
    }
    return { ok: true, element: editor };
  }

  function findUniqueSendButton(document, editor) {
    const container = editor?.closest(SELECTORS.preferredEditorContainer);
    if (!container) {
      return {
        ok: false,
        reason: "missing",
        details: { labels: Array.from(SEND_LABELS), scope: "chat_container" }
      };
    }
    return findExactAction(container, SEND_LABELS);
  }

  function escapeAttributeValue(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function getStableMessageIdentity(element) {
    for (const attribute of ["data-message-id", "data-id", "data-msg-id", "id"]) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const selector = `[${attribute}="${escapeAttributeValue(value)}"]`;
      return { stableId: value, selector };
    }
    return { stableId: null, selector: SELECTORS.message };
  }

  function findMatchingHistoryMessages(document, text, editor) {
    const expected = normalize(text);
    if (!expected) return [];

    const matches = [];
    const seen = new Set();
    for (const history of document.querySelectorAll(SELECTORS.history)) {
      if (!isVisible(history)) continue;
      for (const message of history.querySelectorAll(SELECTORS.message)) {
        if (seen.has(message)) continue;
        seen.add(message);
        if (!isVisible(message)) continue;
        if (message.matches(SELECTORS.incomingMessage)) continue;
        if (!message.matches(SELECTORS.outgoingMessage)) continue;
        if (editor && (message === editor || message.contains(editor) || editor.contains(message))) continue;
        if (message.matches(SELECTORS.editable) || message.closest(SELECTORS.editable)) continue;
        if (visibleText(message).includes(expected)) {
          matches.push({ element: message, ...getStableMessageIdentity(message) });
        }
      }
    }
    return matches;
  }

  function captureMessageBaseline(document, text, editor) {
    const expected = normalize(text);
    const matches = findMatchingHistoryMessages(document, expected, editor);
    const elements = new Set(matches.map((match) => match.element));
    const identities = matches.map((match) => match.stableId);
    const stableIds = new Set(identities.filter(Boolean));
    const fingerprint = `${expected}|${matches.length}|${identities.map((identity) => identity || "null").join(",")}`;
    return { elements, identities, stableIds, count: matches.length, fingerprint };
  }

  function confirmMessageSent(
    document,
    text,
    editor,
    baseline = { elements: new Set(), identities: [], stableIds: new Set(), count: 0, fingerprint: "" }
  ) {
    const expected = normalize(text);
    const matches = findMatchingHistoryMessages(document, expected, editor);
    const baselineCount = Number.isFinite(baseline?.count) ? baseline.count : 0;
    const baselineElements = baseline?.elements instanceof Set ? baseline.elements : new Set();
    const countDelta = matches.length - baselineCount;
    const countIncreased = countDelta > 0;

    if (!countIncreased) {
      return {
        ok: false,
        reason: "confirmation_missing",
        details: {
          baselineCount,
          count: matches.length,
          countDelta,
          fingerprint: `${expected}|${matches.length}|${matches.map((match) => match.stableId || "null").join(",")}`
        }
      };
    }
    const referenceNewMatches = matches.filter((match) => !baselineElements.has(match.element));
    const evidenceMatch =
      referenceNewMatches[referenceNewMatches.length - 1] ||
      matches[matches.length - 1];
    return {
      ok: true,
      evidence: {
        text: expected,
        element: evidenceMatch.element,
        ...(evidenceMatch.stableId ? { stableId: evidenceMatch.stableId } : {}),
        selector: evidenceMatch.selector,
        matchCount: matches.length,
        baselineCount,
        countDelta,
        fingerprint: `${expected}|${matches.length}|${matches.map((match) => match.stableId || "null").join(",")}`
      }
    };
  }

  function getVisibleJobSignature(document, limit = 50) {
    const maxLinks = Math.max(0, Math.floor(Number(limit) || 0));
    return Array.from(document.querySelectorAll(SELECTORS.jobDetailLink))
      .filter(isVisible)
      .slice(0, maxLinks)
      .map((link) => link.getAttribute("href"))
      .filter(Boolean)
      .join("|");
  }

  function pausedFailure(reason, details) {
    const messages = {
      risk_blocker: "检测到验证码/登录/安全或风控提示",
      missing: "未找到唯一可用的 BOSS 页面交互元素",
      ambiguous: "找到多个候选 BOSS 页面交互元素",
      set_failed: "无法可靠写入消息输入框",
      confirmation_timeout: "发送后未在聊天记录中确认消息"
    };
    const stage = details?.stage;
    const code = reason === "risk_blocker" || reason === "confirmation_timeout"
      ? reason
      : stage
        ? `${stage}_${reason}`
        : reason;
    return { ok: false, reason, code, error: messages[reason] || "BOSS 页面交互失败", pause: true, details };
  }

  function inspectGreetingPage(document) {
    const risk = detectRiskBlocker(document);
    if (!risk.ok) return pausedFailure(risk.reason, risk.details);

    const editorResult = findUniqueChatEditor(document);
    if (editorResult.ok) return { ok: true, state: "ready" };
    if (editorResult.reason !== "missing") {
      return pausedFailure(editorResult.reason, { stage: "chat_editor", ...editorResult.details });
    }

    const entryResult = findCommunicationEntry(document);
    if (!entryResult.ok) {
      return pausedFailure(entryResult.reason, { stage: "communication_entry", ...entryResult.details });
    }
    return { ok: true, state: "entry_available" };
  }

  function prepareGreeting(document, window, options = {}) {
    const inspection = inspectGreetingPage(document);
    if (!inspection.ok || inspection.state === "ready") return inspection;

    const entryResult = findCommunicationEntry(document);
    if (!entryResult.ok) {
      return pausedFailure(entryResult.reason, { stage: "communication_entry", ...entryResult.details });
    }
    const clickDelayMs = Math.max(0, Number(options.clickDelayMs) || 0);
    const schedule = typeof options.schedule === "function"
      ? options.schedule
      : (callback, delayMs) => window.setTimeout(callback, delayMs);
    schedule(() => entryResult.element.click(), clickDelayMs);
    return { ok: true, state: "opening_chat" };
  }

  async function sendGreetingInChat(document, window, task, options = {}) {
    const wait = typeof options.delay === "function"
      ? options.delay
      : (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const pollIntervalMs = options.pollIntervalMs ?? 200;
    const timeoutMs = options.timeoutMs ?? 8000;
    const now = options.now || Date.now;
    const message = String(task?.messageDraft || "");

    const risk = detectRiskBlocker(document);
    if (!risk.ok) return pausedFailure(risk.reason, risk.details);

    const editorResult = findUniqueChatEditor(document);
    if (!editorResult.ok) {
      return pausedFailure(editorResult.reason, { stage: "chat_editor", ...editorResult.details });
    }

    const setResult = setEditorText(editorResult.element, message, window);
    if (!setResult.ok) return pausedFailure(setResult.reason, setResult.details);

    const sendResult = findUniqueSendButton(document, editorResult.element);
    if (!sendResult.ok) {
      return pausedFailure(sendResult.reason, { stage: "send_button", ...sendResult.details });
    }
    const baseline = captureMessageBaseline(document, message, editorResult.element);
    sendResult.element.click();

    const deadline = now() + timeoutMs;
    while (true) {
      const confirmation = confirmMessageSent(document, message, editorResult.element, baseline);
      if (confirmation.ok) {
        return { ok: true, confirmationEvidence: confirmation.evidence };
      }
      const remaining = deadline - now();
      if (remaining <= 0) break;
      await wait(Math.min(pollIntervalMs, remaining));
    }

    return pausedFailure("confirmation_timeout", { timeoutMs });
  }

  async function sendGreeting(document, window, task, options = {}) {
    const wait = typeof options.delay === "function"
      ? options.delay
      : (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const interactionDelayMs = typeof options.delay === "number" ? options.delay : 900;
    const preparation = prepareGreeting(document, window, { schedule: (callback) => callback() });
    if (!preparation.ok) return preparation;
    if (preparation.state === "opening_chat") await wait(interactionDelayMs);
    return sendGreetingInChat(document, window, task, options);
  }

  return {
    SELECTORS,
    RISK_SURFACE_SELECTORS,
    isVisible,
    detectRiskBlocker,
    findCommunicationEntry,
    findUniqueChatEditor,
    setEditorText,
    findUniqueSendButton,
    captureMessageBaseline,
    confirmMessageSent,
    getVisibleJobSignature,
    inspectGreetingPage,
    prepareGreeting,
    sendGreetingInChat,
    sendGreeting
  };
});
