"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardList,
  FileText,
  MessageSquareText,
  Play,
  RefreshCw,
  Send,
  Settings,
  Sparkles
} from "lucide-react";
import type { ConversationLead, GreetingTask, JobCard, ParsedJD, ResumeVersion } from "@boss-agent/shared";

const navItems = [
  { label: "工作台", icon: ClipboardList, active: true },
  { label: "岗位池", icon: BriefcaseBusiness },
  { label: "打招呼队列", icon: Send },
  { label: "消息线索", icon: MessageSquareText },
  { label: "简历生成", icon: FileText },
  { label: "设置", icon: Settings }
];

export default function Home() {
  const [jobs, setJobs] = useState<JobCard[]>([]);
  const [tasks, setTasks] = useState<GreetingTask[]>([]);
  const [conversations, setConversations] = useState<ConversationLead[]>([]);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [filters, setFilters] = useState({ city: "", keyword: "", direction: "", blacklist: "" });
  const [jdText, setJdText] = useState("");
  const [parsedJD, setParsedJD] = useState<ParsedJD | null>(null);
  const [resume, setResume] = useState<ResumeVersion | null>(null);
  const [notice, setNotice] = useState("等待 Chrome 插件采集岗位。也可以先加载示例数据跑通流程。");

  useEffect(() => {
    void refreshAll();
  }, []);

  const filteredJobs = useMemo(() => {
    const blacklist = filters.blacklist.split(/[,，\s]/).filter(Boolean);
    return jobs.filter((job) => {
      const text = `${job.title} ${job.company} ${job.city} ${job.jdText}`.toLowerCase();
      if (filters.city && !job.city.includes(filters.city)) return false;
      if (filters.keyword && !text.includes(filters.keyword.toLowerCase())) return false;
      if (filters.direction && job.direction !== filters.direction) return false;
      if (blacklist.some((word) => job.company.includes(word) || job.title.includes(word))) return false;
      return true;
    });
  }, [jobs, filters]);

  async function refreshAll() {
    const [jobsRes, tasksRes, conversationsRes] = await Promise.all([
      fetch("/api/jobs").then((res) => res.json()),
      fetch("/api/tasks").then((res) => res.json()),
      fetch("/api/conversations").then((res) => res.json())
    ]);
    setJobs(jobsRes.jobs ?? []);
    setTasks(tasksRes.tasks ?? []);
    setConversations(conversationsRes.conversations ?? []);
  }

  async function loadDemo() {
    const demoJobs: Partial<JobCard>[] = [
      {
        id: "demo-ai-product",
        title: "AI产品经理实习生",
        company: "北京智启未来科技",
        city: "北京",
        salary: "150-220/天",
        hrName: "王女士",
        hrActiveText: "刚刚活跃",
        detailUrl: "https://www.zhipin.com/job_detail/demo-ai-product.html",
        jdText: "负责 AI 应用产品需求分析、PRD 撰写、竞品分析，熟悉大模型、RAG、Agent 工作流优先，具备数据分析和跨团队沟通能力。",
        collectedAt: new Date().toISOString()
      },
      {
        id: "demo-data",
        title: "数据分析实习生",
        company: "上海数策增长科技",
        city: "上海",
        salary: "180-250/天",
        hrName: "李经理",
        hrActiveText: "今日活跃",
        detailUrl: "https://www.zhipin.com/job_detail/demo-data.html",
        jdText: "使用 SQL、Excel、Python 完成业务数据分析，搭建 BI 看板，分析转化率、留存、GMV，输出经营分析报告。",
        collectedAt: new Date().toISOString()
      },
      {
        id: "demo-erp",
        title: "SaaS实施顾问实习生",
        company: "云企信息技术",
        city: "北京",
        salary: "120-180/天",
        hrName: "赵先生",
        hrActiveText: "3小时内活跃",
        detailUrl: "https://www.zhipin.com/job_detail/demo-erp.html",
        jdText: "参与企业客户 SaaS/ERP 项目实施，完成需求调研、流程梳理、系统配置、测试培训和项目文档。",
        collectedAt: new Date().toISOString()
      }
    ];
    await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobs: demoJobs })
    });
    setNotice("已加载示例岗位，可生成打招呼任务并测试简历生成。");
    await refreshAll();
  }

  async function createTasks() {
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobIds: selectedJobIds })
    });
    setNotice(`已为 ${selectedJobIds.length} 个岗位生成打招呼草稿，发送前仍需审批。`);
    setSelectedJobIds([]);
    await refreshAll();
  }

  async function approveSelectedTasks() {
    await fetch("/api/tasks/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds: selectedTaskIds })
    });
    setNotice(`已审批 ${selectedTaskIds.length} 条任务。请在 BOSS 页面用插件执行已审批任务。`);
    setSelectedTaskIds([]);
    await refreshAll();
  }

  async function analyzeAndGenerate(job?: JobCard) {
    const sourceText = job?.jdText || jdText;
    const targetJob = job?.title || "目标岗位";
    if (!sourceText.trim()) {
      setNotice("请先粘贴 JD，或从岗位池选择一个岗位生成简历。");
      return;
    }
    const parsed = await fetch("/api/analyze-jd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jdText: sourceText })
    }).then((res) => res.json());
    setParsedJD(parsed.parsed);
    const generated = await fetch("/api/generate-resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parsedJD: parsed.parsed, targetJob })
    }).then((res) => res.json());
    setResume(generated.resume);
    setNotice("已生成岗位版简历。请检查风险项后再使用。");
  }

  async function downloadDocx() {
    if (!resume) return;
    const res = await fetch("/api/export-docx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: resume.resumeMarkdown })
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "resume.docx";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">B</span>
          <span>BOSS 求职助手</span>
        </div>
        <nav className="nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <div className={`nav-item ${item.active ? "active" : ""}`} key={item.label}>
                <Icon size={17} />
                <span>{item.label}</span>
              </div>
            );
          })}
        </nav>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>审批后自动发送工作台</h1>
            <div className="subtle">采集岗位、筛选任务、审批发送、识别要简历线索</div>
          </div>
          <div className="status">
            <span className="dot" />
            Chrome 插件本地连接
          </div>
        </header>

        <section className="workspace">
          <div className="stack">
            <div className="alert">
              <AlertTriangle size={16} /> {notice}
            </div>

            <section className="panel">
              <div className="panel-header">
                <h2 className="panel-title">岗位池</h2>
                <div className="button-row">
                  <button className="btn secondary" onClick={refreshAll}>
                    <RefreshCw size={15} /> 刷新
                  </button>
                  <button className="btn secondary" onClick={loadDemo}>
                    <Sparkles size={15} /> 示例数据
                  </button>
                  <button className="btn primary" disabled={!selectedJobIds.length} onClick={createTasks}>
                    <Send size={15} /> 生成打招呼草稿
                  </button>
                </div>
              </div>
              <div className="panel-body">
                <div className="filters">
                  <div className="field">
                    <label>城市</label>
                    <input className="input" value={filters.city} onChange={(event) => setFilters({ ...filters, city: event.target.value })} placeholder="北京/上海" />
                  </div>
                  <div className="field">
                    <label>岗位方向</label>
                    <select className="select" value={filters.direction} onChange={(event) => setFilters({ ...filters, direction: event.target.value })}>
                      <option value="">全部</option>
                      <option value="数据分析">数据分析</option>
                      <option value="AI产品">AI产品</option>
                      <option value="产品运营">产品运营</option>
                      <option value="实施顾问">实施顾问</option>
                      <option value="AI Agent">AI Agent</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>关键词</label>
                    <input className="input" value={filters.keyword} onChange={(event) => setFilters({ ...filters, keyword: event.target.value })} placeholder="SQL / RAG / 实习" />
                  </div>
                  <div className="field">
                    <label>黑名单</label>
                    <input className="input" value={filters.blacklist} onChange={(event) => setFilters({ ...filters, blacklist: event.target.value })} placeholder="培训,销售" />
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>选择</th>
                        <th>岗位</th>
                        <th>公司/城市</th>
                        <th>方向</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredJobs.map((job) => (
                        <tr key={job.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedJobIds.includes(job.id)}
                              onChange={(event) => {
                                setSelectedJobIds((ids) => (event.target.checked ? [...ids, job.id] : ids.filter((id) => id !== job.id)));
                              }}
                            />
                          </td>
                          <td>
                            <strong>{job.title}</strong>
                            <div className="subtle">{job.salary || "薪资未采集"} · {job.hrName || "HR未知"}</div>
                          </td>
                          <td>
                            {job.company}
                            <div className="subtle">{job.city}</div>
                          </td>
                          <td>
                            <span className="badge teal">{job.direction}</span>
                          </td>
                          <td>
                            <button className="btn secondary" onClick={() => analyzeAndGenerate(job)}>
                              <FileText size={15} /> 简历
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!filteredJobs.length && (
                        <tr>
                          <td colSpan={5} className="subtle">暂无岗位。请用插件采集，或加载示例数据。</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h2 className="panel-title">JD 粘贴解析</h2>
                <button className="btn primary" onClick={() => analyzeAndGenerate()}>
                  <Sparkles size={15} /> 生成简历
                </button>
              </div>
              <div className="panel-body">
                <textarea className="textarea" value={jdText} onChange={(event) => setJdText(event.target.value)} placeholder="粘贴 BOSS 岗位详情文本，或使用插件自动采集。" />
              </div>
            </section>
          </div>

          <div className="stack">
            <section className="panel">
              <div className="panel-header">
                <h2 className="panel-title">打招呼队列</h2>
                <button className="btn warning" disabled={!selectedTaskIds.length} onClick={approveSelectedTasks}>
                  <CheckCircle2 size={15} /> 审批选中
                </button>
              </div>
              <div className="panel-body">
                {tasks.slice(0, 8).map((task) => (
                  <div className="queue-item" key={task.id}>
                    <label>
                      <input
                        type="checkbox"
                        disabled={task.status !== "draft"}
                        checked={selectedTaskIds.includes(task.id)}
                        onChange={(event) => {
                          setSelectedTaskIds((ids) => (event.target.checked ? [...ids, task.id] : ids.filter((id) => id !== task.id)));
                        }}
                      />{" "}
                      <strong>{task.jobTitle}</strong> · {task.company}
                    </label>
                    <span className={`badge ${task.status === "approved" ? "amber" : task.status === "sent" ? "teal" : ""}`}>{task.status}</span>
                    <div className="mono-box">{task.messageDraft}</div>
                  </div>
                ))}
                {!tasks.length && <div className="subtle">选择岗位后生成打招呼草稿。</div>}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h2 className="panel-title">消息线索</h2>
                <span className="badge amber">{conversations.filter((item) => item.resumeRequested).length} 个要简历</span>
              </div>
              <div className="panel-body">
                {conversations.slice(0, 5).map((lead) => (
                  <div className="queue-item" key={lead.id}>
                    <strong>{lead.company || "未知公司"} · {lead.jobTitle || "未知岗位"}</strong>
                    <span className={`badge ${lead.resumeRequested ? "amber" : ""}`}>{lead.resumeRequested ? "疑似要简历" : "普通消息"}</span>
                    <div className="subtle">{lead.lastMessages.slice(-2).join(" / ")}</div>
                  </div>
                ))}
                {!conversations.length && <div className="subtle">在 BOSS 消息页用插件采集会话线索。</div>}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h2 className="panel-title">岗位版简历</h2>
                <div className="button-row">
                  <button className="btn secondary" disabled={!resume} onClick={() => resume && navigator.clipboard.writeText(resume.resumeMarkdown)}>
                    复制 Markdown
                  </button>
                  <button className="btn primary" disabled={!resume} onClick={downloadDocx}>
                    下载 DOCX
                  </button>
                </div>
              </div>
              <div className="panel-body">
                {parsedJD && (
                  <div className="button-row" style={{ marginBottom: 12 }}>
                    {parsedJD.keywords.slice(0, 8).map((keyword) => (
                      <span className="badge teal" key={keyword}>{keyword}</span>
                    ))}
                  </div>
                )}
                {resume ? (
                  <>
                    <div className="subtle">匹配分：{resume.matchScore}/100</div>
                    <div className="mono-box">{resume.resumeMarkdown}</div>
                    {!!resume.risks.length && (
                      <div className="alert" style={{ marginTop: 12 }}>
                        {resume.risks.join(" ")}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="subtle">从岗位池选择岗位，或粘贴 JD 后生成。</div>
                )}
              </div>
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}
