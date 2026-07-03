import React from "react";
import type { FilterConfig } from "@boss-agent/shared";

import { Panel, FieldHint } from "@/components/ui";
import { createTasksFromJobs, runPipeline, saveConfig } from "@/lib/client-api";
import type { GreetingPipelineRunCounts } from "@/lib/greeting-pipeline";
import { parseNullableNumberDraft, parseRequiredNumberDraft } from "@/lib/workbench-helpers";

type FilterSettingsProps = {
  config: FilterConfig;
  lastRunCounts: GreetingPipelineRunCounts | null;
  onChange: (next: FilterConfig) => void;
  onSaved: (savedValue: FilterConfig) => void;
  onOperationalRefresh: () => Promise<void>;
  onRunCompleted?: (counts: GreetingPipelineRunCounts) => void;
  onStatus?: (message: string) => void;
  onError?: (message: string) => void;
};

const employmentTypeLabelMap: Record<string, string> = {
  internship: "internship",
  campus: "campus",
  social: "social"
};

export default function FilterSettings({
  config,
  lastRunCounts,
  onChange,
  onSaved,
  onOperationalRefresh,
  onRunCompleted,
  onStatus,
  onError
}: FilterSettingsProps) {
  const [isSaving, setIsSaving] = React.useState(false);
  const [isRunning, setIsRunning] = React.useState(false);
  const [isCreatingApproval, setIsCreatingApproval] = React.useState(false);
  const [minSalaryDraft, setMinSalaryDraft] = React.useState(formatNullableNumberDraft(config.minSalary));
  const [maxSalaryDraft, setMaxSalaryDraft] = React.useState(formatNullableNumberDraft(config.maxSalary));
  const [scoreThresholdDraft, setScoreThresholdDraft] = React.useState(String(config.scoreThreshold));
  const [dailyLimitDraft, setDailyLimitDraft] = React.useState(String(config.dailyLimit));

  const buildValidatedConfig = React.useCallback((): FilterConfig | null => {
    const parsedMinSalary = parseNullableNumberDraft(minSalaryDraft);
    if (!parsedMinSalary.ok) {
      onError?.(parsedMinSalary.message);
      return null;
    }

    const parsedMaxSalary = parseNullableNumberDraft(maxSalaryDraft);
    if (!parsedMaxSalary.ok) {
      onError?.(parsedMaxSalary.message);
      return null;
    }

    const parsedScoreThreshold = parseRequiredNumberDraft(scoreThresholdDraft);
    if (!parsedScoreThreshold.ok) {
      onError?.(parsedScoreThreshold.message);
      return null;
    }

    const parsedDailyLimit = parseRequiredNumberDraft(dailyLimitDraft);
    if (!parsedDailyLimit.ok) {
      onError?.(parsedDailyLimit.message);
      return null;
    }

    return {
      ...config,
      minSalary: parsedMinSalary.value,
      maxSalary: parsedMaxSalary.value,
      scoreThreshold: parsedScoreThreshold.value,
      dailyLimit: parsedDailyLimit.value
    };
  }, [config, dailyLimitDraft, maxSalaryDraft, minSalaryDraft, onError, scoreThresholdDraft]);

  const handleSave = React.useCallback(async () => {
    const nextConfig = buildValidatedConfig();
    if (!nextConfig) return;

    setIsSaving(true);
    try {
      const savedConfig = await saveConfig(nextConfig);
      onSaved(savedConfig.config);
      onStatus?.("筛选设置已保存。");
      onError?.("");
    } catch (error) {
      onError?.(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }, [buildValidatedConfig, onError, onSaved, onStatus]);

  const handleRun = React.useCallback(async () => {
    const nextConfig = buildValidatedConfig();
    if (!nextConfig) return;

    setIsRunning(true);
    try {
      const savedConfig = await saveConfig(nextConfig);
      onSaved(savedConfig.config);
      const response = await runPipeline();
      onRunCompleted?.(response.counts);
      onStatus?.("筛选与生成已执行。");
      onError?.("");
      await onOperationalRefresh();
    } catch (error) {
      onError?.(getErrorMessage(error));
    } finally {
      setIsRunning(false);
    }
  }, [buildValidatedConfig, onError, onOperationalRefresh, onRunCompleted, onSaved, onStatus]);

  const handleCreateApproval = React.useCallback(async () => {
    const nextConfig = buildValidatedConfig();
    if (!nextConfig) return;

    setIsCreatingApproval(true);
    try {
      const savedConfig = await saveConfig(nextConfig);
      onSaved(savedConfig.config);
      const response = await createTasksFromJobs();
      onStatus?.(
        `已从岗位创建审批任务。处理 ${response.counts.processed}，待审批 ${response.counts.pendingReview}，硬筛拒绝 ${response.counts.hardRejected}，跳过 ${response.counts.skipped}，失败 ${response.counts.failed}`
      );
      onError?.("");
      await onOperationalRefresh();
    } catch (error) {
      onError?.(getErrorMessage(error));
    } finally {
      setIsCreatingApproval(false);
    }
  }, [buildValidatedConfig, onError, onOperationalRefresh, onSaved, onStatus]);

  return (
    <Panel
      id="filter-settings"
      title="筛选设置"
      description="编辑真实筛选条件并直接触发流水线，不在前端做本地假筛选。"
      actions={
        <div className="panel-actions-row">
          <button className="button button-secondary" disabled={isSaving || isRunning || isCreatingApproval} onClick={handleSave} type="button">
            保存设置
          </button>
          <button className="button button-secondary" disabled={isSaving || isRunning || isCreatingApproval} onClick={handleCreateApproval} type="button">
            {isCreatingApproval ? "正在创建审批…" : "直接创建审批（本地模板）"}
          </button>
          <button className="button button-primary" disabled={isSaving || isRunning || isCreatingApproval} onClick={handleRun} type="button">
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
                onChange={(event) => setMinSalaryDraft(event.target.value)}
                type="number"
                value={minSalaryDraft}
              />
            </label>
            <label className="field">
              <span className="sr-only">最高薪资</span>
              <input
                aria-label="最高薪资"
                className="input"
                inputMode="numeric"
                name="maxSalary"
                onChange={(event) => setMaxSalaryDraft(event.target.value)}
                type="number"
                value={maxSalaryDraft}
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
            onChange={(event) => setScoreThresholdDraft(event.target.value)}
            type="number"
            value={scoreThresholdDraft}
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
            onChange={(event) => setDailyLimitDraft(event.target.value)}
            type="number"
            value={dailyLimitDraft}
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

function parseArrayInput(value: string): string[] {
  return value
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatArray(items: string[]): string {
  return items.join("\n");
}

function formatNullableNumberDraft(value: number | null): string {
  return value === null ? "" : String(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
