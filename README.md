# BOSS 求职自动化助手

一个本地优先的求职工作台：Chrome 插件读取用户已登录的 BOSS 直聘页面，Next.js WebApp 负责岗位池、审批队列、消息线索、JD 解析、岗位版简历生成和 DOCX 导出。

## 功能边界

- 采用“审批后自动发送”：系统可以采集岗位、生成打招呼队列，用户审批后才发送。
- 不读取 Cookie、localStorage、密码或浏览器会话文件。
- 不绕过验证码、风控弹窗或平台限制。
- 不做无人值守群发。
- 简历生成只基于真实素材改写、排序和强调，不编公司、岗位或结果数据。

## 技术栈

- Next.js App Router + TypeScript
- Chrome Extension MV3
- Vercel AI SDK + Zod structured output
- docx 导出 Word 简历
- shadcn 风格的轻量 UI 组件

## 本地运行

```bash
npm install
npm run dev
```

访问 `http://localhost:3000`。

## 加载 Chrome 插件

```bash
npm run extension:build
```

然后在 Chrome 打开 `chrome://extensions`，开启开发者模式，加载 `apps/extension/dist`。

## 环境变量

复制 `.env.example` 到 `.env.local`：

```bash
OPENAI_API_KEY=
```

没有 API Key 时，系统会使用本地启发式解析和模板生成，方便先跑通流程。

## 使用流程

1. 打开 BOSS 推荐页或搜索页。
2. 点击插件里的“采集可见岗位”。
3. 回到 WebApp 查看岗位池，生成打招呼任务。
4. 勾选任务并审批。
5. 回到 BOSS 页面，点击插件里的“执行已审批任务”。
6. 在消息页点击“采集消息线索”，识别 HR 是否索要简历。
7. 在 WebApp 生成岗位版简历并下载 DOCX。

## 开源参考

执行前调研了 `get_jobs`、`auto-zhipin`、`boss-helper`、`JobPilot`、`Resume-Matcher`、`OpenResume` 等项目。当前项目只借鉴功能拆分和稳定性策略，不复制 Cookie 导出、绕验证码或无人值守群发实现。
