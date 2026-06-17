import {
  conversationLeadSchema,
  greetingTaskSchema,
  inferDirection,
  isResumeRequested,
  jobCardSchema,
  type ConversationLead,
  type GreetingTask,
  type JobCard
} from "@boss-agent/shared";

type Store = {
  jobs: JobCard[];
  conversations: ConversationLead[];
  tasks: GreetingTask[];
};

const globalStore = globalThis as typeof globalThis & { __bossAgentStore?: Store };

export const store: Store =
  globalStore.__bossAgentStore ??
  (globalStore.__bossAgentStore = {
    jobs: [],
    conversations: [],
    tasks: []
  });

export function upsertJobs(input: unknown[]): JobCard[] {
  const parsed = input.map((item) => {
    const candidate = jobCardSchema.parse(item);
    const text = `${candidate.title} ${candidate.company} ${candidate.jdText}`;
    return { ...candidate, direction: inferDirection(text) };
  });

  for (const job of parsed) {
    const existingIndex = store.jobs.findIndex((item) => item.id === job.id || (item.detailUrl && item.detailUrl === job.detailUrl));
    if (existingIndex >= 0) {
      store.jobs[existingIndex] = { ...store.jobs[existingIndex], ...job };
    } else {
      store.jobs.unshift(job);
    }
  }

  return store.jobs;
}

export function upsertConversations(input: unknown[]): ConversationLead[] {
  const parsed = input.map((item) => {
    const candidate = conversationLeadSchema.parse(item);
    return { ...candidate, resumeRequested: candidate.resumeRequested || isResumeRequested(candidate.lastMessages) };
  });

  for (const lead of parsed) {
    const existingIndex = store.conversations.findIndex((item) => item.id === lead.id);
    if (existingIndex >= 0) {
      store.conversations[existingIndex] = { ...store.conversations[existingIndex], ...lead };
    } else {
      store.conversations.unshift(lead);
    }
  }

  return store.conversations;
}

export function createGreetingTasks(jobIds: string[]): GreetingTask[] {
  const created: GreetingTask[] = [];
  for (const jobId of jobIds) {
    const job = store.jobs.find((item) => item.id === jobId);
    if (!job) continue;
    const existing = store.tasks.find((task) => task.jobId === jobId && task.status !== "failed");
    if (existing) {
      created.push(existing);
      continue;
    }
    const task = greetingTaskSchema.parse({
      id: crypto.randomUUID(),
      jobId: job.id,
      jobTitle: job.title,
      company: job.company,
      detailUrl: job.detailUrl,
      messageDraft: `您好，我是信息管理与信息系统专业 2027 届本科生，关注到贵司「${job.title}」岗位，具备数据分析、AI 工具应用和产品/业务流程理解能力，希望进一步沟通实习机会。`,
      status: "draft",
      createdAt: new Date().toISOString()
    });
    store.tasks.unshift(task);
    created.push(task);
  }
  return created;
}

export function approveTasks(taskIds: string[]): GreetingTask[] {
  for (const task of store.tasks) {
    if (taskIds.includes(task.id) && task.status === "draft") {
      task.status = "approved";
    }
  }
  return store.tasks;
}

export function updateTaskStatus(taskId: string, status: GreetingTask["status"], failureReason = ""): GreetingTask | undefined {
  const task = store.tasks.find((item) => item.id === taskId);
  if (!task) return undefined;
  task.status = status;
  task.failureReason = failureReason;
  return task;
}

export function getApprovedTasks(): GreetingTask[] {
  return store.tasks.filter((task) => task.status === "approved");
}
