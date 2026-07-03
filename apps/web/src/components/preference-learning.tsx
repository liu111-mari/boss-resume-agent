"use client";

import React from "react";

import type {
  PreferenceRule,
  PreferenceRuleCandidate
} from "@boss-agent/shared";
import PageFeedback from "@/components/page-feedback";
import { MetricCard, Panel, StatusBadge } from "@/components/ui";
import {
  applyPreferenceSuggestions,
  generatePreferenceSuggestions,
  loadPreferenceState,
  previewPreferenceCandidate,
  restorePreferenceRuleVersion,
  savePreferenceRules,
  type PreferenceStateData
} from "@/lib/client-api";

const EMPTY_STATE: PreferenceStateData = {
  feedback: [],
  rules: [],
  ruleHistory: [],
  suggestions: [],
  newFeedbackCount: 0
};

export default function PreferenceLearning({
  initialState
}: {
  initialState?: PreferenceStateData;
}) {
  const [state, setState] = React.useState(initialState ?? EMPTY_STATE);
  const [correction, setCorrection] = React.useState("");
  const [candidates, setCandidates] = React.useState<PreferenceRuleCandidate[]>(() =>
    latestDraft(initialState ?? EMPTY_STATE)?.candidates ?? []
  );
  const [selectedCandidateIds, setSelectedCandidateIds] = React.useState<string[]>(() =>
    candidates.map((candidate) => candidate.tempId)
  );
  const [previewText, setPreviewText] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [status, setStatus] = React.useState("");

  const draft = latestDraft(state);
  const positiveCount = state.feedback.filter((item) => item.active && item.label === "positive").length;
  const negativeCount = state.feedback.filter((item) => item.active && item.label === "negative").length;

  React.useEffect(() => {
    if (initialState) return;
    void loadPreferenceState()
      .then((loaded) => applyLoadedState(loaded, setState, setCandidates, setSelectedCandidateIds))
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "偏好数据加载失败");
      });
  }, [initialState]);

  async function refresh() {
    applyLoadedState(
      await loadPreferenceState(),
      setState,
      setCandidates,
      setSelectedCandidateIds
    );
  }

  async function handleGenerate(previousBatchId?: string) {
    setBusy(true);
    setError("");
    try {
      const response = await generatePreferenceSuggestions(correction, previousBatchId);
      await refresh();
      setStatus(`AI 已生成 ${response.batch.candidates.length} 条候选规则，尚未生效。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成建议失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    if (!draft) return;
    const selected = candidates.filter((candidate) => selectedCandidateIds.includes(candidate.tempId));
    if (selected.length === 0) {
      setError("请至少选择一条候选规则。");
      return;
    }
    setBusy(true);
    try {
      await applyPreferenceSuggestions(draft.id, selected);
      await refresh();
      setStatus(`已确认并应用 ${selected.length} 条规则。`);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "应用建议失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveRules() {
    setBusy(true);
    try {
      await savePreferenceRules(state.rules);
      await refresh();
      setStatus("当前规则已保存，新版本可在规则卡片中查看。");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "规则保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function handlePreview(candidate: PreferenceRuleCandidate) {
    try {
      const result = await previewPreferenceCandidate(candidate);
      setPreviewText((current) => ({
        ...current,
        [candidate.tempId]: `新增排除 ${result.willBeExcluded.length}，保留 ${result.willBeKept.length}，判断不变 ${result.unchanged.length}`
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "预览失败");
    }
  }

  function updateRule(ruleId: string, patch: Partial<PreferenceRule>) {
    setState((current) => ({
      ...current,
      rules: current.rules.map((rule) => rule.id === ruleId ? { ...rule, ...patch } : rule)
    }));
  }

  function updateCandidate(tempId: string, patch: Partial<PreferenceRuleCandidate>) {
    setCandidates((current) => current.map((candidate) =>
      candidate.tempId === tempId ? { ...candidate, ...patch } : candidate
    ));
  }

  function deleteRule(ruleId: string) {
    setState((current) => ({
      ...current,
      rules: current.rules.filter((rule) => rule.id !== ruleId)
    }));
  }

  function rejectCandidate(tempId: string) {
    setCandidates((current) => current.filter((candidate) => candidate.tempId !== tempId));
    setSelectedCandidateIds((current) => current.filter((id) => id !== tempId));
  }

  async function handleRestore(ruleId: string, version: number) {
    setBusy(true);
    try {
      await restorePreferenceRuleVersion(ruleId, version);
      await refresh();
      setStatus(`已恢复规则历史版本 v${version}。`);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "恢复规则失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      id="preference-learning"
      title="偏好学习"
      description="AI只提出候选规则；编辑并确认前不会改变正式筛选。"
      actions={<button className="button button-primary" disabled={busy || state.feedback.length === 0} onClick={() => void handleGenerate()} type="button">生成优化建议</button>}
    >
      <PageFeedback error={error} status={status} />
      <div className="metrics-grid preference-metrics">
        <MetricCard label="重点关注" value={positiveCount} />
        <MetricCard label="不喜欢" tone="amber" value={negativeCount} />
        <MetricCard label="待分析反馈" tone="teal" value={state.newFeedbackCount} helper={state.newFeedbackCount >= 5 ? `${state.newFeedbackCount} 条新反馈，可生成建议` : "可随时手动生成；5条后会提示"} />
      </div>

      <div className="preference-section">
        <div className="section-subheader">
          <div><strong>当前生效规则</strong><p className="field-hint">所有规则都可以编辑、禁用或恢复启用。</p></div>
          <button className="button button-secondary" disabled={busy} onClick={() => void handleSaveRules()} type="button">保存规则</button>
        </div>
        <div className="preference-rule-grid">
          {state.rules.map((rule) => (
            <article className="preference-card" key={rule.id}>
              <div className="status-inline"><StatusBadge label={`${rule.field} / ${rule.action}`} tone={rule.active ? "teal" : "default"} /><span>v{rule.version} · {rule.provenance}</span></div>
              <label className="field"><span>匹配值（每行一个）</span><textarea className="textarea" disabled={rule.locked} onChange={(event) => updateRule(rule.id, { values: parseLines(event.target.value) })} value={rule.values.join("\n")} /></label>
              <label className="field"><span>语义偏好</span><input className="input" disabled={rule.locked} onChange={(event) => updateRule(rule.id, { statement: event.target.value })} value={rule.statement} /></label>
              <div className="panel-actions-row preference-actions">
                <button className="button button-ghost" disabled={rule.locked} onClick={() => updateRule(rule.id, { active: !rule.active })} type="button">{rule.active ? "禁用" : "启用"}</button>
                <button className="button button-ghost" onClick={() => updateRule(rule.id, { locked: !rule.locked })} type="button">{rule.locked ? "解锁" : "锁定"}</button>
                <button className="button button-ghost" disabled={rule.locked} onClick={() => deleteRule(rule.id)} type="button">删除规则</button>
                {latestRuleHistory(state, rule.id) ? <button className="button button-secondary" disabled={busy} onClick={() => void handleRestore(rule.id, latestRuleHistory(state, rule.id)!.version)} type="button">恢复上一版本</button> : null}
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="preference-section">
        <div className="section-subheader"><div><strong>AI候选规则</strong><p className="field-hint">可以编辑后应用，也可以告诉AI哪里不符合预期。</p></div></div>
        <label className="field">
          <span>纠正意见</span>
          <textarea className="textarea" onChange={(event) => setCorrection(event.target.value)} placeholder="例如：不要排除所有运营，只排除纯销售导向的运营" value={correction} />
        </label>
        <div className="panel-actions-row preference-actions">
          <button className="button button-secondary" disabled={busy || !draft} onClick={() => void handleGenerate(draft?.id)} type="button">让 AI 重新生成</button>
          <button className="button button-primary" disabled={busy || !draft || selectedCandidateIds.length === 0} onClick={() => void handleApply()} type="button">应用选中建议</button>
        </div>
        <div className="preference-rule-grid">
          {candidates.map((candidate) => (
            <article className="preference-card" key={candidate.tempId}>
              <label className="checkbox-field"><input checked={selectedCandidateIds.includes(candidate.tempId)} onChange={(event) => setSelectedCandidateIds((current) => event.target.checked ? Array.from(new Set([...current, candidate.tempId])) : current.filter((id) => id !== candidate.tempId))} type="checkbox" />选择此建议</label>
              <div className="inline-grid">
                <label className="field"><span>动作</span><select className="input" onChange={(event) => updateCandidate(candidate.tempId, { action: event.target.value as PreferenceRuleCandidate["action"] })} value={candidate.action}><option value="include">保留</option><option value="exclude">排除</option><option value="prefer">偏好</option></select></label>
                <label className="field"><span>字段</span><select className="input" onChange={(event) => updateCandidate(candidate.tempId, { field: event.target.value as PreferenceRuleCandidate["field"] })} value={candidate.field}><option value="title">岗位名称</option><option value="industry">行业</option><option value="jd">JD</option><option value="semantic_preference">语义偏好</option></select></label>
              </div>
              <label className="field"><span>匹配值</span><textarea className="textarea" onChange={(event) => updateCandidate(candidate.tempId, { values: parseLines(event.target.value) })} value={candidate.values.join("\n")} /></label>
              <label className="field"><span>语义描述</span><input className="input" onChange={(event) => updateCandidate(candidate.tempId, { statement: event.target.value })} value={candidate.statement} /></label>
              <p className="field-hint">{candidate.rationale} · 置信度 {Math.round(candidate.confidence * 100)}%</p>
              <button className="button button-secondary" onClick={() => void handlePreview(candidate)} type="button">预览影响</button>
              <button className="button button-ghost" onClick={() => rejectCandidate(candidate.tempId)} type="button">拒绝此建议</button>
              {previewText[candidate.tempId] ? <p className="field-hint">{previewText[candidate.tempId]}</p> : null}
            </article>
          ))}
          {!candidates.length ? <p className="empty-state">还没有待确认的AI建议。</p> : null}
        </div>
      </div>
    </Panel>
  );
}

function latestDraft(state: PreferenceStateData) {
  return [...state.suggestions].reverse().find((batch) => batch.status === "draft");
}

function latestRuleHistory(state: PreferenceStateData, ruleId: string) {
  return state.ruleHistory
    .filter((rule) => rule.id === ruleId)
    .sort((left, right) => right.version - left.version)[0];
}

function applyLoadedState(
  loaded: PreferenceStateData,
  setState: React.Dispatch<React.SetStateAction<PreferenceStateData>>,
  setCandidates: React.Dispatch<React.SetStateAction<PreferenceRuleCandidate[]>>,
  setSelectedCandidateIds: React.Dispatch<React.SetStateAction<string[]>>
) {
  const next = latestDraft(loaded)?.candidates ?? [];
  setState(loaded);
  setCandidates(next);
  setSelectedCandidateIds(next.map((candidate) => candidate.tempId));
}

function parseLines(value: string): string[] {
  return value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
}
