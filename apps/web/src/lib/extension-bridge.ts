const WORKBENCH_ORIGIN = "http://localhost:3000";
const WEB_SOURCE = "boss-agent-workbench";
const EXTENSION_SOURCE = "boss-agent-extension";

type BridgeWindow = Pick<Window, "addEventListener" | "removeEventListener" | "postMessage"> & {
  location: Pick<Location, "origin">;
};

type BridgeOptions = {
  target?: Window;
  timeoutMs?: number;
};

type BridgeCheckOptions = BridgeOptions & {
  retryMs?: number;
};

export type ExtensionRunResult = {
  ok: boolean;
  message: string;
  reason?: string;
};

export type JobEnrichmentResult = ExtensionRunResult & {
  total: number;
  completed: number;
  failed: number;
};

export function checkExtensionBridge(options: BridgeCheckOptions = {}): Promise<boolean> {
  const target = getTarget(options.target);
  const timeoutMs = options.timeoutMs ?? 2_000;
  const retryMs = options.retryMs ?? 200;
  const requestId = createRequestId();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      clearInterval(retry);
      target.removeEventListener("message", onMessage as EventListener);
    };
    const onMessage = (event: MessageEvent) => {
      if (!isMatchingEvent(event, target, requestId, "BOSS_AGENT_BRIDGE_READY")) return;
      cleanup();
      resolve(true);
    };
    const sendPing = () => target.postMessage(
      { source: WEB_SOURCE, type: "BOSS_AGENT_BRIDGE_PING", requestId },
      WORKBENCH_ORIGIN
    );

    target.addEventListener("message", onMessage as EventListener);
    sendPing();
    const retry = setInterval(sendPing, Math.max(10, retryMs));
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("扩展未连接，请在扩展页刷新后重试"));
    }, Math.max(1, timeoutMs));
  });
}

export function runApprovedTasksViaExtension(options: BridgeOptions = {}): Promise<ExtensionRunResult> {
  const target = getTarget(options.target);
  const timeoutMs = options.timeoutMs ?? 5_000;
  const requestId = createRequestId();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      target.removeEventListener("message", onMessage as EventListener);
    };
    const onMessage = (event: MessageEvent) => {
      if (!isMatchingEvent(event, target, requestId, "RUN_APPROVED_TASKS_RESULT")) return;
      const response = isRecord(event.data.response) ? event.data.response : {};
      cleanup();
      resolve({
        ok: response.ok === true,
        message: typeof response.message === "string" ? response.message : "扩展未返回执行说明",
        ...(typeof response.reason === "string" ? { reason: response.reason } : {})
      });
    };

    target.addEventListener("message", onMessage as EventListener);
    target.postMessage(
      { source: WEB_SOURCE, type: "RUN_APPROVED_TASKS", requestId },
      WORKBENCH_ORIGIN
    );
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("扩展未连接，请在扩展页刷新后重试"));
    }, Math.max(1, timeoutMs));
  });
}

export function runJobEnrichmentViaExtension(
  jobs: Array<{ id: string; detailUrl: string }>,
  options: BridgeOptions = {}
): Promise<JobEnrichmentResult> {
  const target = getTarget(options.target);
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const requestId = createRequestId();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      target.removeEventListener("message", onMessage as EventListener);
    };
    const onMessage = (event: MessageEvent) => {
      if (!isMatchingEvent(event, target, requestId, "ENRICH_JOB_DETAILS_RESULT")) return;
      const response = isRecord(event.data.response) ? event.data.response : {};
      cleanup();
      resolve({
        ok: response.ok === true,
        message: typeof response.message === "string" ? response.message : "扩展未返回补全说明",
        ...(typeof response.reason === "string" ? { reason: response.reason } : {}),
        total: Number.isInteger(response.total) ? Number(response.total) : jobs.length,
        completed: Number.isInteger(response.completed) ? Number(response.completed) : 0,
        failed: Number.isInteger(response.failed) ? Number(response.failed) : 0
      });
    };

    target.addEventListener("message", onMessage as EventListener);
    target.postMessage(
      { source: WEB_SOURCE, type: "ENRICH_JOB_DETAILS", requestId, jobs },
      WORKBENCH_ORIGIN
    );
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("岗位详情补全等待超时，请查看 BOSS 页面和扩展状态"));
    }, Math.max(1, timeoutMs));
  });
}

function getTarget(target?: Window): BridgeWindow {
  const resolved = target ?? window;
  if (resolved.location.origin !== WORKBENCH_ORIGIN) {
    throw new Error("扩展桥仅允许从 http://localhost:3000 使用");
  }
  return resolved;
}

function isMatchingEvent(
  event: MessageEvent,
  target: BridgeWindow,
  requestId: string,
  type: string
): event is MessageEvent<Record<string, unknown>> {
  return (
    event.source === target &&
    event.origin === WORKBENCH_ORIGIN &&
    isRecord(event.data) &&
    event.data.source === EXTENSION_SOURCE &&
    event.data.type === type &&
    event.data.requestId === requestId
  );
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `boss-agent-${Date.now()}-${Math.random()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
