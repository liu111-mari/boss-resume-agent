(function initializeGreetingTaskRunner(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GreetingTaskRunner = api;
})(typeof globalThis === "object" ? globalThis : this, function createGreetingTaskRunnerModule() {
  const DEFAULT_TAB_TIMEOUT_MS = 15_000;
  const DEFAULT_PACING_MS = 2_500;
  const DEFAULT_SETTLE_MS = 1_200;

  function waitForTabComplete(tabs, tabId, timeoutMs = DEFAULT_TAB_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
      };
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === "complete") {
          finish(resolve);
        }
      };
      const timer = setTimeout(
        () => finish(() => reject(new Error("tab_load_timeout"))),
        timeoutMs
      );
      tabs.onUpdated.addListener(listener);
    });
  }

  function createTaskRunner(dependencies) {
    const {
      request,
      createTab,
      waitForTab,
      sendMessage,
      delay,
      listPendingConfirmations = async () => [],
      savePendingConfirmation = async () => {},
      removePendingConfirmation = async () => {},
      pacingMs = DEFAULT_PACING_MS,
      settleMs = DEFAULT_SETTLE_MS
    } = dependencies;
    let running = false;

    async function updateStatus(taskId, status, extra = {}) {
      const payload = await request("/api/tasks/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, status, ...extra })
      });
      if (
        !payload ||
        !payload.task ||
        payload.task.id !== taskId ||
        payload.task.status !== status
      ) {
        const error = new Error("malformed_status_response");
        error.code = "malformed_api";
        throw error;
      }
      return payload.task;
    }

    async function updateStatusWithRetry(taskId, status, extra = {}, attempts = 3) {
      let lastError;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          return await updateStatus(taskId, status, extra);
        } catch (error) {
          lastError = error;
          if (attempt + 1 < attempts) await delay(250 * (attempt + 1));
        }
      }
      throw lastError;
    }

    async function runOneTask(task) {
      if (!task.detailUrl) return { ok: false, error: "missing_detail_url" };
      const tab = await createTab(task.detailUrl);
      if (!tab || typeof tab.id !== "number") return { ok: false, error: "invalid_tab" };
      await waitForTab(tab.id);
      await delay(settleMs);
      await updateStatus(task.id, "sending");
      return sendMessage(tab.id, { type: "SEND_GREETING", task });
    }

    async function runApprovedTasks() {
      if (running) return { ok: false, reason: "already_running", message: "任务正在执行中" };
      running = true;
      try {
        const pendingConfirmations = await listPendingConfirmations();
        if (!Array.isArray(pendingConfirmations)) {
          return { ok: false, reason: "malformed_api", message: "本地确认记录损坏" };
        }
        for (const pending of pendingConfirmations) {
          if (!pending?.taskId || !pending?.confirmationEvidence) continue;
          try {
            await updateStatusWithRetry(pending.taskId, "sent", {
              confirmationEvidence: pending.confirmationEvidence
            });
            await removePendingConfirmation(pending.taskId);
          } catch {
            return {
              ok: false,
              reason: "paused",
              message: "存在已发送但未同步的消息，请保持本地工作台运行后重试"
            };
          }
        }

        let completed = 0;
        while (true) {
          const payload = await request("/api/tasks/approved", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}"
          });
          if (
            !payload ||
            !Array.isArray(payload.tasks) ||
            !payload.quota ||
            typeof payload.quota.blocked !== "boolean" ||
            !Number.isInteger(payload.quota.used) ||
            !Number.isInteger(payload.quota.limit) ||
            !Number.isInteger(payload.quota.reserved) ||
            !Number.isInteger(payload.quota.remaining) ||
            payload.quota.used < 0 ||
            payload.quota.limit < 1 ||
            payload.quota.reserved < 0 ||
            payload.quota.remaining < 0 ||
            payload.quota.remaining !==
              Math.max(payload.quota.limit - payload.quota.used - payload.quota.reserved, 0) ||
            (payload.quota.used >= payload.quota.limit && !payload.quota.blocked) ||
            payload.tasks.length > 1 ||
            payload.tasks.length > Math.max(payload.quota.limit - payload.quota.used, 0) ||
            payload.tasks.some((task) => !task || task.status !== "sending") ||
            (payload.quota.blocked && payload.tasks.length > 0)
          ) {
            return { ok: false, reason: "malformed_api", message: "本地工作台返回了无效数据" };
          }
          if (payload.quota.blocked) {
            return completed > 0
              ? { ok: true, reason: "completed", message: "已执行可用额度内的审批任务" }
              : { ok: false, reason: "quota_blocked", message: "今日确认发送已达到上限" };
          }
          if (payload.tasks.length === 0) {
            return completed > 0
              ? { ok: true, reason: "completed", message: "审批任务执行完成，请回工作台查看状态" }
              : { ok: true, reason: "empty", message: "没有已审批任务" };
          }

          const task = payload.tasks[0];
          let result;
          try {
            result = await runOneTask(task);
          } catch (error) {
            if (error?.code === "quota_blocked") {
              return { ok: false, reason: "quota_blocked", message: "今日确认发送已达到上限" };
            }
            if (error?.code === "malformed_api") {
              return { ok: false, reason: "malformed_api", message: "状态接口返回了无效数据" };
            }
            result = {
              ok: false,
              error: error instanceof Error ? error.message : "task_execution_failed"
            };
          }

          const evidence = normalizeConfirmationEvidence(result?.confirmationEvidence);
          const pause =
            Boolean(result?.pause) ||
            /risk|captcha|verify|login|auth|账号|验证/i.test(String(result?.error ?? ""));

          if (result?.ok && evidence) {
            let pendingSaved = false;
            try {
              await savePendingConfirmation({
                taskId: task.id,
                confirmationEvidence: evidence
              });
              pendingSaved = true;
            } catch {
              // Continue with immediate server synchronization; storage is only the recovery fallback.
            }
            try {
              await updateStatusWithRetry(task.id, "sent", { confirmationEvidence: evidence });
              if (pendingSaved) {
                try {
                  await removePendingConfirmation(task.id);
                } catch {
                  // Reconciliation is idempotent and will clear it on the next run.
                }
              }
            } catch (error) {
              if (error?.code === "quota_blocked") {
                return { ok: false, reason: "quota_blocked", message: "今日确认发送已达到上限" };
              }
              try {
                await updateStatusWithRetry(task.id, "paused", {
                  failureReason: "confirmation_persist_failed",
                  confirmationEvidence: evidence
                });
                if (pendingSaved) {
                  try {
                    await removePendingConfirmation(task.id);
                  } catch {
                    // A later reconciliation can safely promote paused+evidence to sent.
                  }
                }
              } catch {
                // The confirmed message must never be retried as a fresh send in this run.
              }
              return {
                ok: false,
                reason: "paused",
                message: "消息已确认出现在聊天记录，但本地状态保存失败，请人工核对"
              };
            }
          } else if (pause) {
            await updateStatus(task.id, "paused", {
              failureReason: String(result?.error ?? "risk_or_auth_pause")
            });
            return { ok: false, reason: "paused", message: "检测到验证或风险页面，任务已暂停" };
          } else {
            await updateStatus(task.id, "failed", {
              failureReason: String(
                result?.error ?? (result?.ok ? "confirmation_missing" : "send_failed")
              )
            });
          }

          completed += 1;
          await delay(Math.max(0, pacingMs));
        }
      } finally {
        running = false;
      }
    }

    return { runApprovedTasks };
  }

  return {
    DEFAULT_PACING_MS,
    DEFAULT_TAB_TIMEOUT_MS,
    waitForTabComplete,
    createTaskRunner
  };

  function normalizeConfirmationEvidence(value) {
    if (typeof value === "string") return value.trim();
    if (!value || typeof value !== "object") return "";
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
});
