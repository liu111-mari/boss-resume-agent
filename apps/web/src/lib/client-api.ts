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
  requested: number;
  processed: number;
  hardRejected: number;
  pendingReview: number;
  approved: number;
  skipped: number;
  skippedActive: number;
  notFound: number;
  failed: number;
};

export type CreateTasksFromJobsIssue = {
  jobId: string;
  reason: "active_task_exists" | "job_not_found" | "task_creation_failed";
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

export async function fetchJobsWorkbook(jobIds?: string[]): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch("/api/jobs/export", jobIds?.length
    ? {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobIds })
      }
    : { method: "GET" });

  if (!response.ok) {
    const rawText = await response.text();
    let payload: unknown = null;
    try {
      payload = JSON.parse(rawText);
    } catch {
      // Binary downloads can fail with an HTML proxy response.
    }
    throw new Error(buildApiErrorMessage(payload, response.status));
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) {
    throw new Error("岗位表导出失败：服务未返回 XLSX 文件");
  }

  return {
    blob: await response.blob(),
    filename: parseDownloadFilename(response.headers.get("content-disposition"))
  };
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
  config: FilterConfig;
  jobs: JobCard[];
  profile: Profile;
  tasks: GreetingTask[];
}> {
  const [configResponse, jobsResponse, profileResponse, tasksResponse] = await Promise.all([
    fetchJson<{ config: FilterConfig }>("/api/config"),
    fetchJson<{ jobs: JobCard[] }>("/api/jobs"),
    fetchJson<{ profile: Profile }>("/api/profile"),
    loadApprovalTasksPageData()
  ]);
  return {
    config: configResponse.config,
    jobs: jobsResponse.jobs,
    profile: profileResponse.profile,
    tasks: tasksResponse
  };
}

export async function loadApprovalOperationalData(): Promise<{
  jobs: JobCard[];
  tasks: GreetingTask[];
}> {
  const [jobs, tasks] = await Promise.all([loadJobsPageData(), loadApprovalTasksPageData()]);
  return { jobs, tasks };
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
  return fetchJson<{
    counts: CreateTasksFromJobsCounts;
    issues: CreateTasksFromJobsIssue[];
  }>("/api/tasks/create-from-jobs", {
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
    if (response.status === 404 && String(input).startsWith("/api/")) {
      throw new Error("本地服务路由不存在，请关闭并重新运行 start-workbench.bat");
    }
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

function parseDownloadFilename(contentDisposition: string | null): string {
  const utf8 = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8);
    } catch {
      // Fall through to the ASCII filename.
    }
  }
  return contentDisposition?.match(/filename="?([^";]+)"?/i)?.[1] ?? "岗位库.xlsx";
}
