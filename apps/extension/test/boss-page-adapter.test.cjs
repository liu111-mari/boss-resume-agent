const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { JSDOM } = require("jsdom");

const adapter = require("../src/boss-page-adapter.cjs");
const {
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
} = adapter;

const chatFixture = readFileSync(join(__dirname, "fixtures", "boss-chat.html"), "utf8");

function createDom(body) {
  return new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    url: "https://www.zhipin.com/web/geek/job"
  });
}

function createFixtureDom() {
  return new JSDOM(chatFixture, {
    url: "https://www.zhipin.com/web/geek/job"
  });
}

test("adapter is exported through CommonJS and the global namespace", () => {
  assert.equal(globalThis.BossPageAdapter, adapter);
});

test("replays a sanitized BOSS chat fixture with one editor, send action, and history", () => {
  const dom = createFixtureDom();
  const { document } = dom.window;

  assert.deepEqual(detectRiskBlocker(document), { ok: true, element: null });
  assert.equal(findUniqueChatEditor(document).element.id, "boss-chat-editor");
  assert.equal(
    findUniqueSendButton(document, document.querySelector("#boss-chat-editor")).element.id,
    "boss-send-button"
  );

  const baseline = captureMessageBaseline(
    document,
    "之前已发送的问候",
    document.querySelector("#boss-chat-editor")
  );
  assert.equal(baseline.count, 1);
  assert.deepEqual(Array.from(baseline.stableIds), ["message-history-1"]);
});

test("replays the fixture risk variant and pauses before any interaction", async () => {
  const dom = createFixtureDom();
  const { document } = dom.window;
  const riskVariant = document.querySelector("#risk-variant").content.cloneNode(true);
  document.body.replaceChildren(riskVariant);
  let clicked = false;
  document.querySelector("#risk-send-button").addEventListener("click", () => {
    clicked = true;
  });

  const blocker = detectRiskBlocker(document);
  const result = await sendGreeting(
    document,
    dom.window,
    { messageDraft: "您好，想了解这个岗位。" },
    { delay: async () => {} }
  );

  assert.equal(blocker.reason, "risk_blocker");
  assert.equal(blocker.details.matchedLabel, "安全验证");
  assert.equal(result.reason, "risk_blocker");
  assert.equal(result.pause, true);
  assert.equal(clicked, false);
});

test("detectRiskBlocker reports visible BOSS risk text", () => {
  for (const text of ["验证码", "安全验证", "登录后继续", "账号异常", "访问过于频繁", "操作频繁", "风险提示"]) {
    const dom = createDom(`<main class="security-error">${text}</main>`);
    const result = detectRiskBlocker(dom.window.document);
    assert.equal(result.ok, false, text);
    assert.equal(result.reason, "risk_blocker", text);
    assert.match(result.details.text, new RegExp(text), text);
  }
});

test("detectRiskBlocker recognizes visible risk text split across elements", () => {
  const dom = createDom('<main role="dialog"><strong>安全</strong><span>验证</span></main>');

  const result = detectRiskBlocker(dom.window.document);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "risk_blocker");
  assert.equal(result.details.matchedLabel, "安全验证");
});

test("detectRiskBlocker ignores hidden risk text", () => {
  const dom = createDom(`
    <div hidden>验证码</div>
    <div aria-hidden="true">安全验证</div>
    <div style="display:none">账号异常</div>
    <div style="visibility: hidden">风险提示</div>
    <main>正常岗位页面</main>
  `);

  assert.deepEqual(detectRiskBlocker(dom.window.document), { ok: true, element: null });
});

test("detectRiskBlocker ignores blocker words in a long normal page", () => {
  const normalCopy = "这是正常岗位介绍和帮助内容。".repeat(50);
  const dom = createDom(`
    <main>
      <article>${normalCopy}</article>
      <section>常见问题：收不到验证码怎么办？风险提示是什么意思？</section>
    </main>
  `);

  assert.deepEqual(detectRiskBlocker(dom.window.document), { ok: true, element: null });
});

test("detectRiskBlocker scans visible dialog risk surfaces", () => {
  const dom = createDom(`
    <main>${"正常岗位内容".repeat(100)}</main>
    <section role="dialog">操作频繁，请稍后再试</section>
  `);

  const result = detectRiskBlocker(dom.window.document);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "risk_blocker");
  assert.equal(result.element.getAttribute("role"), "dialog");
});

test("detectRiskBlocker scans risk tokens in data attributes", () => {
  const dom = createDom(`
    <main>${"正常岗位内容".repeat(100)}</main>
    <section data-state="login-error">登录后继续</section>
  `);

  const result = detectRiskBlocker(dom.window.document);

  assert.equal(result.ok, false);
  assert.equal(result.element.getAttribute("data-state"), "login-error");
});

test("detectRiskBlocker accepts a short visible error page without a modal surface", () => {
  const dom = createDom("<main>账号异常，请登录后继续</main>");

  const result = detectRiskBlocker(dom.window.document);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "risk_blocker");
});

test("detectRiskBlocker recognizes the BOSS security redirect even without blocker body text", () => {
  const dom = new JSDOM("<!doctype html><html><head><title>请稍候 - BOSS直聘</title></head><body></body></html>", {
    url: "https://www.zhipin.com/web/passport/zp/security.html?callbackUrl=%2Fjob_detail%2Fexample.html"
  });

  const result = detectRiskBlocker(dom.window.document);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "risk_blocker");
  assert.equal(result.details.matchedLabel, "security_redirect");
});

test("findCommunicationEntry requires an exact normalized label", () => {
  const dom = createDom(`
    <button> 沟通   记录 </button>
    <a href="/chat"> 立即   沟通 </a>
  `);

  const result = findCommunicationEntry(dom.window.document);
  assert.equal(result.ok, true);
  assert.equal(result.element.tagName, "A");
});

test("findCommunicationEntry reports missing and ambiguous entries", () => {
  const missing = createDom("<button>沟通记录</button>");
  assert.equal(findCommunicationEntry(missing.window.document).reason, "missing");

  const ambiguous = createDom("<button>开聊</button><button>继续沟通</button>");
  const result = findCommunicationEntry(ambiguous.window.document);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ambiguous");
  assert.equal(result.details.count, 2);
});

test("findCommunicationEntry prefers the unique BOSS start-chat action over duplicate labels", () => {
  const dom = createDom(`
    <button class="toolbar-action">立即沟通</button>
    <a id="primary-entry" class="btn btn-startchat" href="/web/geek/chat">立即沟通</a>
  `);

  const result = findCommunicationEntry(dom.window.document);

  assert.equal(result.ok, true);
  assert.equal(result.element.id, "primary-entry");
});

test("findCommunicationEntry keeps pausing when multiple BOSS start-chat actions exist", () => {
  const dom = createDom(`
    <a class="btn btn-startchat" href="/web/geek/chat?id=1">立即沟通</a>
    <a class="btn btn-startchat" href="/web/geek/chat?id=2">立即沟通</a>
  `);

  const result = findCommunicationEntry(dom.window.document);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "ambiguous");
  assert.equal(result.details.count, 2);
});

test("inspectGreetingPage reports a ready chat editor without requiring a communication entry", () => {
  const dom = createDom('<section class="chat-dialog"><textarea></textarea></section>');

  const result = inspectGreetingPage(dom.window.document);

  assert.equal(result.ok, true);
  assert.equal(result.state, "ready");
});

test("prepareGreeting responds before its scheduled communication click runs", () => {
  const dom = createDom('<button id="entry" class="btn-startchat">立即沟通</button>');
  let clicked = false;
  let scheduled;
  dom.window.document.querySelector("#entry").addEventListener("click", () => {
    clicked = true;
  });
  dom.window.setTimeout = (callback) => {
    scheduled = callback;
    return 1;
  };

  const result = prepareGreeting(dom.window.document, dom.window);

  assert.equal(result.ok, true);
  assert.equal(result.state, "opening_chat");
  assert.equal(clicked, false);
  scheduled();
  assert.equal(clicked, true);
});

test("prepareGreeting continues through the BOSS already-sent dialog", () => {
  const dom = createDom(`
    <main>
      <button class="btn-startchat">继续沟通</button>
      <section role="dialog" aria-modal="true">
        <h3>已向BOSS发送消息</h3>
        <p>您好，请问AI产品实习生还在招吗？</p>
        <button id="stay">留在此页</button>
        <button id="continue">继续沟通</button>
      </section>
    </main>
  `);
  let continued = false;
  dom.window.document.querySelector("#continue").addEventListener("click", () => {
    continued = true;
  });

  const result = prepareGreeting(dom.window.document, dom.window, {
    schedule: (callback) => callback()
  });

  assert.equal(result.ok, true);
  assert.equal(result.state, "opening_chat");
  assert.equal(continued, true);
});

test("prepareGreeting marks a missing communication entry as a pre-click failure", () => {
  const dom = createDom("<main>岗位详情</main>");

  const result = prepareGreeting(dom.window.document, dom.window);

  assert.equal(result.ok, false);
  assert.equal(result.code, "communication_entry_missing");
  assert.equal(result.interactionAttempted, false);
});

test("prepareGreeting keeps risk detection batch-stopping before any click", () => {
  const dom = createDom('<div class="dialog">请完成安全验证</div>');

  const result = prepareGreeting(dom.window.document, dom.window);

  assert.equal(result.ok, false);
  assert.equal(result.code, "risk_blocker");
  assert.equal(result.pause, true);
});

test("sendGreetingInChat fills, sends, and confirms on an already-open chat page", async () => {
  const text = "您好，想沟通这个岗位";
  const dom = createDom(`
    <section class="chat-dialog"><textarea></textarea><button id="send">发送</button></section>
    <section class="chat-history"></section>
  `);
  const { document } = dom.window;
  document.querySelector("#send").addEventListener("click", () => {
    const message = document.createElement("div");
    message.className = "message-item";
    message.dataset.direction = "outgoing";
    message.textContent = text;
    document.querySelector(".chat-history").append(message);
  });

  const result = await sendGreetingInChat(document, dom.window, { messageDraft: text }, {
    delay: async () => {},
    pollIntervalMs: 1,
    timeoutMs: 50
  });

  assert.equal(result.ok, true);
  assert.equal(result.confirmationEvidence.text, text);
});

test("findUniqueChatEditor excludes search and prefers a chat container", () => {
  const dom = createDom(`
    <input type="text" placeholder="搜索职位">
    <main><textarea aria-label="备注"></textarea></main>
    <section class="chat-dialog"><div contenteditable="true"></div></section>
  `);

  const result = findUniqueChatEditor(dom.window.document);
  assert.equal(result.ok, true);
  assert.equal(result.element.getAttribute("contenteditable"), "true");
});

test("findUniqueChatEditor reports same-priority ambiguity", () => {
  const dom = createDom(`
    <section class="chat-dialog">
      <textarea></textarea>
      <div contenteditable="true"></div>
    </section>
  `);

  const result = findUniqueChatEditor(dom.window.document);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ambiguous");
  assert.equal(result.details.count, 2);
});

test("findUniqueChatEditor recognizes bare contenteditable and ignores contenteditable false", () => {
  const dom = createDom(`
    <section class="chat-dialog">
      <div contenteditable="false"></div>
      <div id="editor" contenteditable></div>
    </section>
  `);

  const result = findUniqueChatEditor(dom.window.document);

  assert.equal(result.ok, true);
  assert.equal(result.element.id, "editor");
});

test("setEditorText uses the native value setter and dispatches input/change", () => {
  const dom = createDom("<textarea></textarea>");
  const editor = dom.window.document.querySelector("textarea");
  const events = [];
  editor.addEventListener("input", () => events.push("input"));
  editor.addEventListener("change", () => events.push("change"));

  const result = setEditorText(editor, "你好，想沟通岗位。", dom.window);

  assert.equal(result.ok, true);
  assert.equal(editor.value, "你好，想沟通岗位。");
  assert.deepEqual(events, ["input", "change"]);
});

test("setEditorText updates contenteditable with an input event fallback", () => {
  const dom = createDom("<div contenteditable></div>");
  const editor = dom.window.document.querySelector("div");
  let inputSeen = false;
  editor.addEventListener("input", () => {
    inputSeen = true;
  });

  const result = setEditorText(editor, "您好", dom.window);

  assert.equal(result.ok, true);
  assert.equal(editor.textContent, "您好");
  assert.equal(inputSeen, true);
});

test("isVisible rejects opacity zero, inert ancestors, and failed checkVisibility", () => {
  const opacityDom = createDom('<button id="target">发送</button>');
  const originalGetComputedStyle = opacityDom.window.getComputedStyle.bind(opacityDom.window);
  opacityDom.window.getComputedStyle = (element) => {
    const style = originalGetComputedStyle(element);
    return element.id === "target" ? { ...style, opacity: "0" } : style;
  };
  assert.equal(isVisible(opacityDom.window.document.querySelector("#target"), { interactive: true }), false);

  const inertDom = createDom('<section inert><textarea id="target"></textarea></section>');
  assert.equal(isVisible(inertDom.window.document.querySelector("#target"), { interactive: true }), false);

  const checkDom = createDom('<button id="target">发送</button>');
  const target = checkDom.window.document.querySelector("#target");
  let receivedOptions;
  target.checkVisibility = (options) => {
    receivedOptions = options;
    return false;
  };
  assert.equal(isVisible(target, { interactive: true }), false);
  assert.deepEqual(receivedOptions, { checkOpacity: true, checkVisibilityCSS: true });
});

test("interactive finders reject pointer-events none", () => {
  const dom = createDom(`
    <section data-chat-container>
      <button style="pointer-events: none">发送</button>
      <textarea style="pointer-events: none"></textarea>
    </section>
  `);

  assert.equal(
    findUniqueSendButton(dom.window.document, dom.window.document.querySelector("textarea")).reason,
    "missing"
  );
  assert.equal(findUniqueChatEditor(dom.window.document).reason, "missing");
});

test("findUniqueSendButton requires exact visible enabled labels", () => {
  const dom = createDom(`
    <section data-chat-container>
      <textarea></textarea>
      <button>发送记录</button>
      <button disabled>发送</button>
      <button> 立即   发送 </button>
    </section>
  `);

  const result = findUniqueSendButton(dom.window.document, dom.window.document.querySelector("textarea"));
  assert.equal(result.ok, true);
  assert.equal(result.element.textContent.trim(), "立即   发送");
});

test("findUniqueSendButton reports missing and ambiguous buttons", () => {
  const missing = createDom(
    "<section data-chat-container><textarea></textarea><button disabled>发送</button></section>"
  );
  assert.equal(
    findUniqueSendButton(missing.window.document, missing.window.document.querySelector("textarea")).reason,
    "missing"
  );

  const ambiguous = createDom(
    "<section data-chat-container><textarea></textarea><button>发送</button><button>打招呼</button></section>"
  );
  const result = findUniqueSendButton(
    ambiguous.window.document,
    ambiguous.window.document.querySelector("textarea")
  );
  assert.equal(result.reason, "ambiguous");
  assert.equal(result.details.count, 2);
});

test("findUniqueSendButton only accepts the send button scoped to the editor chat container", () => {
  const dom = createDom(`
    <button id="outside-send">发送</button>
    <section data-chat-container>
      <textarea id="editor"></textarea>
      <button id="chat-send">发送</button>
    </section>
  `);
  const { document } = dom.window;
  const result = findUniqueSendButton(document, document.querySelector("#editor"));
  assert.equal(result.ok, true);
  assert.equal(result.element.id, "chat-send");
});

test("confirmMessageSent only accepts message nodes inside chat history", () => {
  const text = "你好，想沟通这个岗位";
  const dom = createDom(`
    <p>${text}</p>
    <section class="chat-dialog"><textarea>${text}</textarea></section>
    <section class="chat-history">
      <div class="message-item" data-direction="incoming">另一条消息</div>
    </section>
  `);
  const editor = dom.window.document.querySelector("textarea");

  const baseline = captureMessageBaseline(dom.window.document, text, editor);
  assert.equal(baseline.count, 0);
  assert.equal(baseline.elements.size, 0);
  assert.equal(typeof baseline.fingerprint, "string");
  assert.equal(confirmMessageSent(dom.window.document, text, editor, baseline).ok, false);

  const message = dom.window.document.createElement("div");
  message.className = "message-item";
  message.dataset.direction = "outgoing";
  message.textContent = `我 12:30 ${text} 已送达`;
  dom.window.document.querySelector(".chat-history").append(message);

  const result = confirmMessageSent(dom.window.document, text, editor, baseline);
  assert.equal(result.ok, true);
  assert.equal(result.evidence.text, text);
  assert.equal(result.evidence.element, message);
});

test("confirmMessageSent rejects a pre-existing identical message until a new one appears", () => {
  const text = "你好，想沟通这个岗位";
  const dom = createDom(`
    <section class="chat-dialog"><textarea></textarea></section>
    <section class="chat-history">
      <div class="message-item" data-direction="outgoing" id="old">${text}</div>
    </section>
  `);
  const { document } = dom.window;
  const editor = document.querySelector("textarea");
  const oldMessage = document.querySelector("#old");
  const baseline = captureMessageBaseline(document, text, editor);

  assert.equal(baseline.count, 1);
  assert.equal(baseline.elements.has(oldMessage), true);
  assert.equal(confirmMessageSent(document, text, editor, baseline).ok, false);

  const newMessage = document.createElement("div");
  newMessage.className = "message-item";
  newMessage.dataset.direction = "outgoing";
  newMessage.textContent = text;
  document.querySelector(".chat-history").append(newMessage);

  const result = confirmMessageSent(document, text, editor, baseline);
  assert.equal(result.ok, true);
  assert.equal(result.evidence.element, newMessage);
  assert.equal(result.evidence.matchCount, 2);
});

test("confirmMessageSent rejects a same-count rerender of matching messages", () => {
  const text = "同一条问候";
  const dom = createDom(`
    <section class="chat-dialog"><textarea></textarea></section>
    <section class="chat-history"><div class="message-item" data-direction="outgoing" data-message-id="same-id">${text}</div></section>
  `);
  const { document } = dom.window;
  const editor = document.querySelector("textarea");
  const baseline = captureMessageBaseline(document, text, editor);
  const replacement = document.createElement("div");
  replacement.className = "message-item";
  replacement.dataset.direction = "outgoing";
  replacement.dataset.messageId = "same-id";
  replacement.textContent = text;
  document.querySelector(".chat-history").replaceChildren(replacement);

  assert.equal(confirmMessageSent(document, text, editor, baseline).ok, false);
});

test("confirmMessageSent rejects a same-count rerender when messages have no stable IDs", () => {
  const text = "无ID重渲染";
  const dom = createDom(`
    <section class="chat-dialog"><textarea></textarea></section>
    <section class="chat-history"><div class="message-item" data-direction="outgoing">${text}</div></section>
  `);
  const { document } = dom.window;
  const editor = document.querySelector("textarea");
  const baseline = captureMessageBaseline(document, text, editor);
  const replacement = document.createElement("div");
  replacement.className = "message-item";
  replacement.dataset.direction = "outgoing";
  replacement.textContent = text;
  document.querySelector(".chat-history").replaceChildren(replacement);

  assert.equal(confirmMessageSent(document, text, editor, baseline).ok, false);
});

test("confirmMessageSent rejects a new stable ID when matching count stays equal", () => {
  const text = "稳定ID确认";
  const dom = createDom(`
    <section class="chat-dialog"><textarea></textarea></section>
    <section class="chat-history">
      <div class="message-item" data-direction="outgoing" data-message-id="old-id">${text}</div>
    </section>
  `);
  const { document } = dom.window;
  const editor = document.querySelector("textarea");
  const baseline = captureMessageBaseline(document, text, editor);
  const replacement = document.createElement("div");
  replacement.className = "message-item";
  replacement.dataset.direction = "outgoing";
  replacement.dataset.messageId = "new-id";
  replacement.textContent = text;
  document.querySelector(".chat-history").replaceChildren(replacement);

  const result = confirmMessageSent(document, text, editor, baseline);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "confirmation_missing");
});

test("confirmMessageSent ignores an incoming identical message", () => {
  const text = "同文对方回复";
  const dom = createDom(`
    <section class="chat-dialog"><textarea></textarea></section>
    <section class="chat-history"></section>
  `);
  const { document } = dom.window;
  const editor = document.querySelector("textarea");
  const baseline = captureMessageBaseline(document, text, editor);
  const incoming = document.createElement("div");
  incoming.className = "message-item";
  incoming.dataset.direction = "incoming";
  incoming.textContent = text;
  document.querySelector(".chat-history").append(incoming);

  assert.equal(confirmMessageSent(document, text, editor, baseline).ok, false);
});

test("an explicit incoming message is rejected even inside an outgoing-named history container", () => {
  const text = "容器类名不能覆盖消息方向";
  const dom = createDom(`
    <section class="chat-dialog"><textarea></textarea></section>
    <section class="chat-history message-right">
      <div class="message-item" data-direction="incoming">${text}</div>
    </section>
  `);
  const { document } = dom.window;
  const editor = document.querySelector("textarea");
  const baseline = { elements: new Set(), identities: [], stableIds: new Set(), count: 0, fingerprint: "" };

  assert.equal(confirmMessageSent(document, text, editor, baseline).ok, false);
});

test("captureMessageBaseline records stable IDs and null identities", () => {
  const text = "基线身份";
  const dom = createDom(`
    <section class="chat-dialog"><textarea></textarea></section>
    <section class="chat-history">
      <div class="message-item" data-direction="outgoing" data-id="stable-one">${text}</div>
      <div class="message-item" data-direction="outgoing">${text}</div>
    </section>
  `);
  const { document } = dom.window;
  const baseline = captureMessageBaseline(document, text, document.querySelector("textarea"));

  assert.equal(baseline.count, 2);
  assert.deepEqual(baseline.identities, ["stable-one", null]);
  assert.deepEqual(Array.from(baseline.stableIds), ["stable-one"]);
});

test("confirmation evidence uses a valid attribute selector for an id stable identity", () => {
  const text = "ID选择器";
  const dom = createDom(`
    <section class="chat-dialog"><textarea></textarea></section>
    <section class="chat-history"></section>
  `);
  const { document } = dom.window;
  const editor = document.querySelector("textarea");
  const baseline = captureMessageBaseline(document, text, editor);
  const message = document.createElement("div");
  message.className = "message-item";
  message.dataset.direction = "outgoing";
  message.id = "message 1";
  message.textContent = text;
  document.querySelector(".chat-history").append(message);

  const result = confirmMessageSent(document, text, editor, baseline);

  assert.equal(result.ok, true);
  assert.equal(result.evidence.stableId, "message 1");
  assert.equal(result.evidence.selector, '[id="message 1"]');
});

test("confirmMessageSent returns the new match even when it is inserted before the baseline node", () => {
  const text = "新增节点证据";
  const dom = createDom(`
    <section class="chat-dialog"><textarea></textarea></section>
    <section class="chat-history"><div class="message-item" data-direction="outgoing" id="old">${text}</div></section>
  `);
  const { document } = dom.window;
  const editor = document.querySelector("textarea");
  const baseline = captureMessageBaseline(document, text, editor);
  const newMessage = document.createElement("div");
  newMessage.className = "message-item";
  newMessage.dataset.direction = "outgoing";
  newMessage.textContent = text;
  document.querySelector(".chat-history").prepend(newMessage);

  const result = confirmMessageSent(document, text, editor, baseline);

  assert.equal(result.ok, true);
  assert.equal(result.evidence.element, newMessage);
});

test("sendGreeting opens communication, sends, and waits for history confirmation", async () => {
  const text = "你好，想沟通这个岗位";
  const dom = createDom('<button id="entry">立即沟通</button><section class="chat-history"></section>');
  const { document } = dom.window;

  document.querySelector("#entry").addEventListener("click", () => {
    const dialog = document.createElement("section");
    dialog.className = "chat-dialog";
    dialog.innerHTML = '<textarea></textarea><button id="send">发送</button>';
    document.body.append(dialog);
    dialog.querySelector("#send").addEventListener("click", () => {
      const message = document.createElement("div");
      message.className = "message-item";
      message.dataset.direction = "outgoing";
      message.textContent = text;
      document.querySelector(".chat-history").append(message);
    });
  });

  const result = await sendGreeting(document, dom.window, { messageDraft: text }, {
    delay: async () => {},
    pollIntervalMs: 1,
    timeoutMs: 50
  });

  assert.equal(result.ok, true);
  assert.equal(result.confirmationEvidence.text, text);
});

test("sendGreeting pauses when confirmation times out", async () => {
  const dom = createDom(`
    <section class="chat-dialog"><textarea></textarea><button>发送</button></section>
    <section class="chat-history"></section>
  `);
  let time = 0;

  const result = await sendGreeting(
    dom.window.document,
    dom.window,
    { messageDraft: "不会出现在历史中的消息" },
    {
      delay: async () => {},
      pollIntervalMs: 1,
      timeoutMs: 20,
      now: () => {
        time += 10;
        return time;
      }
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, "confirmation_timeout");
  assert.equal(result.pause, true);
});

test("sendGreeting does not accept an identical message that existed before clicking send", async () => {
  const text = "历史里已经有的问候";
  const dom = createDom(`
    <section class="chat-dialog"><textarea></textarea><button>发送</button></section>
    <section class="chat-history"><div class="message-item" data-direction="outgoing">${text}</div></section>
  `);
  let time = 0;

  const result = await sendGreeting(
    dom.window.document,
    dom.window,
    { messageDraft: text },
    {
      delay: async (ms) => {
        time += ms;
      },
      pollIntervalMs: 10,
      timeoutMs: 20,
      now: () => time
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, "confirmation_timeout");
});

test("sendGreeting confirms a second identical message added after clicking send", async () => {
  const text = "再次发送相同问候";
  const dom = createDom(`
    <section class="chat-dialog"><textarea></textarea><button id="send">发送</button></section>
    <section class="chat-history"><div class="message-item" data-direction="outgoing">${text}</div></section>
  `);
  const { document } = dom.window;
  document.querySelector("#send").addEventListener("click", () => {
    const message = document.createElement("div");
    message.className = "message-item";
    message.dataset.direction = "outgoing";
    message.textContent = text;
    document.querySelector(".chat-history").append(message);
  });

  const result = await sendGreeting(document, dom.window, { messageDraft: text }, {
    delay: async () => {},
    pollIntervalMs: 1,
    timeoutMs: 20
  });

  assert.equal(result.ok, true);
  assert.equal(result.confirmationEvidence.matchCount, 2);
});

test("sendGreeting never delays beyond the default 8000ms deadline", async () => {
  const dom = createDom(`
    <section class="chat-dialog"><textarea></textarea><button>发送</button></section>
    <section class="chat-history"></section>
  `);
  let time = 0;
  let totalDelay = 0;
  const delays = [];

  const result = await sendGreeting(
    dom.window.document,
    dom.window,
    { messageDraft: "不会确认" },
    {
      delay: async (ms) => {
        delays.push(ms);
        totalDelay += ms;
        time += ms;
      },
      pollIntervalMs: 3000,
      now: () => time
    }
  );

  assert.equal(result.reason, "confirmation_timeout");
  assert.equal(totalDelay, 8000);
  assert.deepEqual(delays, [3000, 3000, 2000]);
});

test("getVisibleJobSignature uses visible job links and honors the limit", () => {
  const dom = createDom(`
    <a href="/job_detail/visible-1.html">岗位一</a>
    <a hidden href="/job_detail/hidden.html">隐藏岗位</a>
    <a href="/other">其他</a>
    <a href="/job_detail/visible-2.html">岗位二</a>
  `);

  assert.equal(
    getVisibleJobSignature(dom.window.document, 1),
    "/job_detail/visible-1.html"
  );
  assert.equal(
    getVisibleJobSignature(dom.window.document),
    "/job_detail/visible-1.html|/job_detail/visible-2.html"
  );
});

test("sendGreeting stops before interaction when risk is visible", async () => {
  const dom = createDom('<main>操作频繁</main><button id="entry">立即沟通</button>');
  let clicked = false;
  dom.window.document.querySelector("#entry").addEventListener("click", () => {
    clicked = true;
  });

  const result = await sendGreeting(
    dom.window.document,
    dom.window,
    { messageDraft: "您好" },
    { delay: async () => {} }
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, "risk_blocker");
  assert.equal(result.pause, true);
  assert.equal(clicked, false);
});
