# Job XLSX Export and Detail Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export all or selected jobs to a formatted XLSX file while truthfully reporting missing detail data, and let the desktop extension enrich missing BOSS detail pages before export.

**Architecture:** Keep export generation server-side in the Next.js app with ExcelJS, using the existing local job store as the only source of truth. Keep enrichment independent: the workbench asks the Chrome extension to visit missing detail URLs sequentially, the existing content script ingests each detail page, and export remains available even when enrichment pauses or fails.

**Tech Stack:** Next.js route handlers, React, TypeScript, ExcelJS, Chrome Manifest V3 extension, Vitest, Node test runner.

---

### Task 1: Export model and XLSX route

**Files:**
- Create: `apps/web/src/lib/job-export.ts`
- Create: `apps/web/src/app/api/jobs/export/route.ts`
- Create: `apps/web/test/job-export.test.ts`
- Modify: `apps/web/package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write failing tests**

Test that completeness counts only `jdSource === "detail"` with non-empty JD as complete, exported rows preserve the original JD, spreadsheet-formula prefixes are neutralized, and the route returns a valid XLSX response containing all requested columns.

- [ ] **Step 2: Run tests and confirm RED**

Run: `npx vitest run apps/web/test/job-export.test.ts`

Expected: FAIL because the export helper and route do not exist.

- [ ] **Step 3: Implement the minimal export**

Add `exceljs` to the web workspace. Generate one worksheet named `岗位明细` with filters, frozen header, wrapped JD cells, clickable BOSS links, typed collection dates, and columns for title, company, salary, city, experience, education, industry, direction, HR, JD status, exact JD, detail URL, collection time, and raw text. Return a dated `.xlsx` download and support an optional list of selected job IDs.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run apps/web/test/job-export.test.ts`

Expected: PASS.

### Task 2: Workbench export controls and truthful completeness

**Files:**
- Modify: `apps/web/src/components/jobs-page.tsx`
- Modify: `apps/web/src/lib/client-api.ts`
- Modify: `apps/web/test/preference-ui.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Require visible `导出全部岗位`, `导出选中岗位`, `补全缺失详情`, and `完整 JD` count text. Require selected export to remain disabled when no jobs are selected.

- [ ] **Step 2: Run tests and confirm RED**

Run: `npx vitest run apps/web/test/preference-ui.test.tsx`

Expected: FAIL because export controls are absent.

- [ ] **Step 3: Implement export downloads**

Add a binary download helper that validates non-JSON error responses, derives the filename from `Content-Disposition`, and revokes object URLs after download. Show total, complete, and missing-detail counts without treating list summaries as complete JD.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run apps/web/test/preference-ui.test.tsx apps/web/test/client-api.test.ts`

Expected: PASS.

### Task 3: Sequential detail enrichment

**Files:**
- Create: `apps/extension/src/job-enrichment-runner.cjs`
- Create: `apps/extension/test/job-enrichment-runner.test.cjs`
- Modify: `apps/extension/src/background.js`
- Modify: `apps/extension/src/workbench-bridge.js`
- Modify: `apps/extension/src/manifest.json`
- Modify: `apps/web/src/lib/extension-bridge.ts`
- Modify: `apps/web/src/components/jobs-page.tsx`
- Modify: `apps/web/test/extension-bridge.test.ts`
- Modify: `apps/extension/test/api-bridge.test.cjs`

- [ ] **Step 1: Write failing runner and bridge tests**

Require sequential detail-tab collection, pacing, tab cleanup, duplicate-run rejection, and immediate stop on login, captcha, verification, or security responses. Require the workbench bridge to preserve request IDs and return enrichment counts.

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test -w @boss-agent/extension && npx vitest run apps/web/test/extension-bridge.test.ts`

Expected: FAIL because enrichment messages and runner are absent.

- [ ] **Step 3: Implement enrichment**

Filter to jobs with a detail URL and without a detail-sourced JD. Open one BOSS detail tab at a time, wait for load and page settling, invoke the existing `COLLECT_VISIBLE_JOBS` content-script command, close the tab, then pace before the next job. Keep the job page usable when enrichment fails; refresh the job data and show completed, failed, or paused counts.

- [ ] **Step 4: Run focused tests**

Run: `npm test -w @boss-agent/extension && npx vitest run apps/web/test/extension-bridge.test.ts apps/web/test/preference-ui.test.tsx`

Expected: PASS.

### Task 4: Full verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run all checks**

Run: `npm test`

Run: `npm run typecheck --workspaces`

Run: `npm run lint -w @boss-agent/web`

Run: `npm run build --workspaces`

Expected: all commands exit successfully.

- [ ] **Step 2: Verify the generated workbook**

Call the local export route, load the result with ExcelJS, verify row count, headers, complete/missing labels, exact JD preservation, and hyperlink cells. Open the workbook in Excel or WPS-compatible form and visually inspect header, widths, wrapping, and filters.

- [ ] **Step 3: Browser smoke test**

Open `/jobs`, verify completeness counts and export controls, exercise an XLSX download, and confirm no framework or console errors. Do not run real BOSS enrichment without an explicit user-triggered action.
