import type {
  FilterConfig,
  GreetingTask,
  GreetingTaskStatus,
  GreetingTemplate,
  JobCard,
  Profile
} from "@boss-agent/shared";

import type { DailyUsage, RunLogEntry } from "@/lib/domain-store";
import type { GreetingPipelineRunCounts } from "@/lib/greeting-pipeline";

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

type ApiErrorPayload = {
  error?: string;
  message?: string;
  issues?: Array<{ message?: string; path?: Array<string | number> }>;
};

export async function loadWorkbenchData(): Promise<WorkbenchData> {
  const [configResponse, profileResponse, templateResponse, jobsResponse, tasksResponse, runSummaryResponse] =
    await Promise.all([
      fetchJson<{ config: FilterConfig }>("/api/config"),
      fetchJson<{ profile: Profile }>("/api/profile"),
      fetchJson<{ template: GreetingTemplate }>("/api/greeting-template"),
      fetchJson<{ jobs: JobCard[] }>("/api/jobs"),
      fetchJson<{ tasks: GreetingTask[] }>("/api/tasks"),
      fetchJson<WorkbenchRunSummary>("/api/run-summary")
    ]);

  return {
    config: configResponse.config,
    profile: profileResponse.profile,
    template: templateResponse.template,
    jobs: jobsResponse.jobs,
    tasks: tasksResponse.tasks,
    runSummary: runSummaryResponse
  };
}

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
