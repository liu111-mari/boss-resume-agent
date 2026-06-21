const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const adapter = require("../src/boss-page-adapter.cjs");
const {
  detectRiskBlocker,
  findCommunicationEntry,
  findUniqueChatEditor,
  setEditorText,
  findUniqueSendButton,
  confirmMessageSent,
  sendGreeting
} = adapter;

function createDom(body) {
  return new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    url: "https://www.zhipin.com/web/geek/job"
  });
}

test("adapter is exported through CommonJS and the global namespace", () => {
  assert.equal(globalThis.BossPageAdapter, adapter);
});

test("detectRiskBlocker reports visible BOSS risk text", () => {
  for (const text of ["验证码", "安全验证", "登录后继续", "账号异常", "访问过于频繁", "操作频繁", "风险提示"]) {
    const dom = createDom(`<main>${text}</main>`);
    const result = detectRiskBlocker(dom.window.document);
    assert.equal(result.ok, false, text);
    assert.equal(result.reason, "risk_blocker", text);
    assert.match(result.details.text, new RegExp(text), text);
  }
});

test("detectRiskBlocker recognizes visible risk text split across elements", () => {
  const dom = createDom("<main><strong>安全</strong><span>验证</span></main>");

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
  const dom = createDom('<div contenteditable="true"></div>');
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

test("findUniqueSendButton requires exact visible enabled labels", () => {
  const dom = createDom(`
    <button>发送记录</button>
    <button disabled>发送</button>
    <button> 立即   发送 </button>
  `);

  const result = findUniqueSendButton(dom.window.document);
  assert.equal(result.ok, true);
  assert.equal(result.element.textContent.trim(), "立即   发送");
});

test("findUniqueSendButton reports missing and ambiguous buttons", () => {
  const missing = createDom("<button disabled>发送</button>");
  assert.equal(findUniqueSendButton(missing.window.document).reason, "missing");

  const ambiguous = createDom("<button>发送</button><button>打招呼</button>");
  const result = findUniqueSendButton(ambiguous.window.document);
  assert.equal(result.reason, "ambiguous");
  assert.equal(result.details.count, 2);
});

test("confirmMessageSent only accepts message nodes inside chat history", () => {
  const text = "你好，想沟通这个岗位";
  const dom = createDom(`
    <p>${text}</p>
    <section class="chat-dialog"><textarea>${text}</textarea></section>
    <section class="chat-history">
      <div class="message-item">另一条消息</div>
    </section>
  `);
  const editor = dom.window.document.querySelector("textarea");

  assert.equal(confirmMessageSent(dom.window.document, text, editor).ok, false);

  const message = dom.window.document.createElement("div");
  message.className = "message-item";
  message.textContent = `我 12:30 ${text} 已送达`;
  dom.window.document.querySelector(".chat-history").append(message);

  const result = confirmMessageSent(dom.window.document, text, editor);
  assert.equal(result.ok, true);
  assert.equal(result.evidence.text, text);
  assert.equal(result.evidence.element, message);
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
