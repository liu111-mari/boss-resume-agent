import React from "react";
import type { FilterConfig } from "@boss-agent/shared";

import { Panel, FieldHint } from "@/components/ui";
import type { GreetingPipelineRunCounts } from "@/lib/greeting-pipeline";

type FilterSettingsProps = {
  config: FilterConfig;
  isSaving: boolean;
  isRunning: boolean;
  lastRunCounts: GreetingPipelineRunCounts | null;
  onChange: (next: FilterConfig) => void;
  onSave: () => void;
  onRun: () => void;
};

const employmentTypeLabelMap: Record<string, string> = {
  internship: "internship",
  campus: "campus",
  social: "social"
};

export default function FilterSettings({
  config,
  isSaving,
  isRunning,
  lastRunCounts,
  onChange,
  onSave,
  onRun
}: FilterSettingsProps) {
  return (
    <Panel
      id="filter-settings"
      title="筛选设置"
      description="编辑真实筛选条件并直接触发流水线，不在前端做本地假筛选。"
      actions={
        <div className="panel-actions-row">
          <button className="button button-secondary" disabled={isSaving || isRunning} onClick={onSave} type="button">
            保存设置
          </button>
          <button className="button button-primary" disabled={isSaving || isRunning} onClick={onRun} type="button">
            运行筛选与生成
          </button>
        </div>
      }
    >
      <div className="form-grid">
        <label className="field">
          <span>目标职位</span>
          <textarea
            aria-label="目标职位"
            className="textarea"
            name="targetTitles"
            onChange={(event) => updateArrayField("targetTitles", event.target.value, config, onChange)}
            value={formatArray(config.targetTitles)}
          />
        </label>

        <label className="field">
          <span>城市</span>
          <textarea
            aria-label="城市"
            className="textarea"
            name="cities"
            onChange={(event) => updateArrayField("cities", event.target.value, config, onChange)}
            value={formatArray(config.cities)}
          />
        </label>

        <label className="field">
          <span>薪资单位</span>
          <select
            aria-label="薪资单位"
            className="input"
            name="salaryUnit"
            onChange={(event) => onChange({ ...config, salaryUnit: event.target.value as FilterConfig["salaryUnit"] })}
            value={config.salaryUnit}
          >
            <option value="day">day</option>
            <option value="month">month</option>
          </select>
        </label>

        <div className="field field-inline-split">
          <span>薪资范围</span>
          <div className="inline-grid">
            <label className="field">
              <span className="sr-only">最低薪资</span>
              <input
                aria-label="最低薪资"
                className="input"
                inputMode="numeric"
                name="minSalary"
                onChange={(event) => updateNullableNumberField("minSalary", event.target.value, config, onChange)}
                type="number"
                value={config.minSalary ?? ""}
              />
            </label>
            <label className="field">
              <span className="sr-only">最高薪资</span>
              <input
                aria-label="最高薪资"
                className="input"
                inputMode="numeric"
                name="maxSalary"
                onChange={(event) => updateNullableNumberField("maxSalary", event.target.value, config, onChange)}
                type="number"
                value={config.maxSalary ?? ""}
              />
            </label>
          </div>
        </div>

        <label className="field">
          <span>就业类型</span>
          <textarea
            aria-label="就业类型"
            className="textarea"
            name="employmentTypes"
            onChange={(event) => updateEmploymentTypes(event.target.value, config, onChange)}
            value={formatArray(config.employmentTypes.map((item) => employmentTypeLabelMap[item] ?? item))}
          />
          <FieldHint>可填 internship、campus、social，逗号或换行分隔。</FieldHint>
        </label>

        <label className="field">
          <span>必需关键词</span>
          <textarea
            aria-label="必需关键词"
            className="textarea"
            name="requiredKeywords"
            onChange={(event) => updateArrayField("requiredKeywords", event.target.value, config, onChange)}
            value={formatArray(config.requiredKeywords)}
          />
        </label>

        <label className="field">
          <span>排除关键词</span>
          <textarea
            aria-label="排除关键词"
            className="textarea"
            name="excludedKeywords"
            onChange={(event) => updateArrayField("excludedKeywords", event.target.value, config, onChange)}
            value={formatArray(config.excludedKeywords)}
          />
        </label>

        <label className="field">
          <span>屏蔽公司</span>
          <textarea
            aria-label="屏蔽公司"
            className="textarea"
            name="blockedCompanies"
            onChange={(event) => updateArrayField("blockedCompanies", event.target.value, config, onChange)}
            value={formatArray(config.blockedCompanies)}
          />
        </label>

        <label className="field">
          <span>屏蔽行业</span>
          <textarea
            aria-label="屏蔽行业"
            className="textarea"
            name="blockedIndustries"
            onChange={(event) => updateArrayField("blockedIndustries", event.target.value, config, onChange)}
            value={formatArray(config.blockedIndustries)}
          />
        </label>

        <label className="field">
          <span>经验要求</span>
          <textarea
            aria-label="经验要求"
            className="textarea"
            name="allowedExperience"
            onChange={(event) => updateArrayField("allowedExperience", event.target.value, config, onChange)}
            value={formatArray(config.allowedExperience)}
          />
        </label>

        <label className="field">
          <span>学历要求</span>
          <textarea
            aria-label="学历要求"
            className="textarea"
            name="allowedEducation"
            onChange={(event) => updateArrayField("allowedEducation", event.target.value, config, onChange)}
            value={formatArray(config.allowedEducation)}
          />
        </label>

        <label className="field">
          <span>分数阈值</span>
          <input
            aria-label="分数阈值"
            className="input"
            max={100}
            min={0}
            name="scoreThreshold"
            onChange={(event) => updateNumberField("scoreThreshold", event.target.value, config, onChange)}
            type="number"
            value={config.scoreThreshold}
          />
        </label>

        <label className="field">
          <span>每日打招呼上限</span>
          <input
            aria-label="每日打招呼上限"
            className="input"
            max={150}
            min={1}
            name="dailyLimit"
            onChange={(event) => updateNumberField("dailyLimit", event.target.value, config, onChange)}
            type="number"
            value={config.dailyLimit}
          />
        </label>
      </div>

      {lastRunCounts ? (
        <div className="inline-stats" aria-live="polite">
          <span>处理 {lastRunCounts.processed}</span>
          <span>硬筛拒绝 {lastRunCounts.hardRejected}</span>
          <span>评分拒绝 {lastRunCounts.scoreRejected}</span>
          <span>待审 {lastRunCounts.pendingReview}</span>
          <span>失败 {lastRunCounts.failed}</span>
          <span>成本 {lastRunCounts.estimatedCostCny}</span>
        </div>
      ) : null}
    </Panel>
  );
}

function updateArrayField<K extends keyof Pick<
  FilterConfig,
  | "targetTitles"
  | "cities"
  | "requiredKeywords"
  | "excludedKeywords"
  | "blockedCompanies"
  | "blockedIndustries"
  | "allowedExperience"
  | "allowedEducation"
>>(key: K, value: string, config: FilterConfig, onChange: (next: FilterConfig) => void) {
  onChange({
    ...config,
    [key]: parseArrayInput(value)
  });
}

function updateEmploymentTypes(value: string, config: FilterConfig, onChange: (next: FilterConfig) => void) {
  const normalized = parseArrayInput(value)
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is FilterConfig["employmentTypes"][number] =>
      item === "internship" || item === "campus" || item === "social"
    );

  onChange({
    ...config,
    employmentTypes: normalized
  });
}

function updateNullableNumberField<K extends "minSalary" | "maxSalary">(
  key: K,
  value: string,
  config: FilterConfig,
  onChange: (next: FilterConfig) => void
) {
  onChange({
    ...config,
    [key]: value.trim() === "" ? null : Number(value)
  });
}

function updateNumberField<K extends "scoreThreshold" | "dailyLimit">(
  key: K,
  value: string,
  config: FilterConfig,
  onChange: (next: FilterConfig) => void
) {
  onChange({
    ...config,
    [key]: Number(value)
  });
}

function parseArrayInput(value: string): string[] {
  return value
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatArray(items: string[]): string {
  return items.join("\n");
}
