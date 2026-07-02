# Resumable BOSS Batch Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one approved batch action reliably continue across BOSS job-to-chat navigation and send each approved greeting only after chat-history confirmation.

**Architecture:** Split page work into `PREPARE_GREETING` and `SEND_GREETING_IN_CHAT`. The background runner owns navigation recovery and polls the source tab plus opener-linked BOSS tabs until a content-script inspection reports a ready chat editor; page code owns only DOM inspection, entry click, editor fill, send click, and confirmation.

**Tech Stack:** Chrome Extension Manifest V3, CommonJS browser-compatible modules, Node test runner, JSDOM.

---

### Task 1: Split page preparation from chat sending

**Files:**
- Modify: `apps/extension/src/boss-page-adapter.cjs`
- Test: `apps/extension/test/boss-page-adapter.test.cjs`

- [ ] Add tests proving `inspectGreetingPage` returns `ready` for a chat editor, `prepareGreeting` responds with `opening_chat` before its scheduled click runs, and `sendGreetingInChat` fills, clicks and confirms without searching for a communication entry.
- [ ] Run `node --test --test-name-pattern="inspectGreetingPage|prepareGreeting|sendGreetingInChat" apps/extension/test/boss-page-adapter.test.cjs`; expect failures because the three APIs are not exported.
- [ ] Implement `inspectGreetingPage(document)`, `prepareGreeting(document, window, options)` and `sendGreetingInChat(document, window, task, options)`. Schedule the communication-entry click through `window.setTimeout`, return before the click, and return stage-specific `code` values such as `communication_entry_missing`, `chat_editor_missing`, `send_button_missing`, `confirmation_timeout` and `risk_blocker`.
- [ ] Keep `sendGreeting` as a compatibility wrapper over the new functions for existing callers and tests.
- [ ] Re-run the focused adapter tests; expect all matching tests to pass.

### Task 2: Recover navigation and new-tab chat targets

**Files:**
- Modify: `apps/extension/src/task-runner.cjs`
- Test: `apps/extension/test/task-runner.test.cjs`

- [ ] Add tests for `waitForChatTarget`: same-tab chat readiness, opener-linked new-tab readiness, transient missing receiver, risk result, and timeout.
- [ ] Add a runner test where preparation returns `opening_chat`, the target resolves to a second tab, and `SEND_GREETING_IN_CHAT` runs on that tab before the task becomes `sent`.
- [ ] Run `node --test apps/extension/test/task-runner.test.cjs`; expect failures because the navigation helper and two-stage protocol do not exist.
- [ ] Implement exported `waitForChatTarget(tabs, sourceTabId, inspectTab, delay, options)` by polling `tabs.get(sourceTabId)` and `tabs.query({ openerTabId: sourceTabId })`, accepting only `https://*.zhipin.com/*`, and requiring `{ ok: true, state: "ready" }` from inspection.
- [ ] Change `runOneTask` to send `PREPARE_GREETING`, wait for a chat target only when state is `opening_chat`, then send `SEND_GREETING_IN_CHAT` to the resolved tab.
- [ ] Persist `result.code` as `failureReason`, and return the source/final tab IDs so background cleanup can be deterministic.
- [ ] Re-run task-runner tests; expect all to pass.

### Task 3: Wire reliable content-script injection and tab inspection

**Files:**
- Modify: `apps/extension/src/content.js`
- Modify: `apps/extension/src/background.js`
- Test: `apps/extension/test/api-bridge.test.cjs`

- [ ] Add source-contract tests requiring the new message names, shared missing-receiver retry helper, inspection polling dependency, and task-tab cleanup hooks.
- [ ] Run `node --test apps/extension/test/api-bridge.test.cjs`; expect the new contract assertions to fail.
- [ ] Route `INSPECT_GREETING_PAGE`, `PREPARE_GREETING`, and `SEND_GREETING_IN_CHAT` in `content.js` to the three adapter APIs.
- [ ] Add `sendToBossTab(tabId, message)` in `background.js`: on a missing receiver, inject `job-extractor.js`, `boss-page-adapter.js`, and `content.js`, then retry once.
- [ ] Provide the runner with `tabs`, `inspectTab`, task-tab closing, and pacing dependencies. Close extension-created tabs after confirmed success or non-risk failure; preserve the active tab on risk/auth pause.
- [ ] Re-run the API bridge tests; expect all to pass.

### Task 4: Build and verify without real sends

**Files:**
- Verify: `apps/extension/src/*`
- Verify: `apps/extension/dist/*`

- [ ] Run `npm test -w @boss-agent/extension`; expect zero failures.
- [ ] Run `npm run extension:build`; expect Chrome-loadable JavaScript in `apps/extension/dist`.
- [ ] Run `npm run typecheck`; expect zero TypeScript errors.
- [ ] Run `git diff --check`; expect no whitespace errors.
- [ ] Inspect a real BOSS page only after the user clears the security page; do not click communication or send controls during validation.
- [ ] Commit source, tests and plan as `fix: resume BOSS batch sending across chat navigation`.

