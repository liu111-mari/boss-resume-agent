import { describe, expect, it } from "vitest";

import {
  checkExtensionBridge,
  runApprovedTasksViaExtension
} from "@/lib/extension-bridge";

type MessageListener = (event: MessageEvent) => void;

class FakeBridgeWindow {
  location = { origin: "http://localhost:3000" };
  messages: Array<{ data: unknown; targetOrigin: string }> = [];
  listeners = new Set<MessageListener>();

  addEventListener(type: string, listener: MessageListener) {
    if (type === "message") this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: MessageListener) {
    if (type === "message") this.listeners.delete(listener);
  }

  postMessage(data: unknown, targetOrigin: string) {
    this.messages.push({ data, targetOrigin });
  }

  emit(data: unknown, overrides: Partial<MessageEvent> = {}) {
    const event = {
      data,
      origin: this.location.origin,
      source: this,
      ...overrides
    } as unknown as MessageEvent;
    for (const listener of this.listeners) listener(event);
  }
}

describe("extension bridge", () => {
  it("detects a ready localhost extension bridge with a matching request id", async () => {
    const target = new FakeBridgeWindow();
    const pending = checkExtensionBridge({ target: target as unknown as Window, timeoutMs: 50, retryMs: 5 });
    const request = target.messages[0]?.data as { requestId: string };

    target.emit({
      source: "boss-agent-extension",
      type: "BOSS_AGENT_BRIDGE_READY",
      requestId: request.requestId
    });

    await expect(pending).resolves.toBe(true);
    expect(target.listeners.size).toBe(0);
  });

  it("returns the batch execution result and ignores unrelated responses", async () => {
    const target = new FakeBridgeWindow();
    const pending = runApprovedTasksViaExtension({ target: target as unknown as Window, timeoutMs: 50 });
    const request = target.messages[0]?.data as { requestId: string };

    target.emit({
      source: "boss-agent-extension",
      type: "RUN_APPROVED_TASKS_RESULT",
      requestId: "wrong-request",
      response: { ok: false, message: "wrong" }
    });
    target.emit({
      source: "boss-agent-extension",
      type: "RUN_APPROVED_TASKS_RESULT",
      requestId: request.requestId,
      response: { ok: true, message: "任务已开始执行" }
    });

    await expect(pending).resolves.toEqual({ ok: true, message: "任务已开始执行" });
    expect(target.listeners.size).toBe(0);
  });

  it("rejects wrong origins and cleans up after timeout", async () => {
    const target = new FakeBridgeWindow();
    const pending = runApprovedTasksViaExtension({ target: target as unknown as Window, timeoutMs: 5 });
    const request = target.messages[0]?.data as { requestId: string };

    target.emit(
      {
        source: "boss-agent-extension",
        type: "RUN_APPROVED_TASKS_RESULT",
        requestId: request.requestId,
        response: { ok: true, message: "不应接受" }
      },
      { origin: "https://example.com" }
    );

    await expect(pending).rejects.toThrow("扩展未连接");
    expect(target.listeners.size).toBe(0);
  });
});
