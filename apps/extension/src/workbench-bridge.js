const WORKBENCH_ORIGIN = "http://localhost:3000";
const WEB_SOURCE = "boss-agent-workbench";
const EXTENSION_SOURCE = "boss-agent-extension";

window.addEventListener("message", async (event) => {
  if (event.source !== window || event.origin !== WORKBENCH_ORIGIN) return;

  const message = event.data;
  if (!message || typeof message !== "object" || message.source !== WEB_SOURCE) return;
  if (typeof message.requestId !== "string" || !message.requestId) return;

  if (message.type === "BOSS_AGENT_BRIDGE_PING") {
    postBridgeMessage("BOSS_AGENT_BRIDGE_READY", message.requestId);
    return;
  }

  if (message.type !== "RUN_APPROVED_TASKS") return;

  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: "RUN_APPROVED_TASKS" });
  } catch (error) {
    response = {
      ok: false,
      message: error instanceof Error ? error.message : "无法启动自动发送"
    };
  }

  postBridgeMessage("RUN_APPROVED_TASKS_RESULT", message.requestId, response);
});

function postBridgeMessage(type, requestId, response) {
  window.postMessage(
    {
      source: EXTENSION_SOURCE,
      type,
      requestId,
      ...(response === undefined ? {} : { response })
    },
    WORKBENCH_ORIGIN
  );
}
