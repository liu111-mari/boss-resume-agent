# BOSS 求职助手多页面工作台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有单页工作台重构为固定侧边栏、多独立路由的清爽产品风应用，并保持全部现有业务能力与安全约束。

**Architecture:** 使用 Next.js App Router route group 提供共享 `AppShell`，每个页面由自己的客户端容器加载最小必要数据。现有业务组件继续负责保存、运行和审批副作用；共享 UI 只处理导航、布局、通知和展示，不持有复杂业务状态。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript、原生 CSS、Vitest、React DOM Server、现有本地 JSON API。

---

## 文件结构

计划完成后主要结构如下：

```text
apps/web/src/
├── app/
│   ├── (workbench)/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── jobs/page.tsx
│   │   ├── filters/page.tsx
│   │   ├── profile/page.tsx
│   │   ├── template/page.tsx
│   │   ├── approvals/page.tsx
│   │   └── runs/page.tsx
│   ├── globals.css
│   └── layout.tsx
├── components/
│   ├── app-shell.tsx
│   ├── navigation.tsx
│   ├── page-feedback.tsx
│   ├── overview-page.tsx
│   ├── jobs-page.tsx
│   ├── filters-page.tsx
│   ├── profile-page.tsx
│   ├── template-page.tsx
│   ├── approvals-page.tsx
│   ├── runs-page.tsx
│   └── ui.tsx
└── lib/
    ├── client-api.ts
    ├── navigation.ts
    └── workbench-helpers.ts
```

`app-shell.tsx` 只负责框架；各 `*-page.tsx` 只负责对应页面状态；现有 `filter-settings.tsx`、`profile-editor.tsx`、`template-settings.tsx`、`approval-queue.tsx`、`run-status.tsx` 保持业务组件边界。

---

### Task 1: 独立收尾 DeepSeek 兼容修复

**Files:**
- Modify: `apps/web/src/lib/model-provider.ts`
- Modify: `apps/web/src/lib/greeting-pipeline.ts`
- Modify: `apps/web/test/model-provider.test.ts`
- Modify: `apps/web/test/greeting-pipeline.test.ts`

- [ ] **Step 1: 运行当前针对性测试，确认未提交修复仍通过**

Run:

```powershell
npx vitest run apps/web/test/model-provider.test.ts apps/web/test/greeting-pipeline.test.ts
```

Expected: `32 passed`，无失败。

- [ ] **Step 2: 检查修复范围不包含 UI 文件**

Run:

```powershell
git diff -- apps/web/src/lib/model-provider.ts apps/web/src/lib/greeting-pipeline.ts apps/web/test/model-provider.test.ts apps/web/test/greeting-pipeline.test.ts
```

Expected: 只包含 DeepSeek 类型偏差兼容、失败模型元数据和对应测试。

- [ ] **Step 3: 运行类型检查**

Run:

```powershell
npm run typecheck
```

Expected: 所有 workspace 类型检查通过。

- [ ] **Step 4: 提交 DeepSeek 修复**

```powershell
git add apps/web/src/lib/model-provider.ts apps/web/src/lib/greeting-pipeline.ts apps/web/test/model-provider.test.ts apps/web/test/greeting-pipeline.test.ts
git commit -m "fix: tolerate DeepSeek response drift"
```

---

### Task 2: 建立共享导航定义和应用外壳

**Files:**
- Create: `apps/web/src/lib/navigation.ts`
- Create: `apps/web/src/components/navigation.tsx`
- Create: `apps/web/src/components/app-shell.tsx`
- Create: `apps/web/src/app/(workbench)/layout.tsx`
- Test: `apps/web/test/navigation-contract.test.tsx`

- [ ] **Step 1: 写导航契约失败测试**

创建 `apps/web/test/navigation-contract.test.tsx`：

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WORKBENCH_NAV_ITEMS } from "@/lib/navigation";
import { DesktopNavigation } from "@/components/navigation";

describe("workbench navigation", () => {
  it("defines every approved route exactly once", () => {
    expect(WORKBENCH_NAV_ITEMS).toEqual([
      { href: "/", label: "概览" },
      { href: "/jobs", label: "岗位库" },
      { href: "/filters", label: "筛选设置" },
      { href: "/profile", label: "个人资料" },
      { href: "/template", label: "话术模板" },
      { href: "/approvals", label: "审批队列" },
      { href: "/runs", label: "运行记录" }
    ]);
  });

  it("marks only the current route as active", () => {
    const html = renderToStaticMarkup(<DesktopNavigation pathname="/profile" />);
    expect(html).toContain('href="/profile"');
    expect(html).toContain('aria-current="page"');
    expect((html.match(/aria-current="page"/g) ?? [])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npx vitest run apps/web/test/navigation-contract.test.tsx
```

Expected: FAIL，提示 `@/lib/navigation` 或组件不存在。

- [ ] **Step 3: 创建导航定义**

创建 `apps/web/src/lib/navigation.ts`：

```ts
export type WorkbenchNavItem = {
  href: string;
  label: string;
};

export const WORKBENCH_NAV_ITEMS: WorkbenchNavItem[] = [
  { href: "/", label: "概览" },
  { href: "/jobs", label: "岗位库" },
  { href: "/filters", label: "筛选设置" },
  { href: "/profile", label: "个人资料" },
  { href: "/template", label: "话术模板" },
  { href: "/approvals", label: "审批队列" },
  { href: "/runs", label: "运行记录" }
];

export function isActiveRoute(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
```

- [ ] **Step 4: 创建桌面和移动导航**

创建 `apps/web/src/components/navigation.tsx`：

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useState } from "react";

import { WORKBENCH_NAV_ITEMS, isActiveRoute } from "@/lib/navigation";

export function DesktopNavigation({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="主要导航" className="desktop-navigation">
      {WORKBENCH_NAV_ITEMS.map((item) => {
        const active = isActiveRoute(pathname, item.href);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`navigation-link${active ? " navigation-link-active" : ""}`}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function WorkbenchNavigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <DesktopNavigation pathname={pathname} />
      <button
        aria-expanded={open}
        aria-label="打开导航菜单"
        className="mobile-menu-button"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        菜单
      </button>
      {open ? (
        <div className="mobile-navigation-drawer">
          <DesktopNavigation pathname={pathname} />
          <button className="mobile-navigation-close" onClick={() => setOpen(false)} type="button">
            关闭
          </button>
        </div>
      ) : null}
    </>
  );
}
```

- [ ] **Step 5: 创建应用外壳**

创建 `apps/web/src/components/app-shell.tsx`：

```tsx
import React from "react";

import { WorkbenchNavigation } from "@/components/navigation";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <strong>BOSS 求职助手</strong>
          <span>本地打招呼工作台</span>
        </div>
        <WorkbenchNavigation />
      </aside>
      <div className="app-content">
        <header className="mobile-app-header">
          <strong>BOSS 求职助手</strong>
          <WorkbenchNavigation />
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}
```

创建 `apps/web/src/app/(workbench)/layout.tsx`：

```tsx
import AppShell from "@/components/app-shell";

export default function WorkbenchLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
```

- [ ] **Step 6: 运行导航测试**

Run:

```powershell
npx vitest run apps/web/test/navigation-contract.test.tsx
```

Expected: PASS。

- [ ] **Step 7: 提交应用外壳**

```powershell
git add apps/web/src/lib/navigation.ts apps/web/src/components/navigation.tsx apps/web/src/components/app-shell.tsx "apps/web/src/app/(workbench)/layout.tsx" apps/web/test/navigation-contract.test.tsx
git commit -m "feat: add multipage workbench shell"
```

---

### Task 3: 拆分最小页面级数据 API

**Files:**
- Modify: `apps/web/src/lib/client-api.ts`
- Test: `apps/web/test/client-api.test.ts`

- [ ] **Step 1: 写页面级加载器失败测试**

在 `apps/web/test/client-api.test.ts` 增加：

```ts
import {
  loadApprovalsPageData,
  loadFiltersPageData,
  loadOverviewPageData,
  loadProfilePageData,
  loadTemplatePageData
} from "@/lib/client-api";

it("loads only the endpoints required by each page", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const payloads: Record<string, unknown> = {
      "/api/jobs": { jobs: [] },
      "/api/tasks": { tasks: [] },
      "/api/run-summary": {
        date: "2026-06-22",
        config: { dailyLimit: 100 },
        usage: { confirmedSends: 0 },
        taskStatusCounts: {},
        recentLogs: []
      },
      "/api/config": { config: {} },
      "/api/profile": { profile: { items: [] } },
      "/api/greeting-template": { template: {} }
    };
    return new Response(JSON.stringify(payloads[url]), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);

  await loadOverviewPageData();
  expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
    "/api/jobs",
    "/api/tasks",
    "/api/run-summary"
  ]);

  fetchMock.mockClear();
  await loadProfilePageData();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith("/api/profile", undefined);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npx vitest run apps/web/test/client-api.test.ts
```

Expected: FAIL，页面级加载器未导出。

- [ ] **Step 3: 实现最小加载器**

在 `apps/web/src/lib/client-api.ts` 增加：

```ts
export async function loadOverviewPageData(): Promise<WorkbenchOperationalData> {
  return loadOperationalData();
}

export async function loadJobsPageData(): Promise<JobCard[]> {
  return (await fetchJson<{ jobs: JobCard[] }>("/api/jobs")).jobs;
}

export async function loadFiltersPageData(): Promise<{
  config: FilterConfig;
  operational: WorkbenchOperationalData;
}> {
  const [configResponse, operational] = await Promise.all([
    fetchJson<{ config: FilterConfig }>("/api/config"),
    loadOperationalData()
  ]);
  return { config: configResponse.config, operational };
}

export async function loadProfilePageData(): Promise<Profile> {
  return (await fetchJson<{ profile: Profile }>("/api/profile")).profile;
}

export async function loadTemplatePageData(): Promise<{
  template: GreetingTemplate;
  tasks: GreetingTask[];
}> {
  const [templateResponse, taskResponse] = await Promise.all([
    fetchJson<{ template: GreetingTemplate }>("/api/greeting-template"),
    fetchJson<{ tasks: GreetingTask[] }>("/api/tasks")
  ]);
  return { template: templateResponse.template, tasks: taskResponse.tasks };
}

export async function loadApprovalsPageData(): Promise<{
  profile: Profile;
  operational: WorkbenchOperationalData;
}> {
  const [profileResponse, operational] = await Promise.all([
    fetchJson<{ profile: Profile }>("/api/profile"),
    loadOperationalData()
  ]);
  return { profile: profileResponse.profile, operational };
}

export async function loadRunsPageData(): Promise<WorkbenchRunSummary> {
  return fetchJson<WorkbenchRunSummary>("/api/run-summary");
}
```

- [ ] **Step 4: 运行客户端 API 测试**

Run:

```powershell
npx vitest run apps/web/test/client-api.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交页面级 API**

```powershell
git add apps/web/src/lib/client-api.ts apps/web/test/client-api.test.ts
git commit -m "refactor: add page scoped workbench loaders"
```

---

### Task 4: 扩展共享 UI 和页面反馈

**Files:**
- Modify: `apps/web/src/components/ui.tsx`
- Create: `apps/web/src/components/page-feedback.tsx`
- Test: `apps/web/test/page-ui-contract.test.tsx`

- [ ] **Step 1: 写共享 UI 失败测试**

创建 `apps/web/test/page-ui-contract.test.tsx`：

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PageHeader } from "@/components/ui";
import PageFeedback from "@/components/page-feedback";

describe("page UI", () => {
  it("renders one title, description and action region", () => {
    const html = renderToStaticMarkup(
      <PageHeader actions={<button type="button">刷新</button>} description="页面说明" title="岗位库" />
    );
    expect(html).toContain("<h1>岗位库</h1>");
    expect(html).toContain("页面说明");
    expect(html).toContain("刷新");
  });

  it("announces success and error messages accessibly", () => {
    const html = renderToStaticMarkup(
      <PageFeedback error="保存失败" status="保存成功" />
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("保存成功");
    expect(html).toContain("保存失败");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npx vitest run apps/web/test/page-ui-contract.test.tsx
```

Expected: FAIL，组件不存在。

- [ ] **Step 3: 增加 `PageHeader` 和 `EmptyState`**

在 `apps/web/src/components/ui.tsx` 增加：

```tsx
export function PageHeader({
  title,
  description,
  actions
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({
  title,
  description,
  action
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state-panel">
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}
```

- [ ] **Step 4: 创建统一反馈组件**

创建 `apps/web/src/components/page-feedback.tsx`：

```tsx
export default function PageFeedback({
  status,
  error
}: {
  status: string;
  error: string;
}) {
  if (!status && !error) return null;

  return (
    <div aria-live="polite" className="page-feedback">
      {status ? <div className="notice">{status}</div> : null}
      {error ? <div className="notice notice-danger">{error}</div> : null}
    </div>
  );
}
```

- [ ] **Step 5: 运行共享 UI 测试**

Run:

```powershell
npx vitest run apps/web/test/page-ui-contract.test.tsx
```

Expected: PASS。

- [ ] **Step 6: 提交共享 UI**

```powershell
git add apps/web/src/components/ui.tsx apps/web/src/components/page-feedback.tsx apps/web/test/page-ui-contract.test.tsx
git commit -m "feat: add shared page UI"
```

---

### Task 5: 实现概览页和岗位库

**Files:**
- Create: `apps/web/src/components/overview-page.tsx`
- Create: `apps/web/src/components/jobs-page.tsx`
- Create: `apps/web/src/app/(workbench)/page.tsx`
- Create: `apps/web/src/app/(workbench)/jobs/page.tsx`
- Delete: `apps/web/src/app/page.tsx`
- Test: `apps/web/test/multipage-routes.test.tsx`

- [ ] **Step 1: 写概览与岗位库职责失败测试**

创建 `apps/web/test/multipage-routes.test.tsx`：

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import OverviewPage from "@/components/overview-page";
import JobsPage from "@/components/jobs-page";

describe("multipage workbench responsibilities", () => {
  it("keeps the overview focused on summaries and shortcuts", () => {
    const html = renderToStaticMarkup(
      <OverviewPage
        initialData={{ jobs: [], tasks: [], runSummary: null }}
      />
    );
    expect(html).toContain("今日概览");
    expect(html).toContain("查看审批队列");
    expect(html).not.toContain("目标职位");
    expect(html).not.toContain("模板正文");
  });

  it("shows a collection instruction when the job library is empty", () => {
    const html = renderToStaticMarkup(<JobsPage initialJobs={[]} />);
    expect(html).toContain("还没有采集岗位");
    expect(html).toContain("BOSS 搜索结果页");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npx vitest run apps/web/test/multipage-routes.test.tsx
```

Expected: FAIL，页面组件不存在。

- [ ] **Step 3: 实现概览容器**

创建 `apps/web/src/components/overview-page.tsx`，核心结构：

```tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { GreetingTask, JobCard } from "@boss-agent/shared";
import PageFeedback from "@/components/page-feedback";
import { EmptyState, MetricCard, PageHeader, Panel, StatusBadge } from "@/components/ui";
import {
  loadOverviewPageData,
  type WorkbenchOperationalData
} from "@/lib/client-api";

export default function OverviewPage({
  initialData
}: {
  initialData?: WorkbenchOperationalData | { jobs: JobCard[]; tasks: GreetingTask[]; runSummary: null };
}) {
  const [data, setData] = useState(initialData ?? null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const refresh = useCallback(async () => {
    try {
      setData(await loadOverviewPageData());
      setError("");
      setStatus("概览数据已更新。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "概览加载失败");
    }
  }, []);

  useEffect(() => {
    if (!initialData) void refresh();
  }, [initialData, refresh]);

  const tasks = data?.tasks ?? [];
  const recentTasks = useMemo(
    () => [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6),
    [tasks]
  );

  return (
    <>
      <PageHeader
        actions={<button className="button button-secondary" onClick={() => void refresh()} type="button">刷新数据</button>}
        description="查看岗位、审批与发送状态。"
        title="今日概览"
      />
      <PageFeedback error={error} status={status} />
      <section className="overview-metrics">
        <MetricCard label="采集岗位" value={data?.jobs.length ?? 0} />
        <MetricCard label="待审批" tone="amber" value={tasks.filter((task) => task.status === "pending_review").length} />
        <MetricCard label="已批准" tone="teal" value={tasks.filter((task) => task.status === "approved").length} />
        <MetricCard label="今日发送" tone="teal" value={data?.runSummary?.usage.confirmedSends ?? 0} />
      </section>
      <div className="overview-layout">
        <Panel actions={<Link className="button button-primary" href="/approvals">查看审批队列</Link>} title="最近任务">
          {recentTasks.length ? (
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>岗位</th>
                    <th>状态</th>
                    <th>模型</th>
                    <th>更新时间</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTasks.map((task) => (
                    <tr key={task.id}>
                      <td>
                        <strong>{task.jobTitle}</strong>
                        <span>{task.company}</span>
                      </td>
                      <td><StatusBadge label={task.status} /></td>
                      <td>{task.modelProvider}:{task.modelName}</td>
                      <td>{task.updatedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="暂无任务" description="采集岗位并运行筛选后，任务会显示在这里。" />
          )}
        </Panel>
        <Panel title="运行状态">
          <dl className="overview-status-list">
            <div>
              <dt>本地服务</dt>
              <dd>{data?.runSummary ? "正常" : "等待确认"}</dd>
            </div>
            <div>
              <dt>每日上限</dt>
              <dd>{data?.runSummary?.config.dailyLimit ?? 0}</dd>
            </div>
            <div>
              <dt>今日已发送</dt>
              <dd>{data?.runSummary?.usage.confirmedSends ?? 0}</dd>
            </div>
          </dl>
          <div className="recent-event-list">
            {(data?.runSummary?.recentLogs ?? []).slice(0, 4).map((log) => (
              <article className="recent-event" key={log.id}>
                <StatusBadge label={log.level} tone={log.level === "error" ? "danger" : log.level === "warn" ? "amber" : "teal"} />
                <div>
                  <strong>{log.message}</strong>
                  <span>{log.createdAt}</span>
                </div>
              </article>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
```

任务行必须显示 `jobTitle`、`company`、`status`、实际 `modelProvider:modelName` 和 `updatedAt`，不得生成虚构趋势。

- [ ] **Step 4: 实现岗位库容器**

创建 `apps/web/src/components/jobs-page.tsx`：

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { JobCard } from "@boss-agent/shared";

import PageFeedback from "@/components/page-feedback";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { loadJobsPageData } from "@/lib/client-api";

export default function JobsPage({ initialJobs }: { initialJobs?: JobCard[] }) {
  const [jobs, setJobs] = useState(initialJobs ?? []);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialJobs) return;
    void loadJobsPageData().then(setJobs).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "岗位加载失败");
    });
  }, [initialJobs]);

  const visibleJobs = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) return jobs;
    return jobs.filter((job) =>
      [job.title, job.company, job.city].join(" ").toLocaleLowerCase("zh-CN").includes(keyword)
    );
  }, [jobs, query]);

  return (
    <>
      <PageHeader description="查看插件采集的真实岗位数据。" title="岗位库" />
      <PageFeedback error={error} status="" />
      <Panel title={`岗位列表（${visibleJobs.length}）`}>
        {!jobs.length ? (
          <EmptyState
            description="请先在 BOSS 搜索结果页打开插件并点击采集岗位。"
            title="还没有采集岗位"
          />
        ) : (
          <>
            <label className="field">
              <span>搜索岗位</span>
              <input className="input" onChange={(event) => setQuery(event.target.value)} value={query} />
            </label>
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>岗位</th>
                    <th>城市</th>
                    <th>薪资</th>
                    <th>采集时间</th>
                    <th>详情</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleJobs.map((job) => (
                    <tr key={job.id}>
                      <td>
                        <strong>{job.title}</strong>
                        <span>{job.company}</span>
                      </td>
                      <td>{job.city || "未记录"}</td>
                      <td>{job.salary || "未记录"}</td>
                      <td>{job.collectedAt}</td>
                      <td>
                        {job.detailUrl ? (
                          <a href={job.detailUrl} rel="noreferrer" target="_blank">打开岗位</a>
                        ) : "无链接"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
    </>
  );
}
```

- [ ] **Step 5: 建立路由入口并删除旧首页**

创建：

```tsx
// apps/web/src/app/(workbench)/page.tsx
import OverviewPage from "@/components/overview-page";
export default function Page() {
  return <OverviewPage />;
}
```

```tsx
// apps/web/src/app/(workbench)/jobs/page.tsx
import JobsPage from "@/components/jobs-page";
export default function Page() {
  return <JobsPage />;
}
```

删除 `apps/web/src/app/page.tsx`，防止与 route group 根路由冲突。

- [ ] **Step 6: 运行页面职责测试**

Run:

```powershell
npx vitest run apps/web/test/multipage-routes.test.tsx
```

Expected: PASS。

- [ ] **Step 7: 提交概览和岗位库**

```powershell
git add apps/web/src/components/overview-page.tsx apps/web/src/components/jobs-page.tsx "apps/web/src/app/(workbench)/page.tsx" "apps/web/src/app/(workbench)/jobs/page.tsx" apps/web/src/app/page.tsx apps/web/test/multipage-routes.test.tsx
git commit -m "feat: add overview and job library pages"
```

---

### Task 6: 拆分筛选、资料和模板页面

**Files:**
- Create: `apps/web/src/components/filters-page.tsx`
- Create: `apps/web/src/components/profile-page.tsx`
- Create: `apps/web/src/components/template-page.tsx`
- Create: `apps/web/src/app/(workbench)/filters/page.tsx`
- Create: `apps/web/src/app/(workbench)/profile/page.tsx`
- Create: `apps/web/src/app/(workbench)/template/page.tsx`
- Test: `apps/web/test/settings-pages.test.tsx`

- [ ] **Step 1: 写页面隔离失败测试**

创建 `apps/web/test/settings-pages.test.tsx`：

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import FiltersPage from "@/components/filters-page";
import ProfilePage from "@/components/profile-page";
import TemplatePage from "@/components/template-page";

describe("settings page isolation", () => {
  it("renders only filter controls on the filter page", () => {
    const html = renderToStaticMarkup(<FiltersPage />);
    expect(html).toContain("筛选设置");
    expect(html).not.toContain("学校");
    expect(html).not.toContain("模板正文");
  });

  it("renders only profile controls on the profile page", () => {
    const html = renderToStaticMarkup(<ProfilePage />);
    expect(html).toContain("个人资料");
    expect(html).not.toContain("目标职位");
  });

  it("renders only template controls on the template page", () => {
    const html = renderToStaticMarkup(<TemplatePage />);
    expect(html).toContain("话术模板");
    expect(html).not.toContain("每日打招呼上限");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npx vitest run apps/web/test/settings-pages.test.tsx
```

Expected: FAIL，页面容器不存在。

- [ ] **Step 3: 实现筛选页容器**

`filters-page.tsx` 加载 `loadFiltersPageData()`，本地维护 `config`、`lastRunCounts`、通知和运行数据；渲染：

```tsx
<>
  <PageHeader description="定义目标岗位并运行筛选与话术生成。" title="筛选设置" />
  <PageFeedback error={error} status={status} />
  <FilterSettings
    config={config}
    lastRunCounts={lastRunCounts}
    onChange={setConfig}
    onError={setError}
    onOperationalRefresh={refreshOperationalData}
    onRunCompleted={setLastRunCounts}
    onSaved={setConfig}
    onStatus={setStatus}
  />
</>
```

保留 `FilterSettings` 内部现有保存和运行逻辑。

- [ ] **Step 4: 实现资料页容器**

`profile-page.tsx` 加载 `loadProfilePageData()` 并渲染：

```tsx
<>
  <PageHeader description="维护可被模型安全引用的真实教育、技能和项目素材。" title="个人资料" />
  <PageFeedback error={error} status={status} />
  <ProfileEditor
    onChange={setProfile}
    onError={setError}
    onSaved={setProfile}
    onStatus={setStatus}
    profile={profile}
  />
</>
```

- [ ] **Step 5: 实现模板页容器**

`template-page.tsx` 加载 `loadTemplatePageData()`，保留任务列表供现有模型提示逻辑使用：

```tsx
<>
  <PageHeader description="设置打招呼结构、语气和长度限制。" title="话术模板" />
  <PageFeedback error={error} status={status} />
  <TemplateSettings
    onChange={setTemplate}
    onError={setError}
    onSaved={setTemplate}
    onStatus={setStatus}
    tasks={tasks}
    template={template}
  />
</>
```

- [ ] **Step 6: 创建三个路由入口**

每个 `page.tsx` 只导入对应页面容器：

```tsx
// apps/web/src/app/(workbench)/filters/page.tsx
import FiltersPage from "@/components/filters-page";
export default function Page() {
  return <FiltersPage />;
}
```

```tsx
// apps/web/src/app/(workbench)/profile/page.tsx
import ProfilePage from "@/components/profile-page";
export default function Page() {
  return <ProfilePage />;
}
```

```tsx
// apps/web/src/app/(workbench)/template/page.tsx
import TemplatePage from "@/components/template-page";
export default function Page() {
  return <TemplatePage />;
}
```

- [ ] **Step 7: 运行页面隔离与现有表单测试**

Run:

```powershell
npx vitest run apps/web/test/settings-pages.test.tsx apps/web/test/filter-and-template.test.ts
```

Expected: PASS。

- [ ] **Step 8: 提交三个设置页面**

```powershell
git add apps/web/src/components/filters-page.tsx apps/web/src/components/profile-page.tsx apps/web/src/components/template-page.tsx "apps/web/src/app/(workbench)/filters/page.tsx" "apps/web/src/app/(workbench)/profile/page.tsx" "apps/web/src/app/(workbench)/template/page.tsx" apps/web/test/settings-pages.test.tsx
git commit -m "feat: split workbench settings pages"
```

---

### Task 7: 拆分审批队列和运行记录页面

**Files:**
- Create: `apps/web/src/components/approvals-page.tsx`
- Create: `apps/web/src/components/runs-page.tsx`
- Create: `apps/web/src/app/(workbench)/approvals/page.tsx`
- Create: `apps/web/src/app/(workbench)/runs/page.tsx`
- Test: `apps/web/test/operations-pages.test.tsx`
- Modify: `apps/web/test/workbench-contract.test.tsx`

- [ ] **Step 1: 写审批与运行页面失败测试**

创建 `apps/web/test/operations-pages.test.tsx`：

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ApprovalsPage from "@/components/approvals-page";
import RunsPage from "@/components/runs-page";

describe("operations pages", () => {
  it("keeps approval actions on the approval route", () => {
    const html = renderToStaticMarkup(<ApprovalsPage />);
    expect(html).toContain("审批队列");
    expect(html).not.toContain("导出诊断");
  });

  it("keeps logs and diagnostics on the runs route", () => {
    const html = renderToStaticMarkup(<RunsPage />);
    expect(html).toContain("运行记录");
    expect(html).toContain("导出诊断");
    expect(html).not.toContain("模板正文");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npx vitest run apps/web/test/operations-pages.test.tsx
```

Expected: FAIL，容器不存在。

- [ ] **Step 3: 实现审批页面容器**

`approvals-page.tsx` 从旧首页迁移以下状态和回调，不迁移筛选、资料或模板状态：

```tsx
const [tasks, setTasks] = useState<GreetingTask[]>([]);
const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
const [rejectReason, setRejectReason] = useState("");
```

加载 `loadApprovalsPageData()`，使用 `reconcileSelectedTaskIds()`，并渲染原 `ApprovalQueue`。页面标题为“审批队列”，说明强调“发送前必须人工确认”。

- [ ] **Step 4: 实现运行记录容器**

`runs-page.tsx` 加载 `loadRunsPageData()`，将现有 `RunStatus` 作为本页主体：

```tsx
<>
  <PageHeader description="查看发送额度、任务状态和最近运行日志。" title="运行记录" />
  <PageFeedback error={error} status={status} />
  <RunStatus
    isRefreshing={refreshing}
    onRefresh={() => void refresh()}
    runSummary={runSummary}
    serviceHealthy={!error && Boolean(runSummary)}
  />
</>
```

- [ ] **Step 5: 创建两个路由入口**

分别导出 `<ApprovalsPage />` 和 `<RunsPage />`。

- [ ] **Step 6: 更新旧工作台契约测试**

把 `apps/web/test/workbench-contract.test.tsx` 中“首页包含全部功能”的断言替换为：

```ts
expect(readFileSync(path.resolve(testDir, "../src/app/(workbench)/page.tsx"), "utf8"))
  .toContain("OverviewPage");
expect(readFileSync(path.resolve(testDir, "../src/app/(workbench)/approvals/page.tsx"), "utf8"))
  .toContain("ApprovalsPage");
expect(readFileSync(path.resolve(testDir, "../src/app/(workbench)/runs/page.tsx"), "utf8"))
  .toContain("RunsPage");
```

保留原组件级表单、审批和副作用测试。

- [ ] **Step 7: 运行操作页面和契约测试**

Run:

```powershell
npx vitest run apps/web/test/operations-pages.test.tsx apps/web/test/workbench-contract.test.tsx apps/web/test/workbench-helpers.test.ts
```

Expected: PASS。

- [ ] **Step 8: 提交操作页面**

```powershell
git add apps/web/src/components/approvals-page.tsx apps/web/src/components/runs-page.tsx "apps/web/src/app/(workbench)/approvals/page.tsx" "apps/web/src/app/(workbench)/runs/page.tsx" apps/web/test/operations-pages.test.tsx apps/web/test/workbench-contract.test.tsx
git commit -m "feat: split approval and run pages"
```

---

### Task 8: 实现 A1 清爽产品风和响应式布局

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/components/navigation.tsx`
- Test: `apps/web/test/responsive-style-contract.test.ts`

- [ ] **Step 1: 写视觉与移动布局失败测试**

创建 `apps/web/test/responsive-style-contract.test.ts`：

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.resolve(testDir, "../src/app/globals.css"), "utf8");

describe("A1 responsive style contract", () => {
  it("uses the approved real white and teal palette", () => {
    expect(css).toContain("--page-bg: #f8faf9");
    expect(css).toContain("--surface: #ffffff");
    expect(css).toContain("--accent: #0f8f78");
  });

  it("uses a fixed desktop sidebar and mobile drawer without page overflow", () => {
    expect(css).toMatch(/\.app-sidebar\s*\{[^}]*position:\s*fixed/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*840px\)/);
    expect(css).toMatch(/\.app-sidebar\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/body\s*\{[^}]*overflow-x:\s*hidden/s);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npx vitest run apps/web/test/responsive-style-contract.test.ts
```

Expected: FAIL，新的设计变量与布局规则不存在。

- [ ] **Step 3: 重写基础设计变量和应用布局**

在 `globals.css` 顶部使用：

```css
:root {
  --page-bg: #f8faf9;
  --surface: #ffffff;
  --surface-muted: #f3f7f5;
  --border: #dfe8e5;
  --text: #17201d;
  --muted: #68766f;
  --accent: #0f8f78;
  --accent-hover: #0d7d69;
  --accent-soft: #e9f7f4;
  --warning: #a86d12;
  --warning-soft: #fff6e7;
  --danger: #c2402f;
  --danger-soft: #fff1ef;
  --radius-sm: 8px;
  --radius-md: 10px;
  --shadow-subtle: 0 6px 18px rgba(20, 52, 43, 0.035);
  --sidebar-width: 220px;
}

body {
  overflow-x: hidden;
  background: var(--page-bg);
  color: var(--text);
}

.app-sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  width: var(--sidebar-width);
  border-right: 1px solid var(--border);
  background: var(--surface);
  padding: 24px 14px;
}

.app-content {
  min-width: 0;
  min-height: 100vh;
  margin-left: var(--sidebar-width);
}

.page-content {
  width: min(100%, 1440px);
  margin: 0 auto;
  padding: 28px 32px 40px;
}
```

- [ ] **Step 4: 统一导航、标题、面板、表格和状态样式**

实现：

- `.navigation-link` / `.navigation-link-active`
- `.page-header` / `.page-header-actions`
- `.overview-metrics` / `.overview-layout`
- `.panel` 使用真白背景、细边框、10px 圆角、极弱阴影
- `.task-table` / `.job-table` 使用列表或表格行，不使用卡片墙
- `.page-feedback`、`.notice`、`.status-badge-*`
- 所有输入、按钮和表格文字明确设置字号与行高
- `:focus-visible` 使用青绿色轮廓

- [ ] **Step 5: 实现移动导航和页面响应式**

在 `@media (max-width: 840px)` 中：

```css
.app-sidebar {
  display: none;
}

.app-content {
  margin-left: 0;
}

.mobile-app-header {
  display: flex;
}

.page-content {
  padding: 20px 14px 32px;
}

.overview-metrics,
.overview-layout,
.form-grid,
.meta-grid,
.metrics-grid,
.status-counts {
  grid-template-columns: 1fr;
}

.page-header {
  align-items: stretch;
  flex-direction: column;
}
```

移动抽屉使用固定定位和白色内容面；打开后所有路由可达。表格容器使用 `overflow-x: auto`，页面根节点不横向滚动。

- [ ] **Step 6: 运行视觉契约测试**

Run:

```powershell
npx vitest run apps/web/test/responsive-style-contract.test.ts apps/web/test/workbench-contract.test.tsx
```

Expected: PASS。

- [ ] **Step 7: 提交视觉系统**

```powershell
git add apps/web/src/app/globals.css apps/web/src/components/app-shell.tsx apps/web/src/components/navigation.tsx apps/web/test/responsive-style-contract.test.ts
git commit -m "style: apply clean multipage workbench design"
```

---

### Task 9: 全量自动化验证

**Files:**
- Modify only if tests expose genuine regressions.

- [ ] **Step 1: 运行 Web 测试**

Run:

```powershell
npm run test:web
```

Expected: 所有 Web 测试通过。若额度测试因系统日期夹具失败，先修复测试的固定时间隔离，不得忽略失败。

- [ ] **Step 2: 运行插件测试**

Run:

```powershell
npm test -w @boss-agent/extension
```

Expected: 所有插件测试通过。

- [ ] **Step 3: 运行类型检查**

Run:

```powershell
npm run typecheck
```

Expected: 所有 workspace 通过。

- [ ] **Step 4: 运行生产构建**

Run:

```powershell
npm run build
```

Expected: Next.js、扩展和共享包构建通过，路由列表包含 `/`、`/jobs`、`/filters`、`/profile`、`/template`、`/approvals`、`/runs`。

- [ ] **Step 5: 检查未跟踪临时文件不进入提交**

Run:

```powershell
git status --short
```

Expected: `.dev-server.*`、`.codex-security-scans/`、`.superpowers/` 不被暂存；业务代码没有遗漏。

---

### Task 10: 浏览器逐页功能和视觉验收

**Files:**
- Modify only files implicated by browser QA.
- Reference: `docs/superpowers/specs/2026-06-22-multipage-workbench-redesign.md`

- [ ] **Step 1: 启动开发服务**

Run:

```powershell
npm run dev
```

Expected: `http://localhost:3000` 可访问。

- [ ] **Step 2: 桌面逐页验收**

使用 Chrome/Browser 插件依次访问：

```text
/
/jobs
/filters
/profile
/template
/approvals
/runs
```

每页检查：

- 当前侧边栏高亮唯一正确。
- 页面只显示一种主要功能。
- 标题、说明和主要操作符合设计文档。
- 无虚构统计、趋势或模型额度。
- 表单保存、流水线运行、草稿编辑、审批与刷新操作可用。
- DeepSeek 新任务显示真实提供方和模型。

- [ ] **Step 3: 移动端验收**

在约 `390×844` 视口检查：

- 菜单按钮可打开和关闭抽屉。
- 七个路由均可到达。
- 页面无整体横向滚动。
- 表格只在自身容器内滚动或转换为分组行。
- 按钮、输入框、标签和状态信息不裁切。

- [ ] **Step 4: 对照视觉基准检查至少五项**

记录并修复：

1. 真白内容面与 `#f8faf9` 页面背景。
2. 220px 左侧栏和浅青绿色选中态。
3. 克制标题字号与充足留白。
4. 细边框、8–10px 圆角和极弱阴影。
5. 列表/表格优先，没有装饰性卡片墙。
6. 青绿色只用于主要操作和选中状态。

- [ ] **Step 5: 截取最终桌面与移动截图并进行图像检查**

使用浏览器截图保存最终概览页桌面和移动版本，再用 `view_image` 检查。若存在明显拥挤、错位、颜色漂移、字体层级或移动溢出，继续修复后重新截图。

- [ ] **Step 6: 最终回归验证**

Run:

```powershell
npm run typecheck
npm run test:web
npm test -w @boss-agent/extension
npm run build
```

Expected: 全部通过。

- [ ] **Step 7: 提交浏览器 QA 修复**

```powershell
git add apps/web/src apps/web/test
git commit -m "fix: complete multipage workbench QA"
```

若浏览器验收无需代码调整，则跳过空提交。

---

### Task 11: 最终 Git 检查与交付

- [ ] **Step 1: 检查提交历史和工作区**

Run:

```powershell
git log --oneline -10
git status --short
```

Expected: 多页面工作台按任务拆分为可审查提交；仅剩明确排除的本地临时文件。

- [ ] **Step 2: 汇总交付**

最终说明必须包含：

- 新路由列表。
- 现有功能未退化的验证结果。
- DeepSeek 兼容修复结果。
- 桌面和移动浏览器验收范围。
- 测试、类型检查和构建结果。
- 未提交的本地临时文件说明。
