# BOSS Personalized Greeting Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent, configurable BOSS job filtering and personalized greeting workflow with low-cost AI scoring, human approval, verified sending, quota controls, and diagnostic replay.

**Architecture:** Keep shared schemas and pure domain logic in `packages/shared`, persistent JSON repositories and model providers in `apps/web`, and all BOSS DOM interaction in isolated CommonJS adapters under `apps/extension`. The web app owns configuration, scoring, generation, approval, quotas, and logs; the extension only collects page data and executes approved tasks through explicit state transitions.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zod, Vercel AI SDK/OpenAI-compatible DeepSeek API, Node test runner, JSDOM, local JSON files.

---

## File structure

Create or change these focused units:

```text
packages/shared/src/index.ts
  Shared schemas, task states, API payloads, and public types.

packages/shared/src/filter.ts
  Pure hard-filter and salary parsing logic.

packages/shared/src/template.ts
  Pure profile selection and greeting template rendering.

apps/web/src/lib/local-repository.ts
  Validated, atomic JSON persistence.

apps/web/src/lib/domain-store.ts
  Repository-backed operations and task state transitions.

apps/web/src/lib/model-provider.ts
  Provider interface, DeepSeek implementation, local fallback, cost metadata.

apps/web/src/lib/greeting-pipeline.ts
  Filter → score → select profile → render/refine → queue orchestration.

apps/web/src/lib/diagnostics.ts
  Redacted logs and export.

apps/web/src/app/api/config/route.ts
apps/web/src/app/api/profile/route.ts
apps/web/src/app/api/greeting-template/route.ts
apps/web/src/app/api/pipeline/run/route.ts
apps/web/src/app/api/tasks/route.ts
apps/web/src/app/api/tasks/approve/route.ts
apps/web/src/app/api/tasks/approved/route.ts
apps/web/src/app/api/tasks/status/route.ts
apps/web/src/app/api/run-summary/route.ts
apps/web/src/app/api/diagnostics/export/route.ts
  HTTP boundary with schema validation.

apps/web/src/components/filter-settings.tsx
apps/web/src/components/profile-editor.tsx
apps/web/src/components/template-settings.tsx
apps/web/src/components/approval-queue.tsx
apps/web/src/components/run-status.tsx
apps/web/src/app/page.tsx
apps/web/src/app/globals.css
  Editable workbench UI; no resume generation UI.

apps/extension/src/boss-page-adapter.cjs
  Risk checks, selectors, editor writes, and sent-message confirmation.

apps/extension/src/content.js
apps/extension/src/background.js
apps/extension/src/popup.*
  Collection and approved-task execution using the adapter.

apps/web/test/*.test.ts
apps/extension/test/*.test.cjs
  Domain, persistence, pipeline, quota, adapter, and safety tests.
```

At execution start, use `superpowers:using-git-worktrees` and create an isolated `codex/greeting-automation` worktree before changing business code.

### Task 1: Add the test harness and shared domain schemas

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Modify: `packages/shared/package.json`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/filter.ts`
- Create: `packages/shared/src/template.ts`
- Create: `apps/web/test/shared-domain.test.ts`

- [ ] **Step 1: Add a failing shared-domain test**

Create `apps/web/test/shared-domain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  filterConfigSchema,
  greetingTaskSchema,
  profileSchema,
  greetingTemplateSchema
} from "@boss-agent/shared";

describe("greeting automation schemas", () => {
  it("parses the single active configuration and expanded task state", () => {
    const config = filterConfigSchema.parse({
      targetTitles: ["AI 产品经理"],
      cities: ["北京"],
      minSalary: 100,
      maxSalary: 300,
      employmentTypes: ["internship"],
      requiredKeywords: ["AI"],
      excludedKeywords: ["销售"],
      blockedCompanies: [],
      blockedIndustries: [],
      allowedExperience: ["在校/应届", "经验不限"],
      allowedEducation: ["本科"],
      scoreThreshold: 70,
      dailyLimit: 100
    });

    expect(config.dailyLimit).toBe(100);
    expect(
      greetingTaskSchema.parse({
        id: "task-1",
        jobId: "job-1",
        jobTitle: "AI 产品经理实习生",
        company: "示例公司",
        detailUrl: "https://www.zhipin.com/job_detail/1.html",
        messageDraft: "您好",
        status: "pending_review",
        createdAt: "2026-06-18T00:00:00.000Z",
        updatedAt: "2026-06-18T00:00:00.000Z"
      }).status
    ).toBe("pending_review");
  });

  it("requires editable profile and template records", () => {
    expect(profileSchema.parse({ school: "", major: "", graduation: "", direction: "", items: [] }).items).toEqual([]);
    expect(
      greetingTemplateSchema.parse({
        body: "您好，我是{{school}}{{major}}的学生，看到贵司{{jobTitle}}岗位。",
        tone: "自然",
        minLength: 30,
        maxLength: 120,
        maxSkills: 2,
        maxProjects: 1,
        bannedPhrases: [],
        version: 1
      }).version
    ).toBe(1);
  });
});
```

- [ ] **Step 2: Add Vitest scripts and verify RED**

Modify the root scripts:

```json
"test:web": "vitest run apps/web/test",
"test": "npm run test:web && npm test -w @boss-agent/extension"
```

Add root dev dependency:

```json
"vitest": "^3.2.4"
```

Create `vitest.config.ts`:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/web/src"),
      "@boss-agent/shared": path.resolve(__dirname, "packages/shared/src/index.ts")
    }
  },
  test: {
    environment: "node",
    clearMocks: true
  }
});
```

Run:

```powershell
npm install
npm run test:web -- shared-domain.test.ts
```

Expected: FAIL because the new schemas are not exported.

- [ ] **Step 3: Implement the schemas**

In `packages/shared/src/index.ts`, add:

```ts
export const filterConfigSchema = z.object({
  targetTitles: z.array(z.string()).default([]),
  cities: z.array(z.string()).default([]),
  minSalary: z.number().nonnegative().nullable().default(null),
  maxSalary: z.number().nonnegative().nullable().default(null),
  employmentTypes: z.array(z.enum(["internship", "campus", "social"])).default([]),
  requiredKeywords: z.array(z.string()).default([]),
  excludedKeywords: z.array(z.string()).default([]),
  blockedCompanies: z.array(z.string()).default([]),
  blockedIndustries: z.array(z.string()).default([]),
  allowedExperience: z.array(z.string()).default([]),
  allowedEducation: z.array(z.string()).default([]),
  scoreThreshold: z.number().min(0).max(100).default(70),
  dailyLimit: z.number().int().min(1).max(150).default(100)
});

export const profileItemSchema = z.object({
  id: z.string(),
  category: z.enum(["skill", "project", "intro", "other"]),
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  enabled: z.boolean().default(true)
});

export const profileSchema = z.object({
  school: z.string().default(""),
  major: z.string().default(""),
  graduation: z.string().default(""),
  direction: z.string().default(""),
  items: z.array(profileItemSchema).default([])
});

export const greetingTemplateSchema = z.object({
  body: z.string().min(1),
  tone: z.string().default("自然"),
  minLength: z.number().int().min(1).default(30),
  maxLength: z.number().int().min(20).max(500).default(120),
  maxSkills: z.number().int().min(0).max(10).default(2),
  maxProjects: z.number().int().min(0).max(5).default(1),
  bannedPhrases: z.array(z.string()).default([]),
  version: z.number().int().positive().default(1)
});

export const greetingTaskStatusSchema = z.enum([
  "collected", "filtered", "scored", "generated", "pending_review",
  "approved", "sending", "sent", "rejected", "failed", "paused", "quota_blocked"
]);
```

Expand `jobCardSchema` with defaulted `experience`, `education`, `industry`, and `rawText` strings. Replace the old greeting status enum with `greetingTaskStatusSchema`, and add defaulted fields:

```ts
score: z.number().min(0).max(100).optional(),
matchReasons: z.array(z.string()).default([]),
matchedRequirements: z.array(z.string()).default([]),
missingRequirements: z.array(z.string()).default([]),
usedProfileItemIds: z.array(z.string()).default([]),
modelProvider: z.string().default("local"),
modelName: z.string().default("template"),
templateVersion: z.number().int().positive().default(1),
estimatedCostCny: z.number().nonnegative().default(0),
updatedAt: z.string()
```

Export inferred types for all new schemas.

- [ ] **Step 4: Run the test and typecheck**

Run:

```powershell
npm run test:web -- shared-domain.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json vitest.config.ts packages/shared apps/web/test/shared-domain.test.ts
git commit -m "feat: add greeting automation domain schemas"
```

### Task 2: Implement hard filtering and template rendering

**Files:**
- Modify: `packages/shared/src/filter.ts`
- Modify: `packages/shared/src/template.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `apps/web/test/filter-and-template.test.ts`

- [ ] **Step 1: Write failing behavior tests**

Create `apps/web/test/filter-and-template.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { evaluateJob, renderGreeting, selectProfileItems } from "@boss-agent/shared";

const config = {
  targetTitles: ["产品经理"],
  cities: ["北京"],
  minSalary: 100,
  maxSalary: 300,
  employmentTypes: ["internship"] as const,
  requiredKeywords: ["AI"],
  excludedKeywords: ["销售"],
  blockedCompanies: ["黑名单公司"],
  blockedIndustries: [],
  allowedExperience: ["在校/应届"],
  allowedEducation: ["本科"],
  scoreThreshold: 70,
  dailyLimit: 100
};

it("rejects excluded jobs before AI scoring", () => {
  const result = evaluateJob({
    id: "1", title: "AI 产品销售", company: "示例", city: "北京",
    salary: "150-200元/天", experience: "在校/应届", education: "本科",
    industry: "互联网", jdText: "负责 AI 产品销售", rawText: "",
    collectedAt: "2026-06-18T00:00:00.000Z"
  }, config);
  expect(result).toEqual({ accepted: false, reasons: ["命中排除关键词：销售"] });
});

it("selects tagged profile facts and renders bounded greeting text", () => {
  const items = selectProfileItems([
    { id: "sql", category: "skill", content: "熟悉 SQL", tags: ["SQL", "数据"], enabled: true },
    { id: "design", category: "skill", content: "熟悉 Figma", tags: ["设计"], enabled: true }
  ], ["SQL", "数据分析"], 2, 1);
  expect(items.map((item) => item.id)).toEqual(["sql"]);
  expect(renderGreeting({
    template: "您好，我是{{school}}{{major}}学生，关注到{{company}}的{{jobTitle}}，{{skills}}。",
    values: {
      school: "示例大学",
      major: "信息管理",
      company: "示例公司",
      jobTitle: "数据分析实习生",
      skills: "熟悉 SQL"
    },
    minLength: 20,
    maxLength: 100,
    bannedPhrases: []
  })).toContain("熟悉 SQL");
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm run test:web -- filter-and-template.test.ts
```

Expected: FAIL because pure functions are missing.

- [ ] **Step 3: Implement pure filtering and templating**

Implement `evaluateJob` in `packages/shared/src/filter.ts` with deterministic check order:

1. blocked company
2. excluded keyword
3. target title
4. city
5. required keyword
6. experience
7. education
8. normalized salary range

Return:

```ts
export type HardFilterResult =
  | { accepted: true; reasons: string[] }
  | { accepted: false; reasons: string[] };
```

Implement salary parsing for `150-200元/天` and `15-25K`; compare only when both configured limits and parsed salary exist. Never reject because salary is absent; record `薪资未识别` as a passing reason.

Implement in `packages/shared/src/template.ts`:

```ts
export function selectProfileItems(
  items: ProfileItem[],
  keywords: string[],
  maxSkills: number,
  maxProjects: number
): ProfileItem[];

export function renderGreeting(input: {
  template: string;
  values: Record<string, string>;
  minLength: number;
  maxLength: number;
  bannedPhrases: string[];
}): string;
```

`renderGreeting` must replace unknown variables with an empty string, collapse whitespace, reject banned phrases, and throw if the final text is outside the configured bounds.

Re-export these modules from `packages/shared/src/index.ts`.

- [ ] **Step 4: Run focused and shared tests**

```powershell
npm run test:web -- filter-and-template.test.ts
npm run test:web
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/shared apps/web/test/filter-and-template.test.ts
git commit -m "feat: add deterministic job filtering and templates"
```

### Task 3: Replace the in-memory store with validated local persistence

**Files:**
- Modify: `.gitignore`
- Create: `apps/web/src/lib/local-repository.ts`
- Create: `apps/web/src/lib/domain-store.ts`
- Delete: `apps/web/src/lib/store.ts`
- Create: `apps/web/test/local-repository.test.ts`

- [ ] **Step 1: Write failing persistence tests**

Use a temporary directory and test:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { JsonRepository } from "@/lib/local-repository";

describe("JsonRepository", () => {
  let directory = "";
  afterEach(async () => directory && rm(directory, { recursive: true, force: true }));

  it("persists validated data with an atomic replacement", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "boss-agent-"));
    const repository = new JsonRepository(path.join(directory, "config.json"), z.object({ value: z.number() }), { value: 1 });
    await repository.write({ value: 2 });
    expect(await repository.read()).toEqual({ value: 2 });
    expect(JSON.parse(await readFile(path.join(directory, "config.json"), "utf8"))).toEqual({ value: 2 });
  });

  it("backs up invalid JSON instead of silently overwriting it", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "boss-agent-"));
    const filename = path.join(directory, "config.json");
    await writeFile(filename, "{broken", "utf8");
    const repository = new JsonRepository(filename, z.object({ value: z.number() }), { value: 1 });
    await expect(repository.read()).rejects.toThrow("配置文件损坏");
    expect((await readdir(directory)).some((name) => name.startsWith("config.json.corrupt-"))).toBe(true);
  });
});
```

- [ ] **Step 2: Verify RED**

```powershell
npm run test:web -- local-repository.test.ts
```

Expected: FAIL because `JsonRepository` does not exist.

- [ ] **Step 3: Implement atomic JSON storage**

`JsonRepository<T>` must:

- create the parent directory;
- read UTF-8 JSON and validate with the supplied Zod schema;
- return a deep-cloned default when the file does not exist;
- write `<name>.tmp`, then replace the target;
- on parse/validation failure, rename the invalid file to `<name>.corrupt-<ISO-safe timestamp>` and throw a descriptive error;
- serialize concurrent writes through a per-instance promise chain.

Add `.boss-agent-data/` to `.gitignore`.

Create `domain-store.ts` with repositories for:

```text
config.json
profile.json
template.json
jobs.json
tasks.json
run-logs.json
daily-usage.json
```

The base directory is `process.env.BOSS_AGENT_DATA_DIR ?? path.join(process.cwd(), ".boss-agent-data")`.

- [ ] **Step 4: Add repository-backed domain operations**

Move and adapt existing operations:

```ts
getJobs()
upsertJobs(input)
getTasks()
createOrUpdateTask(task)
approveTasks(taskIds)
rejectTasks(taskIds)
transitionTask(taskId, nextStatus, metadata)
getApprovedTasks()
getDailyUsage(date)
incrementConfirmedSend(date)
```

Enforce a transition map. For example, `approved → sending → sent|failed|paused`; reject `pending_review → sent`.

- [ ] **Step 5: Run tests**

```powershell
npm run test:web -- local-repository.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add .gitignore apps/web/src/lib apps/web/test/local-repository.test.ts
git commit -m "feat: persist greeting automation data locally"
```

### Task 4: Add configuration, profile, template, task, and diagnostics APIs

**Files:**
- Create: `apps/web/src/app/api/config/route.ts`
- Create: `apps/web/src/app/api/profile/route.ts`
- Create: `apps/web/src/app/api/greeting-template/route.ts`
- Modify: `apps/web/src/app/api/jobs/route.ts`
- Modify: `apps/web/src/app/api/extension/ingest/route.ts`
- Modify: `apps/web/src/app/api/tasks/route.ts`
- Modify: `apps/web/src/app/api/tasks/approve/route.ts`
- Modify: `apps/web/src/app/api/tasks/approved/route.ts`
- Modify: `apps/web/src/app/api/tasks/status/route.ts`
- Create: `apps/web/src/app/api/run-summary/route.ts`
- Create: `apps/web/src/lib/diagnostics.ts`
- Create: `apps/web/src/app/api/diagnostics/export/route.ts`
- Create: `apps/web/test/api-contracts.test.ts`

- [ ] **Step 1: Write failing route contract tests**

Test route functions directly with `Request` objects using these assertions:

```ts
expect((await GET_CONFIG()).status).toBe(200);
expect((await PUT_CONFIG(new Request("http://local/api/config", {
  method: "PUT",
  body: JSON.stringify({ ...validConfig, dailyLimit: 151 })
}))).status).toBe(400);
expect((await PUT_PROFILE(requestWith(validProfile))).status).toBe(200);
expect((await PUT_TEMPLATE(requestWith(validTemplate))).status).toBe(200);
expect((await INGEST(requestWith({ jobs: [validJob] }))).status).toBe(200);
expect((await UPDATE_STATUS(requestWith({ taskId: "task-1", status: "sent" }))).status).toBe(409);
expect(JSON.stringify(await (await EXPORT_DIAGNOSTICS()).json())).not.toMatch(/api.?key|cookie|authorization/i);
```

- [ ] **Step 2: Verify RED**

```powershell
npm run test:web -- api-contracts.test.ts
```

Expected: FAIL because routes are absent or still depend on the deleted store.

- [ ] **Step 3: Implement consistent HTTP boundaries**

Each route must:

```ts
try {
  const input = schema.parse(await request.json());
  return NextResponse.json(await operation(input));
} catch (error) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: "invalid_request", issues: error.issues }, { status: 400 });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : "unknown_error" }, { status: 500 });
}
```

Use `GET` and `PUT` for single config/profile/template resources. Keep task approval as `POST` with `{ taskIds: string[] }`. Require status updates to include `{ taskId, status, failureReason?, confirmationEvidence? }`.

- [ ] **Step 4: Implement redacted diagnostics**

`redactDiagnosticValue` must recursively remove values whose key matches:

```ts
/api.?key|cookie|authorization|password|token|session/i
```

The export route returns a downloadable JSON object containing configuration without secrets, task history, run logs, and daily usage. Do not include full page HTML.

- [ ] **Step 5: Run route tests and typecheck**

```powershell
npm run test:web -- api-contracts.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/app/api apps/web/src/lib/diagnostics.ts apps/web/test/api-contracts.test.ts
git commit -m "feat: expose persistent greeting automation APIs"
```

### Task 5: Add DeepSeek-compatible scoring and greeting refinement

**Files:**
- Create: `apps/web/src/lib/model-provider.ts`
- Create: `apps/web/test/model-provider.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write failing provider tests**

Define tests with an injected request function:

```ts
it("uses structured DeepSeek output for scoring", async () => {
  const provider = createDeepSeekProvider({
    apiKey: "test",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    request: async () => ({
      choices: [{ message: { content: JSON.stringify({
        score: 82,
        matchedRequirements: ["SQL"],
        missingRequirements: ["Tableau"],
        reasons: ["技能匹配"],
        recommendedProfileFields: ["skill-sql"]
      }) } }],
      usage: { prompt_tokens: 200, completion_tokens: 60 }
    })
  });
  expect((await provider.scoreJob(validInput)).score).toBe(82);
});

it("falls back to local scoring and zero cost when no key exists", async () => {
  const provider = createConfiguredProvider({});
  const result = await provider.scoreJob(validInput);
  expect(result.provider).toBe("local");
  expect(result.estimatedCostCny).toBe(0);
});
```

Also test malformed JSON, timeout, and refinement that introduces an unknown personal fact. Unknown facts must make refinement fail and preserve the local template output.

- [ ] **Step 2: Verify RED**

```powershell
npm run test:web -- model-provider.test.ts
```

Expected: FAIL because provider functions are missing.

- [ ] **Step 3: Implement the provider contract**

Create:

```ts
export interface GreetingModelProvider {
  scoreJob(input: ScoreJobInput): Promise<ScoreJobResult>;
  refineGreeting(input: RefineGreetingInput): Promise<RefineGreetingResult>;
}
```

DeepSeek requests use:

```text
POST ${baseUrl}/chat/completions
Authorization: Bearer ${apiKey}
model: deepseek-chat
temperature: 0.2
response_format: { type: "json_object" }
```

Use an `AbortController` with a 12-second timeout. Parse output with Zod. Estimate cost from configurable input/output CNY-per-million-token values; defaults must live in configuration, not be claimed as permanently current.

The local provider:

- scores from keyword overlap;
- returns concise reasons;
- returns the unmodified local greeting for refinement;
- always reports zero cost.

- [ ] **Step 4: Add environment documentation**

Add to `.env.example`:

```dotenv
GREETING_MODEL_PROVIDER=deepseek
GREETING_MODEL_API_KEY=
GREETING_MODEL_BASE_URL=https://api.deepseek.com
GREETING_MODEL_NAME=deepseek-chat
GREETING_MODEL_INPUT_CNY_PER_MILLION=2
GREETING_MODEL_OUTPUT_CNY_PER_MILLION=8
```

- [ ] **Step 5: Run tests**

```powershell
npm run test:web -- model-provider.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add .env.example apps/web/src/lib/model-provider.ts apps/web/test/model-provider.test.ts
git commit -m "feat: add low-cost greeting model provider"
```

### Task 6: Build the filter-score-generate pipeline

**Files:**
- Create: `apps/web/src/lib/greeting-pipeline.ts`
- Create: `apps/web/src/app/api/pipeline/run/route.ts`
- Create: `apps/web/test/greeting-pipeline.test.ts`

- [ ] **Step 1: Write failing pipeline tests**

Implement these end-to-end domain assertions with an injected fake provider:

```ts
expect(fakeProvider.scoreCalls).toBe(0); // hard-rejected job
expect((await store.getTasks()).filter((task) => task.status === "pending_review")).toHaveLength(0); // low score
expect(createdTask).toMatchObject({
  status: "pending_review",
  score: 82,
  usedProfileItemIds: ["skill-sql"],
  templateVersion: 1,
  modelProvider: "fake",
  estimatedCostCny: 0.01
});
expect(fallbackTask.messageDraft).toBe(localRenderedText);
expect(logs.some((log) => log.code === "refinement_fallback")).toBe(true);
```

Use a fake provider that counts calls and returns deterministic data.

- [ ] **Step 2: Verify RED**

```powershell
npm run test:web -- greeting-pipeline.test.ts
```

Expected: FAIL because the pipeline does not exist.

- [ ] **Step 3: Implement orchestration**

`runGreetingPipeline(jobIds?: string[])` must:

1. load config, profile, template, and jobs;
2. skip jobs already represented by non-terminal tasks;
3. call `evaluateJob`;
4. persist filter result;
5. call `provider.scoreJob` only for accepted jobs;
6. compare score threshold;
7. select enabled profile items using matched requirements;
8. render the local template;
9. call refinement;
10. validate length and banned phrases;
11. persist a `pending_review` task;
12. append a diagnostic event for every stage.

Limit concurrent model calls to three without adding a new dependency.

- [ ] **Step 4: Implement the pipeline route**

`POST /api/pipeline/run` accepts:

```ts
z.object({ jobIds: z.array(z.string()).optional() })
```

Return counts:

```ts
{
  processed: number;
  hardRejected: number;
  scoreRejected: number;
  pendingReview: number;
  failed: number;
  estimatedCostCny: number;
}
```

- [ ] **Step 5: Run tests**

```powershell
npm run test:web -- greeting-pipeline.test.ts
npm run test:web
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/lib/greeting-pipeline.ts apps/web/src/app/api/pipeline apps/web/test/greeting-pipeline.test.ts
git commit -m "feat: generate reviewable personalized greetings"
```

### Task 7: Rebuild the web workbench around editable greeting automation

**Files:**
- Create: `apps/web/src/components/filter-settings.tsx`
- Create: `apps/web/src/components/profile-editor.tsx`
- Create: `apps/web/src/components/template-settings.tsx`
- Create: `apps/web/src/components/approval-queue.tsx`
- Create: `apps/web/src/components/run-status.tsx`
- Replace: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/globals.css`
- Delete: `apps/web/src/lib/sample-profile.ts`
- Delete: `apps/web/src/app/api/generate-resume/route.ts`
- Delete: `apps/web/src/app/api/analyze-jd/route.ts`
- Delete: `apps/web/src/app/api/export-docx/route.ts`
- Delete: `apps/web/src/app/api/review-risk/route.ts`
- Delete: `apps/web/src/app/api/conversations/route.ts`
- Create: `apps/web/test/workbench-contract.test.tsx`

- [ ] **Step 1: Add failing component contract tests**

Use React DOM server rendering to assert that the page contains:

```text
筛选设置
个人信息库
话术设置
待审批队列
运行状态
```

Assert it does not contain:

```text
岗位版简历
生成简历
下载 DOCX
```

Test that form controls expose labels for all configurable fields and that approval cards include editable textareas.

- [ ] **Step 2: Verify RED**

```powershell
npm run test:web -- workbench-contract.test.tsx
```

Expected: FAIL against the current resume-oriented page.

- [ ] **Step 3: Implement focused components**

Each component owns only its form state and API calls:

- `FilterSettings`: load/save the single config and trigger pipeline execution.
- `ProfileEditor`: edit base fields and add/remove/enable profile items.
- `TemplateSettings`: edit body, tone, length, limits, banned phrases, provider name, model name, and base URL. API keys remain environment-only and never appear in browser responses.
- `ApprovalQueue`: edit generated text, select tasks, approve or reject in bulk, display score/reasons/profile facts/cost.
- `RunStatus`: display daily confirmed sends, limit, failures, paused reason, and diagnostic export link.

`page.tsx` coordinates refresh only. Do not duplicate filtering or state transition logic in React.

- [ ] **Step 4: Implement responsive CSS**

Requirements:

- desktop uses a two-column workbench;
- below 980px uses one column;
- below 640px uses one-column forms and cards;
- no job or approval table on mobile;
- `document.documentElement.scrollWidth` must equal `clientWidth` at 390px;
- navigation items are anchors to real section IDs.

- [ ] **Step 5: Remove resume functionality**

Delete resume-only routes, conversation routes, and `sample-profile.ts`. Delete `apps/web/src/lib/ai.ts` after the new provider is in place. Remove conversation state and UI from `page.tsx`; the first release handles job greeting automation only.

- [ ] **Step 6: Run focused verification**

```powershell
npm run test:web -- workbench-contract.test.tsx
npm run lint
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/web
git commit -m "feat: add editable greeting automation workbench"
```

### Task 8: Isolate and harden BOSS page interaction

**Files:**
- Create: `apps/extension/src/boss-page-adapter.cjs`
- Modify: `apps/extension/src/content.js`
- Modify: `apps/extension/src/manifest.json`
- Create: `apps/extension/test/boss-page-adapter.test.cjs`

- [ ] **Step 1: Write failing adapter tests**

With JSDOM, cover:

- detects `验证码`, `安全验证`, `账号异常`, and `访问过于频繁`;
- returns `ambiguous` when multiple visible editors exist;
- writes only to the unique scoped chat editor;
- returns `ambiguous` for multiple send buttons;
- confirms success only when the target message appears in the chat history;
- does not treat editor text as sent-message evidence.

- [ ] **Step 2: Verify RED**

```powershell
node --test apps/extension/test/boss-page-adapter.test.cjs
```

Expected: FAIL because the adapter is missing.

- [ ] **Step 3: Implement the adapter**

Export:

```js
detectRiskBlocker(document)
findCommunicationEntry(document)
findUniqueChatEditor(document)
setEditorText(editor, text, window)
findUniqueSendButton(document)
confirmMessageSent(document, text)
```

Every finder returns:

```js
{ ok: true, element }
// or
{ ok: false, reason: "missing" | "ambiguous" | "risk_blocker", details }
```

Selectors must be named constants inside this file. No BOSS selector may remain in `content.js`.

- [ ] **Step 4: Refactor content script**

Load `boss-page-adapter.cjs` before `content.js`. Replace `findEditor`, `findClickable`, and direct risk scanning with adapter calls. `SEND_GREETING` must:

1. stop on risk blocker;
2. optionally click the unique communication entry;
3. require one editor;
4. write the approved text;
5. require one send button;
6. click;
7. poll for at most 8 seconds for sent-message confirmation;
8. return confirmation evidence or a failure reason.

Remove `COLLECT_CONVERSATIONS`, `collectConversations`, and all conversation parsing from `content.js`.

- [ ] **Step 5: Run extension tests**

```powershell
npm test -w @boss-agent/extension
npm run extension:build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/extension/src apps/extension/test
git commit -m "fix: verify BOSS greeting interactions safely"
```

### Task 9: Enforce quotas, timeouts, and truthful task status

**Files:**
- Modify: `apps/extension/src/background.js`
- Modify: `apps/extension/src/popup.js`
- Modify: `apps/extension/src/popup.html`
- Modify: `apps/extension/src/popup.css`
- Modify: `apps/web/src/app/api/tasks/status/route.ts`
- Create: `apps/extension/test/task-runner.test.cjs`
- Create: `apps/web/test/quota.test.ts`

- [ ] **Step 1: Write failing quota and runner tests**

Web tests:

- `confirmed sends = dailyLimit` returns `quota_blocked`;
- failed and paused sends do not consume confirmed quota;
- only `sending → sent` with non-empty confirmation evidence increments usage.

Extension tests:

- tab load timeout returns failure within the configured deadline;
- a failed task updates status to `failed`;
- a risk blocker updates status to `paused` and stops the loop;
- quota response stops before opening another tab;
- a click without confirmation never posts `sent`.

- [ ] **Step 2: Verify RED**

```powershell
npm run test:web -- quota.test.ts
node --test apps/extension/test/task-runner.test.cjs
```

Expected: FAIL.

- [ ] **Step 3: Implement quota API behavior**

Before returning approved tasks, compare confirmed daily usage with the configured limit. Return:

```json
{
  "tasks": [],
  "quota": { "used": 100, "limit": 100, "blocked": true }
}
```

Status updates to `sent` require `confirmationEvidence`. Increment usage in the same serialized domain-store operation as the transition.

- [ ] **Step 4: Harden the background runner**

Replace unbounded `waitForTabComplete` with a promise that:

- resolves on `complete`;
- rejects after 15 seconds;
- always removes its listener and timer.

Fetch approved tasks through the quota-aware response. Stop on `quota.blocked`, `pause`, authentication/risk errors, or malformed API responses. Keep the existing 2.5-second pacing as a configurable minimum, but do not claim that pacing guarantees platform safety.

- [ ] **Step 5: Improve popup status**

Show:

- local API connection result;
- approved queue count;
- confirmed sends / daily limit;
- current paused reason;
- buttons for collecting jobs, running approved tasks, and opening the workbench.

Do not display a static “connected” claim before a successful health request.

- [ ] **Step 6: Run tests**

```powershell
npm run test:web -- quota.test.ts
npm test -w @boss-agent/extension
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/extension apps/web/src/app/api/tasks apps/web/test/quota.test.ts
git commit -m "feat: enforce greeting quotas and confirmed delivery"
```

### Task 10: Add snapshot replay, final browser QA, and documentation

**Files:**
- Create: `apps/extension/test/fixtures/boss-job-list.html`
- Create: `apps/extension/test/fixtures/boss-chat.html`
- Modify: `apps/extension/test/job-extractor.test.cjs`
- Modify: `apps/extension/test/boss-page-adapter.test.cjs`
- Modify: `README.md`

- [ ] **Step 1: Add sanitized replay fixtures**

Save minimal HTML containing only the DOM needed for:

- two job cards with title, company, city, salary, experience, education, industry, and URL;
- one chat editor, one send button, chat history, and a risk-blocker variant.

Remove names, account identifiers, tracking values, and unrelated HTML.

- [ ] **Step 2: Test replay fixtures**

Update extractor and adapter tests to read fixture files and assert normalized snapshots. Run:

```powershell
npm test -w @boss-agent/extension
```

Expected: PASS.

- [ ] **Step 3: Update README**

Document:

- build and load instructions;
- `.env.local` model configuration;
- editable filter/profile/template workflow;
- approval requirement;
- daily quota behavior;
- diagnostic export and data location;
- manual account switching boundary;
- risk/verification pause behavior;
- commands for tests, typecheck, lint, build, and extension build.

- [ ] **Step 4: Run complete automated verification**

Run fresh:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run extension:build
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 5: Run Browser QA**

Use the Browser plugin and verify:

```text
http://localhost:3000
→ edit and save filter settings
→ edit and save profile
→ edit and save template
→ ingest fixture/demo jobs
→ run filter/score/generate
→ edit one greeting
→ approve selected greetings
→ inspect quota and diagnostics export
```

Required checks:

- page title and intended URL;
- meaningful DOM, no framework overlay;
- no relevant console errors or warnings;
- desktop screenshot at normal viewport;
- 390×844 mobile screenshot;
- no horizontal overflow on mobile;
- rejected jobs do not appear in approval queue;
- task metadata displays score, reasons, profile facts, model, cost, and template version.

Do not perform a real BOSS send during automated QA. Use fixture replay for send confirmation, then perform a single user-supervised live send only if the user explicitly asks.

- [ ] **Step 6: Review against the specification**

Check every acceptance criterion in:

```text
docs/superpowers/specs/2026-06-18-boss-greeting-automation-design.md
```

Record any unmet criterion rather than declaring completion.

- [ ] **Step 7: Commit**

```powershell
git add README.md apps/extension/test
git commit -m "test: add replay fixtures and greeting workflow QA"
```

### Task 11: Final review and branch handoff

**Files:**
- Review all changed files.

- [ ] **Step 1: Use `superpowers:requesting-code-review`**

Request review of the completed diff, with explicit attention to:

- illegal task state transitions;
- accidental model calls before hard filtering;
- secret leakage;
- false-positive sent status;
- quota race conditions;
- selectors outside the adapter;
- mobile overflow;
- remnants of resume generation.

- [ ] **Step 2: Address confirmed findings with TDD**

For every confirmed defect:

1. write the smallest failing regression test;
2. verify the expected failure;
3. implement one fix;
4. rerun focused and full tests.

- [ ] **Step 3: Use `superpowers:verification-before-completion`**

Freshly rerun:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run extension:build
git status --short
```

Completion requires zero test failures, zero type errors, zero lint errors, successful builds, and only intentional working-tree changes.

- [ ] **Step 4: Use `superpowers:finishing-a-development-branch`**

Present merge, PR, or branch-preservation options. Do not push or create a PR without the user's explicit request.
