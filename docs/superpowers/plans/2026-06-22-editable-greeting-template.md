# Editable Greeting Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the six-part greeting structure editable in the workbench and include it, the full JD, and selected profile evidence in every DeepSeek refinement request.

**Architecture:** Reuse the existing `GreetingTemplate.body` field as the single persisted template source. Update the default value and UI binding, then extend only the refinement prompt payload; keep the current local rendering and fact-guard pipeline unchanged.

**Tech Stack:** TypeScript, React, Next.js, Zod, Vitest.

---

### Task 1: Default six-part template

**Files:**
- Modify: `apps/web/src/lib/domain-store.ts`
- Test: `apps/web/test/domain-store.test.ts`

- [ ] Add a test that a fresh store returns version 2 and a directly sendable six-part `body` containing `{{jobTitle}}`, `{{selfIntro}}`, `{{projects}}`, a matching-advantage section, `{{skills}}`, and the resume-response closing.
- [ ] Run `npm run test:web -- --run apps/web/test/domain-store.test.ts` and verify the new assertion fails against version 1.
- [ ] Replace `defaultTemplate.body` with the approved six-part template and set `version: 2`.
- [ ] Re-run the focused test and verify it passes.

### Task 2: DeepSeek receives template and JD

**Files:**
- Modify: `apps/web/src/lib/model-provider.ts`
- Test: `apps/web/test/model-provider.test.ts`

- [ ] Add a request-capture assertion proving the refinement prompt contains `template.body`, `job.jdText`, selected profile items, and the no-new-facts instruction.
- [ ] Run `npm run test:web -- --run apps/web/test/model-provider.test.ts` and verify the prompt assertion fails because body/JD are absent.
- [ ] Add `body` to the prompt template payload and `jdText` to the job payload.
- [ ] Re-run the focused test and verify it passes.

### Task 3: Separate template body and banned phrases in the UI

**Files:**
- Modify: `apps/web/src/components/template-settings.tsx`
- Test: `apps/web/test/workbench-contract.test.tsx`

- [ ] Add contract assertions that the “话术结构模板” textarea reads/writes `template.body` and the “禁用词” textarea independently reads/writes `template.bannedPhrases`.
- [ ] Run `npm run test:web -- --run apps/web/test/workbench-contract.test.tsx` and verify the body-binding assertion fails.
- [ ] Replace the mislabeled textarea with the body editor, add a separate banned-phrases editor, and explain that the body is sent with each DeepSeek generation.
- [ ] Re-run the focused test and verify it passes.

### Task 4: Verification and commit

**Files:**
- Verify all modified files.

- [ ] Run `npm run test:web`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build -w @boss-agent/web`.
- [ ] Run `git diff --check`.
- [ ] Commit the implementation as `feat: add editable greeting structure template`.
