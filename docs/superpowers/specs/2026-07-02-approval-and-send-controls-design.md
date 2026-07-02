# 审批恢复与工作台一键发送设计

## 目标

在审批队列页面完成两个闭环：待审批或暂停任务可以被选择并批准；已有已批准任务时，用户可以在同一页面点击一次按钮触发 Chrome 扩展的批量发送。

## 当前问题

- 当前数据没有 `pending_review`，只有 `approved`、`paused` 等状态，因此只允许选择 `pending_review` 的前端把所有审批控件禁用了。
- 后端状态机已经允许 `paused -> approved`，但页面的选择过滤和“全选”逻辑没有包含暂停任务。
- `RUN_APPROVED_TASKS` 只在扩展弹窗中可调用，localhost 工作台没有与扩展通信的桥。

## 审批交互

- 可审批状态统一为 `pending_review` 和 `paused`。
- “全选可审批”选中这两类任务。
- 卡片复选框在这两类状态下启用。
- “批准选中”继续调用现有 `/api/tasks/approve`；暂停任务恢复为 `approved`。
- 已批准任务只读展示，不允许重复批准。
- 页面分别显示待审批、暂停和已批准数量，避免把“没有待审批”误解成按钮故障。

## 工作台一键发送

- 审批页顶部显示主按钮：`一键自动发送 N 条`，其中 N 是当前 `approved` 数量。
- N 为 0、正在请求或扩展未连接时按钮禁用。
- 点击一次即表示授权扩展处理当前全部已批准任务；页面本身不接触 BOSS 页面 DOM。
- 扩展返回开始、已在运行、无任务、额度耗尽或暂停原因，页面用现有状态/错误区域显示。
- 触发成功后刷新任务和运行摘要，展示最新状态。

## localhost 与扩展安全桥

- Manifest 增加仅匹配 `http://localhost:3000/*` 的独立内容脚本 `workbench-bridge.js`。
- Web 页面通过 `window.postMessage` 发送固定结构：来源标识、请求 ID 和 `RUN_APPROVED_TASKS`。
- 桥只接受 `event.source === window`、`event.origin === "http://localhost:3000"`、已知来源标识和唯一允许的命令。
- 桥调用 `chrome.runtime.sendMessage({ type: "RUN_APPROVED_TASKS" })`，再以相同请求 ID 回传结果。
- 不传 API Key、个人资料、话术正文或任意 URL；页面不能请求扩展执行其他命令。
- Web 客户端设置超时；未安装扩展、未重载或桥未响应时显示“扩展未连接，请在扩展页刷新”。

## 代码边界

- `apps/web/src/components/approval-queue.tsx`：可审批状态与按钮 UI。
- `apps/web/src/components/approvals-page.tsx`：已批准计数、发送状态和刷新协调。
- `apps/web/src/lib/extension-bridge.ts`：浏览器消息请求/响应与超时。
- `apps/extension/src/workbench-bridge.js`：localhost 消息验证及扩展调用。
- `apps/extension/src/manifest.json`：localhost 内容脚本注册。

## 验证

- 测试暂停任务可以被选择、全选并调用批准接口。
- 测试发送按钮数量、禁用条件、成功和未连接提示。
- 测试 Web 桥按请求 ID 匹配响应并在超时后清理监听器。
- 测试扩展桥拒绝错误来源、错误 origin 和未知命令。
- 运行 Web、扩展全量测试、类型检查和扩展构建。
- 浏览器只验证按钮显示和桥连接，不触发 `RUN_APPROVED_TASKS`。

