# Approval Recovery and Send Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users re-approve paused tasks and trigger all approved BOSS greetings from one prominent workbench button.

**Architecture:** Reuse the existing approve API by broadening only the frontend-selectable states to `pending_review` and `paused`. Add a narrow localhost `postMessage` bridge whose content script validates origin and command before forwarding `RUN_APPROVED_TASKS` to the extension service worker; keep all BOSS automation inside the extension.

**Tech Stack:** React, Next.js, TypeScript, Chrome Extension Manifest V3, Vitest, Node test runner.

---

### Task 1: Make paused tasks approvable

**Files:**
- Modify: `apps/web/src/lib/workbench-helpers.ts`
- Modify: `apps/web/src/components/approval-queue.tsx`
- Modify: `apps/web/src/components/approvals-page.tsx`
- Test: `apps/web/test/workbench-helpers.test.ts`
- Test: `apps/web/test/workbench-contract.test.tsx`

- [ ] Add tests that `reconcileSelectedTaskIds` retains `pending_review` and `paused` IDs but rejects `approved`, `sending`, and missing IDs.
- [ ] Add render/source assertions that paused task checkboxes are enabled and “全选可审批” selects both approvable statuses.
- [ ] Run `npx vitest run apps/web/test/workbench-helpers.test.ts apps/web/test/workbench-contract.test.tsx`; expect the paused-selection assertions to fail.
- [ ] Add `isApprovableTask` to the helper, use it in selection reconciliation, queue checkbox eligibility, approvable counts and page-level select-all behavior.
- [ ] Rename the queue callback and button from pending-only language to approvable language.
- [ ] Re-run the focused Web tests; expect all to pass.

### Task 2: Add the localhost Web-to-extension client

**Files:**
- Create: `apps/web/src/lib/extension-bridge.ts`
- Create: `apps/web/test/extension-bridge.test.ts`

- [ ] Write fake-window tests proving bridge readiness matches origin/request ID, ignores unrelated responses, resolves `RUN_APPROVED_TASKS`, and removes listeners/timers on timeout.
- [ ] Run `npx vitest run apps/web/test/extension-bridge.test.ts`; expect failure because the module does not exist.
- [ ] Implement `checkExtensionBridge()` using retryable side-effect-free pings and `runApprovedTasksViaExtension()` using one request with a unique request ID.
- [ ] Accept responses only from the same window, exact localhost origin, extension response source and matching request ID.
- [ ] Re-run the bridge tests; expect all to pass.

### Task 3: Add the approval-page send control

**Files:**
- Create: `apps/web/src/components/approval-send-control.tsx`
- Modify: `apps/web/src/components/approvals-page.tsx`
- Test: `apps/web/test/workbench-contract.test.tsx`

- [ ] Add render assertions for approved/pending/paused counts, “一键自动发送 N 条”, zero-count disablement and disconnected disablement.
- [ ] Add source assertions that the approvals page checks bridge readiness, runs approved tasks, reports the returned message and refreshes task data.
- [ ] Run the focused workbench contract test; expect failures because the control is absent.
- [ ] Implement the control as a compact panel above the queue and coordinate readiness/running/status state in `ApprovalsPage`.
- [ ] Re-run the focused workbench contract test; expect all to pass.

### Task 4: Add the extension-side localhost bridge

**Files:**
- Create: `apps/extension/src/workbench-bridge.js`
- Modify: `apps/extension/src/manifest.json`
- Modify: `apps/extension/test/api-bridge.test.cjs`
- Modify: `apps/extension/test/extension-build.test.cjs`

- [ ] Add source-contract tests requiring the localhost-only content script, exact origin/source/request checks, side-effect-free ping response, and only `RUN_APPROVED_TASKS` forwarding to `chrome.runtime.sendMessage`.
- [ ] Add build assertions that `dist/workbench-bridge.js` exists and the built manifest registers it only for `http://localhost:3000/*`.
- [ ] Run focused extension tests; expect failures because the bridge file and manifest entry are absent.
- [ ] Implement the validated bridge and register it as a separate content-script entry.
- [ ] Re-run focused extension tests; expect all to pass.

### Task 5: Verify without triggering sends

**Files:**
- Verify all changed Web and extension files.

- [ ] Run `npm test`; expect zero failures.
- [ ] Run `npm run typecheck`; expect zero errors.
- [ ] Run `npm run extension:build`; expect the localhost bridge in the loadable extension.
- [ ] Run `git diff --check`; expect no whitespace errors.
- [ ] Reload the extension and refresh `/approvals`; verify button/count/connection rendering without clicking the send button.
- [ ] Commit as `feat: add approval recovery and workbench batch send control`.
