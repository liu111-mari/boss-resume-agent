# Platform Default Greeting Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Process every approved BOSS task sequentially with the platform-default greeting and no custom-message send.

**Architecture:** Keep the existing quota-aware task loop and `PREPARE_GREETING` page action. Change successful chat readiness into structured default-greeting evidence, remove the runner's custom send step, and distinguish safe pre-click page mismatches from batch-stopping uncertainty.

**Tech Stack:** Chrome Manifest V3, CommonJS extension modules, Node test runner, React/Next.js, Vitest.

---

### Task 1: Specify the default-greeting runner behavior

**Files:**
- Modify: `apps/extension/test/task-runner.test.cjs`
- Modify: `apps/extension/src/task-runner.cjs`

- [ ] Add a failing test where two approved tasks reach ready chats, both become `sent`, and no `SEND_GREETING_IN_CHAT` message is emitted.
- [ ] Add a failing test where `communication_entry_missing` fails the first task and the second task still completes.
- [ ] Run `node --test apps/extension/test/task-runner.test.cjs` and confirm the new expectations fail against the custom-message runner.
- [ ] Return structured evidence `{ type: "platform_default_greeting", state: "chat_ready" }` after `PREPARE_GREETING` reaches a ready chat, without issuing the custom send command.
- [ ] Treat explicit pre-click page mismatch results as task failures while preserving batch stops for risk and post-click uncertainty.
- [ ] Re-run the focused task-runner tests and confirm they pass.

### Task 2: Make page-adapter failures identify whether interaction occurred

**Files:**
- Modify: `apps/extension/test/boss-page-adapter.test.cjs`
- Modify: `apps/extension/src/boss-page-adapter.cjs`

- [ ] Add failing assertions that missing or ambiguous communication entries return `interactionAttempted: false`, while risk remains batch-stopping.
- [ ] Run `node --test apps/extension/test/boss-page-adapter.test.cjs` and verify the new contract fails.
- [ ] Add the interaction marker to preparation results without weakening risk detection.
- [ ] Re-run adapter and runner tests.

### Task 3: Align workbench wording with behavior

**Files:**
- Modify: `apps/web/test/workbench-contract.test.tsx`
- Modify: `apps/web/src/components/approval-send-control.tsx`

- [ ] Change the render contract to require `一键平台默认打招呼 N 条` and a description that custom drafts are not sent.
- [ ] Run the focused Vitest contract and verify it fails.
- [ ] Update the component wording only; keep counts and bridge behavior unchanged.
- [ ] Re-run the focused contract and confirm it passes.

### Task 4: Verify and package

**Files:**
- Verify: `apps/extension/dist/*`

- [ ] Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run extension:build`.
- [ ] Run `git diff --check` and inspect the built manifest/scripts.
- [ ] Open the approvals page and verify the new label and extension connection without clicking the batch action.
- [ ] Commit only the feature files and documentation; leave local logs and tool directories untracked.
