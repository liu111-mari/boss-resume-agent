import React from "react";
import type { GreetingTask, GreetingTemplate } from "@boss-agent/shared";

import { Panel, FieldHint, StatusBadge } from "@/components/ui";

type TemplateSettingsProps = {
  template: GreetingTemplate;
  tasks: GreetingTask[];
  isSaving: boolean;
  onChange: (next: GreetingTemplate) => void;
  onSave: () => void;
};

export default function TemplateSettings({
  template,
  tasks,
  isSaving,
  onChange,
  onSave
}: TemplateSettingsProps) {
  const inferredProvider = inferProvider(tasks);

  return (
    <Panel
      id="template-settings"
      title="话术设置"
      description="模板只管结构和约束，不持久化供应商 URL 或模型名这种运行时配置。"
      actions={
        <button className="button button-secondary" disabled={isSaving} onClick={onSave} type="button">
          保存话术设置
        </button>
      }
    >
      <div className="provider-note">
        <div>
          <strong>模型供应商配置</strong>
          <FieldHint>从环境变量加载；不会把 API Key、baseURL 或 model 写入模板数据。</FieldHint>
        </div>
        <StatusBadge
          label={inferredProvider ? `最近任务供应商：${inferredProvider}` : "最近任务尚未暴露供应商"}
          tone={inferredProvider ? "teal" : "default"}
        />
      </div>

      <label className="field">
        <span>模板正文</span>
        <textarea
          aria-label="模板正文"
          className="textarea textarea-lg"
          onChange={(event) => onChange({ ...template, body: event.target.value })}
          value={template.body}
        />
      </label>

      <div className="form-grid">
        <label className="field">
          <span>语气</span>
          <input
            aria-label="语气"
            className="input"
            onChange={(event) => onChange({ ...template, tone: event.target.value })}
            value={template.tone}
          />
        </label>

        <label className="field">
          <span>最短长度</span>
          <input
            aria-label="最短长度"
            className="input"
            min={1}
            onChange={(event) => onChange({ ...template, minLength: Number(event.target.value) })}
            type="number"
            value={template.minLength}
          />
        </label>

        <label className="field">
          <span>最长长度</span>
          <input
            aria-label="最长长度"
            className="input"
            min={20}
            onChange={(event) => onChange({ ...template, maxLength: Number(event.target.value) })}
            type="number"
            value={template.maxLength}
          />
        </label>

        <label className="field">
          <span>最多技能条数</span>
          <input
            aria-label="最多技能条数"
            className="input"
            min={0}
            onChange={(event) => onChange({ ...template, maxSkills: Number(event.target.value) })}
            type="number"
            value={template.maxSkills}
          />
        </label>

        <label className="field">
          <span>最多项目条数</span>
          <input
            aria-label="最多项目条数"
            className="input"
            min={0}
            onChange={(event) => onChange({ ...template, maxProjects: Number(event.target.value) })}
            type="number"
            value={template.maxProjects}
          />
        </label>

        <label className="field">
          <span>模板版本</span>
          <input
            aria-label="模板版本"
            className="input"
            min={1}
            onChange={(event) => onChange({ ...template, version: Number(event.target.value) })}
            type="number"
            value={template.version}
          />
        </label>
      </div>

      <label className="field">
        <span>禁用表达</span>
        <textarea
          aria-label="禁用表达"
          className="textarea"
          onChange={(event) => onChange({ ...template, bannedPhrases: parseArrayInput(event.target.value) })}
          value={template.bannedPhrases.join("\n")}
        />
      </label>
    </Panel>
  );
}

function inferProvider(tasks: GreetingTask[]): string {
  const task = tasks.find(
    (item) =>
      item.modelProvider.trim().length > 0 ||
      item.scoringProvider.trim().length > 0 ||
      item.refinementProvider.trim().length > 0
  );

  if (!task) {
    return "";
  }

  return task.modelProvider || task.scoringProvider || task.refinementProvider;
}

function parseArrayInput(value: string): string[] {
  return value
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
