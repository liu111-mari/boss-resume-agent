"use client";

import React from "react";
import { createPortal } from "react-dom";
import type { JobCard } from "@boss-agent/shared";

import { findMatchedTerms, resolveJobDescription, resolveJobSalary } from "@/lib/job-display";

type JobQuickViewProps = {
  job: JobCard;
  positiveTerms?: string[];
  negativeTerms?: string[];
};

export default function JobQuickView({ job, positiveTerms = [], negativeTerms = [] }: JobQuickViewProps) {
  const [open, setOpen] = React.useState(false);
  const tooltipId = React.useId();
  const salary = resolveJobSalary(job);
  const description = resolveJobDescription(job);
  const displayDescription = description || "打开 BOSS 详情后可自动补全完整 JD";
  const positiveMatches = findMatchedTerms(description, positiveTerms);
  const negativeMatches = findMatchedTerms(description, negativeTerms);

  React.useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <div className="job-quick-view">
      <div className="job-quick-heading">
        <button aria-describedby={tooltipId} className="job-quick-open" onClick={() => setOpen(true)} type="button">
          <span className="job-quick-title-row">
            <strong>{job.title}</strong>
            <span className={`salary-badge${salary ? "" : " salary-badge-missing"}`}>{salary || "薪资待补全"}</span>
          </span>
          <span className="job-quick-company">{job.company} · {job.city || "城市未记录"}</span>
          <span className={`job-jd-excerpt${description ? "" : " job-jd-missing"}`}>{displayDescription}</span>
        </button>
        {job.detailUrl ? <a className="table-link job-external-link" href={job.detailUrl} rel="noreferrer" target="_blank">BOSS详情</a> : null}
      </div>

      {positiveMatches.length || negativeMatches.length ? (
        <div className="job-keyword-row">
          {positiveMatches.map((term) => <span className="keyword-chip keyword-chip-positive" key={`positive-${term}`}>命中：{term}</span>)}
          {negativeMatches.map((term) => <span className="keyword-chip keyword-chip-negative" key={`negative-${term}`}>排除词：{term}</span>)}
        </div>
      ) : null}

      <div className="job-hover-preview" id={tooltipId} role="tooltip">
        <strong>{job.jdSource === "detail" ? "完整 JD" : "列表摘要"}</strong>
        <p>{displayDescription}</p>
        <span>点击岗位可固定查看完整信息</span>
      </div>

      {open && typeof document !== "undefined" ? createPortal(
        <div className="job-detail-overlay" onMouseDown={() => setOpen(false)}>
          <aside aria-label={`${job.title}完整信息`} aria-modal="true" className="job-detail-drawer" onMouseDown={(event) => event.stopPropagation()} role="dialog">
            <div className="job-detail-drawer-header">
              <div><strong>{job.title}</strong><p>{job.company} · {job.city || "城市未记录"}</p></div>
              <button aria-label="关闭岗位详情" className="button button-ghost" onClick={() => setOpen(false)} type="button">关闭</button>
            </div>
            <div className="job-detail-meta">
              <span className={`salary-badge${salary ? "" : " salary-badge-missing"}`}>{salary || "薪资待补全"}</span>
              <span>{[job.experience, job.education, job.industry].filter(Boolean).join(" · ") || "其他信息待补全"}</span>
            </div>
            <section className="job-detail-copy"><h3>{job.jdSource === "detail" ? "完整 JD" : "岗位摘要"}</h3><p>{displayDescription}</p></section>
            <div className="panel-actions-row">{job.detailUrl ? <a className="button button-primary" href={job.detailUrl} rel="noreferrer" target="_blank">打开 BOSS 详情</a> : null}</div>
          </aside>
        </div>,
        document.body
      ) : null}
      <span className="sr-only">查看完整JD</span>
    </div>
  );
}
