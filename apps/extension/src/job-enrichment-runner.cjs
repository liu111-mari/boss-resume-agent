(function initializeJobEnrichmentRunner(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.JobEnrichmentRunner = api;
})(typeof globalThis === "object" ? globalThis : this, function createJobEnrichmentRunnerModule() {
  const RISK_PATTERN = /risk|captcha|verify|login|auth|账号|登录|验证码|验证|安全提示/i;

  function createJobEnrichmentRunner(dependencies) {
    const {
      createTab,
      waitForTab,
      collectTab,
      closeTab,
      delay,
      settleMs = 1_200,
      pacingMs = 2_500
    } = dependencies;
    let running = false;

    async function runJobs(jobs) {
      if (running) {
        return {
          ok: false,
          reason: "already_running",
          total: 0,
          completed: 0,
          failed: 0,
          message: "岗位详情补全正在执行中"
        };
      }

      const candidates = Array.isArray(jobs)
        ? jobs.filter((job) => job?.id && /^https:\/\/(?:www\.)?zhipin\.com\//.test(job.detailUrl ?? ""))
        : [];
      running = true;
      let completed = 0;
      let failed = 0;

      try {
        for (let index = 0; index < candidates.length; index += 1) {
          const job = candidates[index];
          let tabId;
          let result;
          try {
            const tab = await createTab(job.detailUrl);
            if (!tab || typeof tab.id !== "number") throw new Error("invalid_tab");
            tabId = tab.id;
            await waitForTab(tabId);
            if (settleMs > 0) await delay(settleMs);
            result = await collectTab(tabId);
            if (result?.ok) completed += 1;
            else failed += 1;
          } catch (error) {
            failed += 1;
            result = {
              ok: false,
              message: error instanceof Error ? error.message : "岗位详情补全失败"
            };
          } finally {
            if (typeof tabId === "number") {
              try {
                await closeTab(tabId);
              } catch {
                // The page may already have been closed by the user.
              }
            }
          }

          if (!result?.ok && RISK_PATTERN.test(String(result?.code ?? result?.message ?? result?.error ?? ""))) {
            return {
              ok: false,
              reason: "paused",
              total: candidates.length,
              completed,
              failed,
              message: "检测到登录、验证码或安全提示，岗位详情补全已暂停"
            };
          }

          if (index + 1 < candidates.length && pacingMs > 0) {
            await delay(pacingMs);
          }
        }

        return {
          ok: true,
          reason: "completed",
          total: candidates.length,
          completed,
          failed,
          message: `岗位详情补全完成：成功 ${completed}，失败 ${failed}`
        };
      } finally {
        running = false;
      }
    }

    return { runJobs };
  }

  return { createJobEnrichmentRunner };
});
