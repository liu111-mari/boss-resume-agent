import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchJson,
  loadApprovalsPageData,
  loadFiltersPageData,
  loadOverviewPageData,
  loadProfilePageData,
  loadRunsPageData,
  loadTemplatePageData
} from "@/lib/client-api";

describe("client api helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when a successful response body is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 200 }))
    );

    await expect(fetchJson("/api/empty")).rejects.toThrow("响应为空");
  });

  it("throws a non-json error for invalid success payloads without echoing full html", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html><body>server exploded with a very long page</body></html>", {
            status: 502,
            headers: { "content-type": "text/html" }
          })
      )
    );

    await expect(fetchJson("/api/html-error")).rejects.toThrow("服务返回非 JSON 响应（HTTP 502）");
    await expect(fetchJson("/api/html-error")).rejects.not.toThrow(/<html>/i);
  });

  it("prefers parsed error payloads for non-ok responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "conflict", message: "任务已被其他操作更新" }), {
            status: 409,
            headers: { "content-type": "application/json" }
          })
      )
    );

    await expect(fetchJson("/api/conflict")).rejects.toThrow("任务已被其他操作更新");
  });

  it("returns parsed json for valid successful responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, count: 2 }), {
            status: 200,
            headers: { "content-type": "application/json" }
          })
      )
    );

    await expect(fetchJson<{ ok: boolean; count: number }>("/api/ok")).resolves.toEqual({
      ok: true,
      count: 2
    });
  });

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
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["/api/profile"]);

    fetchMock.mockClear();
    await loadTemplatePageData();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/greeting-template",
      "/api/tasks"
    ]);

    fetchMock.mockClear();
    await loadFiltersPageData();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["/api/config"]);

    fetchMock.mockClear();
    await loadApprovalsPageData();
    expect(fetchMock.mock.calls.map(([url]) => String(url)).sort()).toEqual([
      "/api/config",
      "/api/jobs",
      "/api/profile",
      "/api/tasks"
    ]);

    fetchMock.mockClear();
    await loadRunsPageData();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["/api/run-summary"]);
  });
});
