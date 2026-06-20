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

export function SectionAnchorNav({
  items,
  className = ""
}: {
  items: Array<{ href: string; label: string }>;
  className?: string;
}) {
  return (
    <nav aria-label="工作台导航" className={className}>
      {items.map((item) => (
        <a className="anchor-link" href={item.href} key={item.href}>
          {item.label}
        </a>
      ))}
    </nav>
  );
}
