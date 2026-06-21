import { z } from "zod";

export const jobDirectionSchema = z.enum([
  "数据分析",
  "AI产品",
  "产品运营",
  "实施顾问",
  "AI Agent",
  "其他"
]);

export const jobCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  city: z.string(),
  salary: z.string().optional().default(""),
  hrName: z.string().optional().default(""),
  hrActiveText: z.string().optional().default(""),
  detailUrl: z.string().optional().default(""),
  sourcePage: z.string().optional().default("boss"),
  jdText: z.string().optional().default(""),
  experience: z.string().default(""),
  education: z.string().default(""),
  industry: z.string().default(""),
  rawText: z.string().default(""),
  direction: jobDirectionSchema.optional().default("其他"),
  collectedAt: z.string()
});

export const filterConfigSchema = z
  .object({
    targetTitles: z.array(z.string()).default([]),
    cities: z.array(z.string()).default([]),
    salaryUnit: z.enum(["day", "month"]).default("day"),
    minSalary: z.number().nonnegative().nullable().default(null),
    maxSalary: z.number().nonnegative().nullable().default(null),
    employmentTypes: z.array(z.enum(["internship", "campus", "social"])).default([]),
    requiredKeywords: z.array(z.string()).default([]),
    excludedKeywords: z.array(z.string()).default([]),
    blockedCompanies: z.array(z.string()).default([]),
    blockedIndustries: z.array(z.string()).default([]),
    allowedExperience: z.array(z.string()).default([]),
    allowedEducation: z.array(z.string()).default([]),
    scoreThreshold: z.number().min(0).max(100).default(70),
    dailyLimit: z.number().int().min(1).max(150).default(100)
  })
  .superRefine((config, context) => {
    if (
      config.minSalary !== null &&
      config.maxSalary !== null &&
      config.minSalary > config.maxSalary
    ) {
      context.addIssue({
        code: "custom",
        message: "maxSalary must be greater than or equal to minSalary",
        path: ["maxSalary"]
      });
    }
  });

export const profileItemSchema = z.object({
  id: z.string(),
  category: z.enum(["skill", "project", "intro", "other"]),
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  enabled: z.boolean().default(true)
});

export const profileSchema = z.object({
  school: z.string().default(""),
  major: z.string().default(""),
  graduation: z.string().default(""),
  direction: z.string().default(""),
  items: z.array(profileItemSchema).default([])
});

export const greetingTemplateSchema = z
  .object({
    body: z.string().min(1),
    tone: z.string().default("自然"),
    minLength: z.number().int().min(1).default(30),
    maxLength: z.number().int().min(20).max(500).default(120),
    maxSkills: z.number().int().min(0).max(10).default(2),
    maxProjects: z.number().int().min(0).max(5).default(1),
    bannedPhrases: z.array(z.string()).default([]),
    version: z.number().int().positive().default(1)
  })
  .superRefine((template, context) => {
    if (template.minLength > template.maxLength) {
      context.addIssue({
        code: "custom",
        message: "maxLength must be greater than or equal to minLength",
        path: ["maxLength"]
      });
    }
  });

export const greetingTaskStatusSchema = z.enum([
  "collected",
  "filtered",
  "scored",
  "generated",
  "pending_review",
  "approved",
  "sending",
  "sent",
  "rejected",
  "failed",
  "paused",
  "quota_blocked"
]);

export const parsedJDSchema = z.object({
  responsibilities: z.array(z.string()).default([]),
  hardSkills: z.array(z.string()).default([]),
  softSkills: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  bonusItems: z.array(z.string()).default([]),
  educationPreference: z.string().default("未明确"),
  summary: z.string().default("")
});

export const conversationLeadSchema = z.object({
  id: z.string(),
  company: z.string(),
  jobTitle: z.string(),
  hrName: z.string(),
  lastMessages: z.array(z.string()),
  resumeRequested: z.boolean(),
  jobDetailUrl: z.string().optional().default(""),
  status: z.enum(["new", "resume_generated", "ignored"]).default("new"),
  collectedAt: z.string()
});

export const greetingTaskSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  jobTitle: z.string(),
  company: z.string(),
  detailUrl: z.string().optional().default(""),
  messageDraft: z.string(),
  status: greetingTaskStatusSchema.default("collected"),
  score: z.number().min(0).max(100).optional(),
  matchReasons: z.array(z.string()).default([]),
  matchedRequirements: z.array(z.string()).default([]),
  missingRequirements: z.array(z.string()).default([]),
  usedProfileItemIds: z.array(z.string()).default([]),
  modelProvider: z.string().default("local"),
  modelName: z.string().default("template"),
  scoringProvider: z.string().default(""),
  scoringModel: z.string().default(""),
  refinementProvider: z.string().default(""),
  refinementModel: z.string().default(""),
  refinementFallback: z.boolean().default(false),
  templateVersion: z.number().int().positive().default(1),
  estimatedCostCny: z.number().nonnegative().default(0),
  failureReason: z.string().optional().default(""),
  confirmationEvidence: z.string().optional(),
  sentAt: z.string().optional(),
  quotaReservationDate: z.string().optional(),
  sendLeaseExpiresAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const profileAssetSchema = z.object({
  id: z.string(),
  type: z.enum(["education", "skill", "project", "internship", "certificate"]),
  title: z.string(),
  content: z.string(),
  skillTags: z.array(z.string()).default([]),
  directionTags: z.array(jobDirectionSchema).default([]),
  evidenceLevel: z.enum(["verified", "needs_confirmation", "do_not_claim"]).default("verified")
});

export const resumeVersionSchema = z.object({
  targetJob: z.string(),
  resumeMarkdown: z.string(),
  matchScore: z.number().min(0).max(100),
  risks: z.array(z.string()).default([]),
  interviewQuestions: z.array(z.string()).default([])
});

export type JobDirection = z.infer<typeof jobDirectionSchema>;
export type JobCard = z.infer<typeof jobCardSchema>;
export type FilterConfig = z.infer<typeof filterConfigSchema>;
export type ProfileItem = z.infer<typeof profileItemSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type GreetingTemplate = z.infer<typeof greetingTemplateSchema>;
export type GreetingTaskStatus = z.infer<typeof greetingTaskStatusSchema>;
export type ParsedJD = z.infer<typeof parsedJDSchema>;
export type ConversationLead = z.infer<typeof conversationLeadSchema>;
export type GreetingTask = z.infer<typeof greetingTaskSchema>;
export type ProfileAsset = z.infer<typeof profileAssetSchema>;
export type ResumeVersion = z.infer<typeof resumeVersionSchema>;

export const resumeRequestPatterns = [
  "发简历",
  "简历发",
  "投递简历",
  "方便发简历",
  "可以发一下简历",
  "把简历发",
  "请发简历",
  "发送简历"
];

export function cleanJDText(input: string): string {
  return input
    .replace(/\s+/g, " ")
    .replace(/(举报|反馈|分享|收藏|立即沟通|感兴趣|不感兴趣)/g, "")
    .trim()
    .slice(0, 6000);
}

export function inferDirection(text: string): JobDirection {
  const source = text.toLowerCase();
  if (/数据|bi|sql|经营分析|商业分析/.test(source)) return "数据分析";
  if (/agent|智能体|rag|大模型应用|工作流/.test(source)) return "AI Agent";
  if (/ai产品|产品经理|数据产品|b端产品/.test(source)) return "AI产品";
  if (/运营|增长|用户/.test(source)) return "产品运营";
  if (/实施|erp|saas|数字化|信息化/.test(source)) return "实施顾问";
  return "其他";
}

export function localAnalyzeJD(jdText: string): ParsedJD {
  const cleaned = cleanJDText(jdText);
  const hardSkills = pickKeywords(cleaned, ["SQL", "Python", "Excel", "Power BI", "Tableau", "PRD", "Axure", "Figma", "RAG", "Agent", "Dify", "Coze", "API", "ERP", "SaaS"]);
  const softSkills = pickKeywords(cleaned, ["沟通", "协作", "自驱", "逻辑", "复盘", "执行力", "学习能力", "抗压"]);
  const tools = pickKeywords(cleaned, ["Excel", "SQL", "Python", "Power BI", "Tableau", "Axure", "Figma", "Dify", "Coze", "飞书", "Notion"]);
  const keywords = Array.from(new Set([...hardSkills, ...softSkills, ...tools])).slice(0, 12);
  const sentences = cleaned.split(/[。；;.]/).map((item) => item.trim()).filter(Boolean);
  return {
    responsibilities: sentences.slice(0, 5),
    hardSkills,
    softSkills,
    tools,
    keywords,
    bonusItems: sentences.filter((item) => /优先|加分|熟悉|了解/.test(item)).slice(0, 5),
    educationPreference: /硕士|研究生/.test(cleaned) ? "偏好硕士/研究生" : /本科/.test(cleaned) ? "本科及以上" : "未明确",
    summary: sentences.slice(0, 2).join("。")
  };
}

export function isResumeRequested(messages: string[]): boolean {
  const content = messages.join(" ");
  return resumeRequestPatterns.some((pattern) => content.includes(pattern));
}

function pickKeywords(text: string, candidates: string[]): string[] {
  const normalized = text.toLowerCase();
  return candidates.filter((candidate) => normalized.includes(candidate.toLowerCase()));
}

export * from "./filter";
export * from "./template";
