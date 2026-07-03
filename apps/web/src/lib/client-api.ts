import type {
  FilterConfig,
  GreetingTask,
  GreetingTaskStatus,
  GreetingTemplate,
  JobCard,
  PreferenceFeedback,
  PreferenceFocusField,
  PreferenceRule,
  PreferenceRuleCandidate,
  PreferenceSuggestionBatch,
  Profile
} from "@boss-agent/shared";

import type { DailyUsage, RunLogEntry } from "@/lib/domain-store";
import type { GreetingPipelineRunCounts } from "@/lib/greeting-pipeline";

export type CreateTasksFromJobsCounts = {
  processed: number;
  hardRejected: number;
  pendingReview: number;
  skipped: number;
  failed: number;
};

export type WorkbenchRunSummary = {
  date: string;
  config: FilterConfig;
  usage: DailyUsage;
  taskStatusCounts: Partial<Record<GreetingTaskStatus, number>> & Record<string, number>;
  recentLogs: RunLogEntry[];
};

export type WorkbenchData = {
  config: FilterConfig;
  profile: Profile;
  template: GreetingTemplate;
  jobs: JobCard[];
  tasks: GreetingTask[];
  runSummary: WorkbenchRunSummary;
};

export type WorkbenchOperationalData = {
  jobs: JobCard[];
  tasks: GreetingTask[];
  runSummary: WorkbenchRunSummary;
};

export type PreferenceStateData = {
  feedback: PreferenceFeedback[];
  rules: PreferenceRule[];
  ruleHistory: PreferenceRule[];
  suggestions: PreferenceSuggestionBatch[];
  newFeedbackCount: number;
};

export type JobFeedbackAction = "favorite" | "negative_remove" | "remove";

export type JobFeedbackResult = {
  feedback: PreferenceFeedback[];
  removedJobIds: string[];
  blockedJobIds: string[];
  canceledTaskIds: string[];
};

type ApiErrorPayload = {
  error?: string;
  message?: string;
  issues?: Array<{ message?: string; path?: Array<string | number> }>;
};

export async function loadOperationalData(): Promise<WorkbenchOperationalData> {
  const [jobsResponse, tasksResponse, runSummaryResponse] = await Promise.all([
    fetchJson<{ jobs: JobCard[] }>("/api/jobs"),
    fetchJson<{ tasks: GreetingTask[] }>("/api/tasks"),
    fetchJson<WorkbenchRunSummary>("/api/run-summary")
  ]);

  return {
    jobs: jobsResponse.jobs,
    tasks: tasksResponse.tasks,
    runSummary: runSummaryResponse
  };
}

export async function loadOverviewPageData(): Promise<WorkbenchOperationalData> {
  return loadOperationalData();
}

export async function loadJobsPageData(): Promise<JobCard[]> {
  return (await fetchJson<{ jobs: JobCard[] }>("/api/jobs")).jobs;
}

export async function loadFiltersPageData(): Promise<FilterConfig> {
  return (await fetchJson<{ config: FilterConfig }>("/api/config")).config;
}

export async function loadPreferenceState(): Promise<PreferenceStateData> {
  return fetchJson<PreferenceStateData>("/api/preferences");
}

export async function submitJobFeedback(input: {
  jobIds: string[];
  action: JobFeedbackAction;
  focusFields: PreferenceFocusField[];
  note: string;
}) {
  return fetchJson<JobFeedbackResult>("/api/preferences/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function undoJobFeedback(feedbackId: string) {
  return fetchJson<{ feedback: PreferenceFeedback; restoredJob: JobCard | null }>(
    "/api/preferences/feedback/undo",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feedbackId })
    }
  );
}

export async function generatePreferenceSuggestions(
  correction: string,
  previousBatchId?: string
) {
  return fetchJson<{ batch: PreferenceSuggestionBatch }>(
    "/api/preferences/suggestions/generate",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ correction, previousBatchId: previousBatchId ?? null })
    }
  );
}

export async function applyPreferenceSuggestions(
  batchId: string,
  candidates: PreferenceRuleCandidate[]
) {
  return fetchJson<{ rules: PreferenceRule[]; acceptedRuleIds: string[] }>(
    "/api/preferences/suggestions/apply",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ batchId, candidates })
    }
  );
}

export async function savePreferenceRules(rules: PreferenceRule[]) {
  return fetchJson<{ rules: PreferenceRule[] }>("/api/preferences/rules", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rules })
  });
}

export async function restorePreferenceRuleVersion(ruleId: string, version: number) {
  return fetchJson<{ rule: PreferenceRule }>("/api/preferences/rules/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ruleId, version })
  });
}

export async function previewPreferenceCandidate(candidate: PreferenceRuleCandidate) {
  return fetchJson<{
    willBeExcluded: JobCard[];
    willBeKept: JobCard[];
    unchanged: JobCard[];
  }>("/api/preferences/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ candidate })
  });
}

export async function loadProfilePageData(): Promise<Profile> {
  return (await fetchJson<{ profile: Profile }>("/api/profile")).profile;
}

export async function loadTemplatePageData(): Promise<{
  template: GreetingTemplate;
  tasks: GreetingTask[];
}> {
  const [templateResponse, tasksResponse] = await Promise.all([
    fetchJson<{ template: GreetingTemplate }>("/api/greeting-template"),
    fetchJson<{ tasks: GreetingTask[] }>("/api/tasks")
  ]);
  return { template: templateResponse.template, tasks: tasksResponse.tasks };
}

export async function loadApprovalsPageData(): Promise<{
  profile: Profile;
  tasks: GreetingTask[];
}> {
  const [profileResponse, tasksResponse] = await Promise.all([
    fetchJson<{ profile: Profile }>("/api/profile"),
    loadApprovalTasksPageData()
  ]);
  return { profile: profileResponse.profile, tasks: tasksResponse };
}

export async function loadApprovalTasksPageData(): Promise<GreetingTask[]> {
  return (await fetchJson<{ tasks: GreetingTask[] }>("/api/tasks")).tasks;
}

export async function loadRunsPageData(): Promise<WorkbenchRunSummary> {
  return fetchJson<WorkbenchRunSummary>("/api/run-summary");
}

export async function saveConfig(config: FilterConfig) {
  return fetchJson<{ config: FilterConfig }>("/api/config", {
    method: "PUT",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(config)
  });
}

export async function runPipeline(jobIds?: string[]) {
  return fetchJson<{ counts: GreetingPipelineRunCounts }>("/api/pipeline/run", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(jobIds?.length ? { jobIds } : {})
  });
}

export async function createTasksFromJobs(jobIds?: string[]) {
  return fetchJson<{ counts: CreateTasksFromJobsCounts }>("/api/tasks/create-from-jobs", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(jobIds?.length ? { jobIds } : {})
  });
}

export async function saveProfile(profile: Profile) {
  return fetchJson<{ profile: Profile }>("/api/profile", {
    method: "PUT",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(profile)
  });
}

export async function saveTemplate(template: GreetingTemplate) {
  return fetchJson<{ template: GreetingTemplate }>("/api/greeting-template", {
    method: "PUT",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(template)
  });
}

export async function updateTaskDraft(taskId: string, messageDraft: string, expectedUpdatedAt: string) {
  return fetchJson<{ task: GreetingTask }>("/api/tasks/draft", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ taskId, messageDraft, expectedUpdatedAt })
  });
}

export async function approveTasks(taskIds: string[]) {
  return fetchJson<{ tasks: GreetingTask[] }>("/api/tasks/approve", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ taskIds })
  });
}

export async function rejectTasks(taskIds: string[], reason?: string) {
  return fetchJson<{ tasks: GreetingTask[] }>("/api/tasks/reject", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(reason ? { taskIds, reason } : { taskIds })
  });
}

export async function loadSentJobs() {
  return fetchJson<{ jobs: Array<{ job: JobCard; taskId: string; sentAt: string }> }>(
    "/api/sent-jobs"
  );
}

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const rawText = await response.text();

  if (rawText.trim() === "") {
    throw new Error("响应为空");
  }

  let payload: T | ApiErrorPayload;
  try {
    payload = JSON.parse(rawText) as T | ApiErrorPayload;
  } catch {
    throw new Error(`服务返回非 JSON 响应（HTTP ${response.status}）`);
  }

  if (!response.ok) {
    throw new Error(buildApiErrorMessage(payload, response.status));
  }

  return payload as T;
}

function buildApiErrorMessage(payload: unknown, status: number): string {
  if (!payload || typeof payload !== "object") {
    return `请求失败（HTTP ${status}）`;
  }

  const body = payload as ApiErrorPayload;
  if (typeof body.message === "string" && body.message.length > 0) {
    return body.message;
  }

  if (Array.isArray(body.issues) && body.issues.length > 0) {
    const firstIssue = body.issues[0];
    if (typeof firstIssue?.message === "string" && firstIssue.message.length > 0) {
      return firstIssue.message;
    }
  }

  if (typeof body.error === "string" && body.error.length > 0) {
    return body.error;
  }

  return `请求失败（HTTP ${status}）`;
}
