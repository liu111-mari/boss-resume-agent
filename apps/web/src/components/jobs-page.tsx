"use client";

import React from "react";
import { useEffect, useMemo, useState } from "react";
import type { JobCard } from "@boss-agent/shared";

import PageFeedback from "@/components/page-feedback";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { loadJobsPageData } from "@/lib/client-api";

export default function JobsPage({ initialJobs }: { initialJobs?: JobCard[] }) {
  const [jobs, setJobs] = useState(initialJobs ?? []);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialJobs) return;
    void loadJobsPageData().then(setJobs).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "岗位加载失败");
    });
  }, [initialJobs]);

  const visibleJobs = useMemo(() => filterJobs(jobs, query), [jobs, query]);

  return (
    <>
      <PageHeader description="查看插件采集的真实岗位数据。" title="岗位库" />
      <PageFeedback error={error} status="" />
      <Panel title={`岗位列表（${visibleJobs.length}）`}>
        {!jobs.length ? (
          <EmptyState description="请先在 BOSS 搜索结果页打开插件并点击采集岗位。" title="还没有采集岗位" />
        ) : (
          <>
            <label className="field job-search">
              <span>搜索岗位、公司或城市</span>
              <input
                aria-label="搜索岗位、公司或城市"
                className="input"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="例如：数据分析、数策科技、上海"
                type="search"
                value={query}
              />
            </label>
            <div className="table-shell">
              <table className="data-table job-table">
                <thead><tr><th>岗位</th><th>城市</th><th>薪资</th><th>经验 / 学历</th><th>方向 / 行业</th><th>采集时间</th><th>详情</th></tr></thead>
                <tbody>
                  {visibleJobs.map((job) => (
                    <tr key={job.id}>
                      <td><strong>{job.title}</strong><span>{job.company}</span></td>
                      <td>{job.city || "未记录"}</td>
                      <td>{job.salary || "未记录"}</td>
                      <td>{[job.experience, job.education].filter(Boolean).join(" / ") || "未记录"}</td>
                      <td>{[job.direction, job.industry].filter(Boolean).join(" / ") || "未记录"}</td>
                      <td>{formatDateTime(job.collectedAt)}</td>
                      <td>{job.detailUrl ? <a className="table-link" href={job.detailUrl} rel="noreferrer" target="_blank">打开岗位</a> : "无链接"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visibleJobs.length ? <p className="empty-state">没有匹配当前搜索的岗位。</p> : null}
            </div>
          </>
        )}
      </Panel>
    </>
  );
}

export function filterJobs(jobs: JobCard[], query: string): JobCard[] {
  const keyword = query.trim().toLocaleLowerCase("zh-CN");
  if (!keyword) return jobs;
  return jobs.filter((job) =>
    [job.title, job.company, job.city].join(" ").toLocaleLowerCase("zh-CN").includes(keyword)
  );
}

function formatDateTime(value: string) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}
