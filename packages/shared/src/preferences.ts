import {
  preferenceRuleSchema,
  type JobCard,
  type PreferenceRule
} from "./index";

export type PreferenceEvaluation = {
  accepted: boolean;
  reasons: string[];
  softPreferences: string[];
};

export type PreferencePreview = {
  willBeExcluded: JobCard[];
  willBeKept: JobCard[];
  unchanged: JobCard[];
};

export function evaluatePreferenceRules(
  job: JobCard,
  rules: PreferenceRule[]
): PreferenceEvaluation {
  const activeRules = rules.filter((rule) => rule.active);
  const hardRules = activeRules.filter((rule) => rule.mode === "hard");
  const softPreferences = activeRules
    .filter((rule) => rule.mode === "soft" || rule.action === "prefer")
    .map((rule) => rule.statement.trim() || rule.values.join("、"))
    .filter(Boolean);

  for (const rule of hardRules.filter((item) => item.action === "exclude")) {
    const match = firstMatchingValue(job, rule);
    if (match) {
      return {
        accepted: false,
        reasons: [`命中${fieldLabel(rule.field)}排除规则：${match}`],
        softPreferences
      };
    }
  }

  for (const field of ["title", "industry", "jd"] as const) {
    const includes = hardRules.filter(
      (rule) => rule.action === "include" && rule.field === field
    );
    if (includes.length > 0 && !includes.some((rule) => Boolean(firstMatchingValue(job, rule)))) {
      return {
        accepted: false,
        reasons: [`未命中${fieldLabel(field)}包含规则`],
        softPreferences
      };
    }
  }

  return { accepted: true, reasons: [], softPreferences };
}

export function previewPreferenceRule(
  jobs: JobCard[],
  activeRules: PreferenceRule[],
  candidate: PreferenceRule
): PreferencePreview {
  const willBeExcluded: JobCard[] = [];
  const willBeKept: JobCard[] = [];
  const unchanged: JobCard[] = [];

  for (const job of jobs) {
    const before = evaluatePreferenceRules(job, activeRules).accepted;
    const after = evaluatePreferenceRules(job, [...activeRules, candidate]).accepted;
    if (before && !after) willBeExcluded.push(job);
    else if (after) willBeKept.push(job);
    else unchanged.push(job);
  }

  return { willBeExcluded, willBeKept, unchanged };
}

export function createDefaultPreferenceRules(now = new Date().toISOString()): PreferenceRule[] {
  return [
    createPresetRule(now, {
      id: "preset-target-titles",
      action: "include",
      field: "title",
      mode: "hard",
      values: [
        "数据分析",
        "BI",
        "商业分析",
        "经营分析",
        "产品数据分析",
        "数据运营",
        "ERP",
        "CRM",
        "信息化实施",
        "实施顾问",
        "数字化项目",
        "AI产品",
        "产品实习"
      ],
      rationale: "信息管理与信息系统专业的核心、邻近和进阶岗位"
    }),
    createPresetRule(now, {
      id: "preset-excluded-titles",
      action: "exclude",
      field: "title",
      mode: "hard",
      values: ["外卖", "骑手", "养生", "美容", "门店销售", "电话销售", "客服", "普工", "主播", "招聘"],
      rationale: "默认排除低专业相关、低技能复利岗位"
    }),
    createPresetRule(now, {
      id: "preset-excluded-jd",
      action: "exclude",
      field: "jd",
      mode: "hard",
      values: ["电话销售", "地推", "邀约到店", "配送", "按摩", "理疗", "美容服务"],
      rationale: "排除工作内容以直接销售或线下服务为主的岗位"
    }),
    createPresetRule(now, {
      id: "preset-compounding-preference",
      action: "prefer",
      field: "semantic_preference",
      mode: "soft",
      values: [],
      statement: "偏好能够积累数据分析、需求分析、系统实施、原型设计或可展示项目成果的岗位",
      weight: 80,
      rationale: "提高技能可迁移性和职业复利"
    })
  ];
}

function createPresetRule(
  now: string,
  input: Pick<PreferenceRule, "id" | "action" | "field" | "mode" | "values" | "rationale"> &
    Partial<Pick<PreferenceRule, "statement" | "weight">>
): PreferenceRule {
  return preferenceRuleSchema.parse({
    ...input,
    statement: input.statement ?? "",
    weight: input.weight ?? 100,
    provenance: "preset",
    evidenceFeedbackIds: [],
    confidence: 1,
    active: true,
    locked: false,
    version: 1,
    createdAt: now,
    updatedAt: now
  });
}

function firstMatchingValue(job: JobCard, rule: PreferenceRule): string | null {
  const source = sourceForField(job, rule.field);
  return rule.values.find((value) => includesNormalized(source, value)) ?? null;
}

function sourceForField(job: JobCard, field: PreferenceRule["field"]): string {
  if (field === "title") return job.title;
  if (field === "industry") return job.industry;
  if (field === "jd") return `${job.jdText} ${job.rawText}`;
  return "";
}

function includesNormalized(source: string, candidate: string): boolean {
  const normalizedCandidate = normalize(candidate);
  return normalizedCandidate.length > 0 && normalize(source).includes(normalizedCandidate);
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
}

function fieldLabel(field: PreferenceRule["field"]): string {
  if (field === "title") return "岗位名称";
  if (field === "industry") return "行业";
  if (field === "jd") return "JD";
  return "语义偏好";
}
