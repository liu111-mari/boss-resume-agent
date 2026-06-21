(function initializeBossPageAdapter(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BossPageAdapter = api;
})(typeof globalThis === "object" ? globalThis : this, function createBossPageAdapter() {
  const SELECTORS = Object.freeze({
    actionable: "button, a[href], [role='button'], input[type='button'], input[type='submit'], .btn",
    editor: "textarea, [contenteditable='true'], [contenteditable='plaintext-only'], input[type='text']",
    preferredEditorContainer:
      "[data-chat-container], [data-message-container], [role='dialog'], .chat-dialog, .chat-container, .message-dialog, [class*='chat-dialog'], [class*='chat-container'], [class*='message-dialog']",
    history:
      "[data-chat-history], [role='log'], .chat-history, .message-list, .chat-record, [class*='chat-history'], [class*='message-list'], [class*='chat-record']",
    message:
      "[data-message], .message-item, .message-content, [class*='message-item'], [class*='message-content']",
    editable: "textarea, input, [contenteditable='true'], [contenteditable='plaintext-only']",
    jobDetailLink: "a[href*='/job_detail/']"
  });

  const RISK_LABELS = ["验证码", "安全验证", "登录后继续", "账号异常", "访问过于频繁", "操作频繁", "风险提示"];
  const COMMUNICATION_LABELS = new Set(["立即沟通", "开聊", "继续沟通", "沟通"]);
  const SEND_LABELS = new Set(["发送", "打招呼", "立即发送"]);
  const messageElementIds = new WeakMap();
  let nextMessageElementId = 1;

  function normalize(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function normalizeLabel(text) {
    return String(text || "").replace(/\s+/g, "");
  }

  function isJsdom(document) {
    return /jsdom/i.test(document.defaultView?.navigator?.userAgent || "");
  }

  function isVisible(element) {
    if (!element || element.nodeType !== 1 || !element.isConnected) return false;

    for (let current = element; current; current = current.parentElement) {
      if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
      const style = current.ownerDocument.defaultView?.getComputedStyle(current);
      if (style && (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse")) {
        return false;
      }
    }

    if (!isJsdom(element.ownerDocument) && typeof element.getClientRects === "function") {
      return element.getClientRects().length > 0;
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

    const nodeFilter = document.defaultView?.NodeFilter;
    if (!nodeFilter) return { ok: true, element: null };
    const walker = document.createTreeWalker(root, nodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode) {
      const element = textNode.parentElement;
      const text = normalize(textNode.nodeValue);
      const matchedLabel = RISK_LABELS.find((label) => text.includes(label));
      if (matchedLabel && isVisible(element)) {
        return {
          ok: false,
          reason: "risk_blocker",
          details: { text, matchedLabel },
          element
        };
      }
      textNode = walker.nextNode();
    }

    const visibleElements = Array.from(root.querySelectorAll("*")).reverse();
    for (const element of visibleElements) {
      if (!isVisible(element) || element.childElementCount === 0) continue;
      const text = visibleText(element);
      const compactText = normalizeLabel(text);
      const matchedLabel = RISK_LABELS.find((label) => compactText.includes(label));
      if (matchedLabel) {
        return {
          ok: false,
          reason: "risk_blocker",
          details: { text, matchedLabel },
          element
        };
      }
    }
    return { ok: true, element: null };
  }

  function findExactAction(document, labels) {
    const candidates = Array.from(document.querySelectorAll(SELECTORS.actionable)).filter((element) => {
      return isVisible(element) && isEnabled(element) && labels.has(actionableLabel(element));
    });
    return finderResult(candidates, { labels: Array.from(labels) });
  }

  function findCommunicationEntry(document) {
    return findExactAction(document, COMMUNICATION_LABELS);
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
      return isVisible(element) && isEnabled(element) && !isSearchEditor(element);
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

    if (editor.matches("[contenteditable='true'], [contenteditable='plaintext-only']")) {
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

  function findUniqueSendButton(document) {
    return findExactAction(document, SEND_LABELS);
  }

  function getMessageElementId(element) {
    if (!messageElementIds.has(element)) {
      messageElementIds.set(element, nextMessageElementId);
      nextMessageElementId += 1;
    }
    return messageElementIds.get(element);
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
        if (editor && (message === editor || message.contains(editor) || editor.contains(message))) continue;
        if (message.matches(SELECTORS.editable) || message.closest(SELECTORS.editable)) continue;
        if (visibleText(message).includes(expected)) matches.push(message);
      }
    }
    return matches;
  }

  function captureMessageBaseline(document, text, editor) {
    const expected = normalize(text);
    const matches = findMatchingHistoryMessages(document, expected, editor);
    const elements = new Set(matches);
    const fingerprint = `${expected}|${matches.map(getMessageElementId).join(",")}`;
    return { elements, count: matches.length, fingerprint };
  }

  function confirmMessageSent(document, text, editor, baseline = { elements: new Set(), count: 0, fingerprint: "" }) {
    const expected = normalize(text);
    const matches = findMatchingHistoryMessages(document, expected, editor);
    const baselineCount = Number.isFinite(baseline?.count) ? baseline.count : 0;
    const baselineElements = baseline?.elements instanceof Set ? baseline.elements : new Set();
    const newMatches = matches.filter((message) => !baselineElements.has(message));

    if (matches.length <= baselineCount || !newMatches.length) {
      return {
        ok: false,
        reason: "confirmation_missing",
        details: {
          baselineCount,
          count: matches.length,
          fingerprint: `${expected}|${matches.map(getMessageElementId).join(",")}`
        }
      };
    }
    const latestNewMatch = newMatches[newMatches.length - 1];
    return {
      ok: true,
      evidence: {
        text: expected,
        element: latestNewMatch,
        matchCount: matches.length,
        baselineCount,
        fingerprint: `${expected}|${matches.map(getMessageElementId).join(",")}`
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
    return { ok: false, reason, error: messages[reason] || "BOSS 页面交互失败", pause: true, details };
  }

  async function sendGreeting(document, window, task, options = {}) {
    const wait = typeof options.delay === "function"
      ? options.delay
      : (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const interactionDelayMs = typeof options.delay === "number" ? options.delay : 900;
    const pollIntervalMs = options.pollIntervalMs ?? 200;
    const timeoutMs = options.timeoutMs ?? 8000;
    const now = options.now || Date.now;
    const message = String(task?.messageDraft || "");

    const risk = detectRiskBlocker(document);
    if (!risk.ok) return pausedFailure(risk.reason, risk.details);

    let editorResult = findUniqueChatEditor(document);
    if (!editorResult.ok) {
      if (editorResult.reason !== "missing") {
        return pausedFailure(editorResult.reason, { stage: "editor", ...editorResult.details });
      }
      const entryResult = findCommunicationEntry(document);
      if (!entryResult.ok) {
        return pausedFailure(entryResult.reason, { stage: "communication_entry", ...entryResult.details });
      }
      entryResult.element.click();
      await wait(interactionDelayMs);

      const postClickRisk = detectRiskBlocker(document);
      if (!postClickRisk.ok) return pausedFailure(postClickRisk.reason, postClickRisk.details);
      editorResult = findUniqueChatEditor(document);
      if (!editorResult.ok) {
        return pausedFailure(editorResult.reason, { stage: "editor_after_entry", ...editorResult.details });
      }
    }

    const setResult = setEditorText(editorResult.element, message, window);
    if (!setResult.ok) return pausedFailure(setResult.reason, setResult.details);

    const sendResult = findUniqueSendButton(document);
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

  return {
    SELECTORS,
    detectRiskBlocker,
    findCommunicationEntry,
    findUniqueChatEditor,
    setEditorText,
    findUniqueSendButton,
    captureMessageBaseline,
    confirmMessageSent,
    getVisibleJobSignature,
    sendGreeting
  };
});
