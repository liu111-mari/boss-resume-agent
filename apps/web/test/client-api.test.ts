import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchJson } from "@/lib/client-api";

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
});
