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
  jdSource: z.enum(["list", "detail"]).optional(),
  experience: z.string().default(""),
  education: z.string().default(""),
  industry: z.string().default(""),
  rawText: z.string().default(""),
  direction: jobDirectionSchema.optional().default("其他"),
  collectedAt: z.string()
});

export const preferenceFocusFieldSchema = z.enum([
  "title",
  "industry",
  "jdResponsibilities",
  "jdRequirements",
  "other"
]);

export const preferenceFeedbackSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  jobSnapshot: jobCardSchema,
  label: z.enum(["positive", "negative"]),
  focusFields: z.array(preferenceFocusFieldSchema).default([]),
  note: z.string().default(""),
  active: z.boolean().default(true),
  source: z.enum(["favorite", "negative_remove"]).default("favorite"),
  consumedBySuggestionIds: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const preferenceRuleActionSchema = z.enum(["include", "exclude", "prefer"]);
export const preferenceRuleFieldSchema = z.enum([
  "title",
  "industry",
  "jd",
  "semantic_preference"
]);
export const preferenceRuleModeSchema = z.enum(["hard", "soft"]);

const preferenceRuleCoreSchema = z.object({
  action: preferenceRuleActionSchema,
  field: preferenceRuleFieldSchema,
  mode: preferenceRuleModeSchema,
  values: z.array(z.string()).default([]),
  statement: z.string().default(""),
  weight: z.number().min(0).max(100).default(50),
  evidenceFeedbackIds: z.array(z.string()).default([]),
  rationale: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0.5)
});

export const preferenceRuleCandidateSchema = preferenceRuleCoreSchema.extend({
  tempId: z.string()
});

export const preferenceRuleSchema = preferenceRuleCoreSchema.extend({
  id: z.string(),
  provenance: z.enum(["manual", "ai_accepted", "preset"]),
  active: z.boolean().default(true),
  locked: z.boolean().default(false),
  version: z.number().int().positive().default(1),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const preferenceSuggestionBatchSchema = z.object({
  id: z.string(),
  feedbackIds: z.array(z.string()),
  currentRuleIds: z.array(z.string()).default([]),
  previousBatchId: z.string().optional(),
  correction: z.string().default(""),
  candidates: z.array(preferenceRuleCandidateSchema),
  status: z.enum(["draft", "accepted", "rejected", "superseded"]).default("draft"),
  provider: z.string(),
  model: z.string(),
  estimatedCostCny: z.number().nonnegative().default(0),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const filterConfigSchema = z
  .object({
    filteringEnabled: z.boolean().default(true),
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

export type JobDirection = z.infer<typeof jobDirectionSchema>;
export type JobCard = z.infer<typeof jobCardSchema>;
export type PreferenceFocusField = z.infer<typeof preferenceFocusFieldSchema>;
export type PreferenceFeedback = z.infer<typeof preferenceFeedbackSchema>;
export type PreferenceRuleCandidate = z.infer<typeof preferenceRuleCandidateSchema>;
export type PreferenceRule = z.infer<typeof preferenceRuleSchema>;
export type PreferenceSuggestionBatch = z.infer<typeof preferenceSuggestionBatchSchema>;
export type FilterConfig = z.infer<typeof filterConfigSchema>;
export type ProfileItem = z.infer<typeof profileItemSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type GreetingTemplate = z.infer<typeof greetingTemplateSchema>;
export type GreetingTaskStatus = z.infer<typeof greetingTaskStatusSchema>;
export type GreetingTask = z.infer<typeof greetingTaskSchema>;

export function inferDirection(text: string): JobDirection {
  const source = text.toLowerCase();
  if (/数据|bi|sql|经营分析|商业分析/.test(source)) return "数据分析";
  if (/agent|智能体|rag|大模型应用|工作流/.test(source)) return "AI Agent";
  if (/ai产品|产品经理|数据产品|b端产品/.test(source)) return "AI产品";
  if (/运营|增长|用户/.test(source)) return "产品运营";
  if (/实施|erp|saas|数字化|信息化/.test(source)) return "实施顾问";
  return "其他";
}

export * from "./filter";
export * from "./preferences";
export * from "./template";
