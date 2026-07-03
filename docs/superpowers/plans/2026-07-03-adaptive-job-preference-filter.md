# Adaptive Job Preference Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editable job-preference rules, positive/negative feedback, user-triggered DeepSeek rule proposals, correction/regeneration, preview, and safe job removal.

**Architecture:** Store feedback, versioned rules, and suggestion batches in local JSON repositories. Apply confirmed hard rules deterministically before the existing score call, pass confirmed soft preferences into the existing model score prompt, and isolate feedback analysis behind a schema-validated optimizer. The model never mutates active rules directly.

**Tech Stack:** TypeScript, Zod, Next.js App Router, React, local JSON repositories, DeepSeek-compatible chat completions, Vitest.

---

### Task 1: Shared preference domain and deterministic evaluation

**Files:**
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/preferences.ts`
- Test: `apps/web/test/preference-filter.test.ts`

- [ ] Write failing tests for title/industry/JD excludes, grouped title includes, inactive rules, soft rules, and preview classification.
- [ ] Run `npx vitest run apps/web/test/preference-filter.test.ts` and verify failures are caused by missing preference exports.
- [ ] Add Zod schemas and exported types for feedback, rules, candidate rules, and suggestion batches.
- [ ] Implement `evaluatePreferenceRules(job, rules)` and `previewPreferenceRule(jobs, activeRules, candidate)`.
- [ ] Add editable default rules for the approved information-management preset.
- [ ] Re-run the focused tests.

### Task 2: Local persistence and safe feedback mutations

**Files:**
- Modify: `apps/web/src/lib/domain-store.ts`
- Test: `apps/web/test/domain-store.test.ts`

- [ ] Write failing tests for positive feedback, negative removal, neutral removal, sending-task blocking, task cancellation, feedback undo, rule persistence, and suggestion persistence.
- [ ] Run the focused domain-store tests and verify the new methods are missing.
- [ ] Add repositories for `preference-feedback.json`, `preference-rules.json`, and `preference-suggestions.json`.
- [ ] Implement `recordJobFeedback`, `removeJobs`, `undoPreferenceFeedback`, `getPreferenceState`, `savePreferenceRules`, `saveSuggestionBatch`, and `updateSuggestionBatch`.
- [ ] Preserve sent history, store negative snapshots before removal, and remove the duplicate unreachable return block in the existing dirty implementation.
- [ ] Re-run domain-store tests.

### Task 3: Preference optimizer and correction loop

**Files:**
- Create: `apps/web/src/lib/preference-optimizer.ts`
- Test: `apps/web/test/preference-optimizer.test.ts`

- [ ] Write failing tests for strict JSON parsing, title/industry/JD prompt evidence, previous-draft correction context, unknown sample rejection, and missing-provider failure.
- [ ] Run the focused optimizer tests and verify RED.
- [ ] Implement a DeepSeek-compatible optimizer configured from existing greeting-model environment variables.
- [ ] Validate every candidate with Zod, reject unknown evidence IDs, and return provider/model/cost metadata.
- [ ] Re-run optimizer tests.

### Task 4: Preference APIs

**Files:**
- Create: `apps/web/src/app/api/preferences/route.ts`
- Create: `apps/web/src/app/api/preferences/feedback/route.ts`
- Create: `apps/web/src/app/api/preferences/feedback/undo/route.ts`
- Create: `apps/web/src/app/api/preferences/suggestions/generate/route.ts`
- Create: `apps/web/src/app/api/preferences/suggestions/apply/route.ts`
- Create: `apps/web/src/app/api/preferences/rules/route.ts`
- Create: `apps/web/src/app/api/preferences/preview/route.ts`
- Modify: `apps/web/test/api-contracts.test.ts`

- [ ] Add failing API tests for all mutation and read boundaries.
- [ ] Implement strict request schemas and API error handling.
- [ ] Keep generation user-triggered; accept edited candidates atomically; expose read-only preview.
- [ ] Re-run API tests.

### Task 5: Integrate confirmed rules into filtering and scoring

**Files:**
- Modify: `packages/shared/src/filter.ts`
- Modify: `apps/web/src/lib/greeting-pipeline.ts`
- Modify: `apps/web/src/lib/model-provider.ts`
- Modify: `apps/web/src/app/api/tasks/create-from-jobs/route.ts`
- Test: `apps/web/test/filter-and-template.test.ts`
- Test: `apps/web/test/greeting-pipeline.test.ts`
- Test: `apps/web/test/model-provider.test.ts`

- [ ] Add failing tests proving confirmed hard rules reject before the model and soft rules appear in the existing score prompt.
- [ ] Load active rules in both task-creation paths and pass them into `evaluateJob`.
- [ ] Extend score input with optional soft preference statements without adding another per-job model call.
- [ ] Re-run focused pipeline/provider tests.

### Task 6: Job-library feedback and batch removal UI

**Files:**
- Modify: `apps/web/src/lib/client-api.ts`
- Modify: `apps/web/src/components/jobs-page.tsx`
- Modify: `apps/web/src/app/globals.css`
- Test: `apps/web/test/page-ui-contract.test.tsx`

- [ ] Add failing render/source tests for row selection, positive, negative-remove, neutral-remove, focus fields, note, batch actions, and undo.
- [ ] Add client API functions and implement the job-library controls with explicit feedback semantics.
- [ ] Show blocked sending jobs, canceled task count, and feedback count after each action.
- [ ] Re-run UI tests.

### Task 7: Preference learning and editable rule UI

**Files:**
- Create: `apps/web/src/components/preference-learning.tsx`
- Modify: `apps/web/src/components/filters-page.tsx`
- Modify: `apps/web/src/lib/client-api.ts`
- Test: `apps/web/test/workbench-contract.test.tsx`

- [ ] Add failing contracts for counts, five-sample readiness, manual generation, correction/regeneration, editable candidates, preview, apply, active-rule editing, disable, and rollback-visible versions.
- [ ] Load preference state beside filter config and render the learning panel below base settings.
- [ ] Implement candidate editing and selected application; never activate on generation alone.
- [ ] Re-run workbench tests.

### Task 8: Verification and integration

**Files:**
- Verify all changed files and existing uncommitted deletion work.

- [ ] Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check`.
- [ ] Browser-test job feedback and preference UI using non-sending operations only.
- [ ] Confirm no model call occurs on delete/render and no greeting is sent during QA.
- [ ] Commit only reviewed feature files; leave logs and tool directories untracked.
