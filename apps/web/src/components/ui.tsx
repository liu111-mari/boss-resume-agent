import React from "react";
import type { PropsWithChildren, ReactNode } from "react";

type PanelProps = PropsWithChildren<{
  id?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}>;

type MetricCardProps = {
  label: string;
  value: string | number;
  tone?: "default" | "teal" | "amber";
  helper?: string;
};

type StatusBadgeProps = {
  label: string;
  tone?: "default" | "teal" | "amber" | "danger";
};

export function Panel({ id, title, description, actions, children }: PanelProps) {
  return (
    <section className="panel" id={id}>
      <div className="panel-header">
        <div className="panel-heading">
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function MetricCard({ label, value, tone = "default", helper }: MetricCardProps) {
  return (
    <article className={`metric-card metric-card-${tone}`}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      {helper ? <span className="metric-helper">{helper}</span> : null}
    </article>
  );
}

export function StatusBadge({ label, tone = "default" }: StatusBadgeProps) {
  return <span className={`status-badge status-badge-${tone}`}>{label}</span>;
}

export function FieldHint({ children }: PropsWithChildren) {
  return <p className="field-hint">{children}</p>;
}

export function PageHeader({
  title,
  description,
  actions
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({
  title,
  description,
  action
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state-panel">
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}
