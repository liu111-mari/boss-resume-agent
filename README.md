# BOSS 打招呼工作台

本项目由本地 Next.js 工作台和 Chrome MV3 插件组成。插件采集当前 BOSS 页面可见岗位；工作台按可编辑规则筛选岗位、调用本地模板或 DeepSeek 生成岗位定制问候，经过人工审批后，插件才会执行发送。

系统只使用个人库中已保存的真实信息。模型输出仍需人工检查；发送后只有在聊天历史中检测到新消息证据，才会计入“今日确认发送”。

## 安装与运行

```bash
npm install
npm run dev
```

工作台默认地址为 `http://localhost:3000`。

构建插件：

```bash
npm run extension:build
```

然后打开 `chrome://extensions`：

1. 开启“开发者模式”。
2. 点击“加载已解压的扩展程序”。
3. 选择 `apps/extension/dist`。

修改扩展源码后需要重新执行 `npm run extension:build`，并在扩展管理页重新加载。

## 模型配置

默认使用本地模式，不发送模型请求，按模板和已启用的个人素材完成匹配与问候生成。

如需使用 DeepSeek，将根目录 `.env.example` 复制为 `apps/web/.env.local`，配置：

```dotenv
GREETING_MODEL_PROVIDER=deepseek
GREETING_MODEL_API_KEY=你的密钥
GREETING_MODEL_BASE_URL=https://api.deepseek.com
GREETING_MODEL_NAME=deepseek-chat
GREETING_MODEL_INPUT_CNY_PER_MILLION=2
GREETING_MODEL_OUTPUT_CNY_PER_MILLION=8
BOSS_AGENT_WEB_ORIGIN=http://localhost:3000
BOSS_AGENT_EXTENSION_ORIGIN=chrome-extension://你的插件ID
```

首次加载扩展后，在 `chrome://extensions` 复制扩展 ID，填入
`BOSS_AGENT_EXTENSION_ORIGIN`，然后重启本地工作台。服务端只接受该扩展来源和配置的本地工作台来源发起写操作。

要恢复本地模式：

```dotenv
GREETING_MODEL_PROVIDER=local
GREETING_MODEL_API_KEY=
```

价格变量只用于估算成本，应按实际模型价格自行更新。API Key 仅从环境变量读取，不写入模板或诊断导出。

## 使用流程

1. 在工作台编辑并保存筛选条件，包括目标岗位、城市、薪资、关键词、黑名单、评分阈值和每日确认额度。
2. 编辑个人信息库，维护学校、专业、毕业时间、求职方向，以及技能、项目和其他可证明素材；不确定或不想使用的素材可以停用。
3. 编辑打招呼模板、语气和长度范围。
4. 登录 BOSS，打开岗位搜索或推荐页面，在插件中点击“采集可见岗位”。
5. 回到工作台运行筛选与生成，在审批队列中逐条检查、修改、批准或拒绝问候。
6. 在插件中点击“执行已审批任务”。插件会逐条打开岗位并发送，遇到异常立即暂停。

工作台中的筛选配置、个人库和模板均可继续修改，不需要改代码。

## 额度与安全边界

- 每日额度按北京时间统计，只计算具有聊天历史确认凭证的成功发送。
- 点击发送但未确认、失败、暂停的任务不计入已确认额度。
- 额度是本项目的本地保护值，不代表或绕过 BOSS 平台限制。
- 不自动切换账号。需要换号时必须由用户手动登录并重新确认当前账号和页面状态。
- 遇到验证码、安全验证、登录失效、账号异常、操作频繁或其他风控提示时，自动流程会暂停；项目不绕过这些检查。
- 发送前必须人工审批。页面结构不明确、发送按钮不唯一或发送结果无法确认时，不会标记为已发送。

## 数据与诊断

本地数据默认写入运行目录下的 `.boss-agent-data`；通过根目录命令启动时通常位于 `apps/web/.boss-agent-data`。可以在 `apps/web/.env.local` 中指定绝对目录：

```dotenv
BOSS_AGENT_DATA_DIR=D:\path\to\boss-agent-data
```

目录内包含筛选配置、个人库、模板、岗位、任务、运行日志和每日用量 JSON。请自行备份，不要提交包含个人信息的数据目录。

工作台“运行状态”区域提供“导出诊断”，用于导出已脱敏的配置、任务和日志。导出文件不会包含模型 API Key，但提交问题前仍应人工检查内容。

## 测试与构建

```bash
# 扩展单元测试和脱敏页面回放测试
npm test -w @boss-agent/extension

# Web 测试
npm run test:web

# 全部测试
npm test

# 类型检查、代码检查和完整构建
npm run typecheck
npm run lint
npm run build
```

扩展回放夹具位于 `apps/extension/test/fixtures`，只保留测试所需的最小脱敏 DOM，不包含真实账号、公司或聊天数据。
