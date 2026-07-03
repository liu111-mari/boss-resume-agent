import { describe, expect, it } from "vitest";

import {
  createDefaultPreferenceRules,
  evaluatePreferenceRules,
  preferenceRuleSchema,
  previewPreferenceRule,
  type JobCard,
  type PreferenceRule
} from "@boss-agent/shared";

function createJob(overrides: Partial<JobCard> = {}): JobCard {
  return {
    id: "job-1",
    title: "数据分析实习生",
    company: "数策科技",
    city: "北京",
    salary: "200-300元/天",
    hrName: "",
    hrActiveText: "",
    detailUrl: "https://example.com/job-1",
    sourcePage: "boss",
    jdText: "使用 SQL 和 Excel 完成经营分析与数据看板",
    experience: "在校/应届",
    education: "本科",
    industry: "企业服务",
    rawText: "数据分析实习生 SQL Excel",
    direction: "数据分析",
    collectedAt: "2026-07-03T00:00:00.000Z",
    ...overrides
  };
}

function createRule(overrides: Partial<PreferenceRule> = {}): PreferenceRule {
  return preferenceRuleSchema.parse({
    id: "rule-1",
    action: "exclude",
    field: "title",
    mode: "hard",
    values: ["养生师"],
    statement: "",
    weight: 100,
    provenance: "manual",
    evidenceFeedbackIds: [],
    rationale: "排除低相关岗位",
    confidence: 1,
    active: true,
    locked: false,
    version: 1,
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z",
    ...overrides
  });
}

describe("adaptive preference filtering", () => {
  it("rejects matching title, industry, and JD hard exclusions", () => {
    const cases = [
      [createJob({ title: "中医养生师" }), createRule({ field: "title", values: ["养生师"] })],
      [createJob({ industry: "生活服务" }), createRule({ field: "industry", values: ["生活服务"] })],
      [
        createJob({ jdText: "通过电话联系客户并完成销售指标" }),
        createRule({ field: "jd", values: ["电话联系客户", "销售指标"] })
      ]
    ] as const;

    for (const [job, rule] of cases) {
      const result = evaluatePreferenceRules(job, [rule]);
      expect(result.accepted).toBe(false);
      expect(result.reasons[0]).toContain(rule.values[0]);
    }
  });

  it("treats multiple hard title include rules as an OR group", () => {
    const rules = [
      createRule({ id: "data", action: "include", values: ["数据分析"] }),
      createRule({ id: "bi", action: "include", values: ["BI"] })
    ];

    expect(evaluatePreferenceRules(createJob({ title: "BI实习生" }), rules).accepted).toBe(true);
    expect(evaluatePreferenceRules(createJob({ title: "门店销售" }), rules).accepted).toBe(false);
  });

  it("ignores inactive and soft rules during hard filtering", () => {
    const rules = [
      createRule({ active: false, values: ["数据分析"] }),
      createRule({ id: "soft", action: "prefer", field: "semantic_preference", mode: "soft", values: [], statement: "偏好可沉淀数据项目成果的岗位" })
    ];

    const result = evaluatePreferenceRules(createJob(), rules);
    expect(result.accepted).toBe(true);
    expect(result.softPreferences).toEqual(["偏好可沉淀数据项目成果的岗位"]);
  });

  it("previews jobs newly excluded by a candidate without writing", () => {
    const jobs = [
      createJob(),
      createJob({ id: "job-2", title: "养生师", industry: "生活服务" })
    ];
    const candidate = createRule({ values: ["养生师"] });

    const preview = previewPreferenceRule(jobs, [], candidate);
    expect(preview.willBeExcluded.map((job) => job.id)).toEqual(["job-2"]);
    expect(preview.willBeKept.map((job) => job.id)).toEqual(["job-1"]);
  });

  it("provides editable information-management seed rules", () => {
    const rules = createDefaultPreferenceRules("2026-07-03T00:00:00.000Z");
    expect(rules.some((rule) => rule.action === "include" && rule.values.includes("数据分析"))).toBe(true);
    expect(rules.some((rule) => rule.action === "exclude" && rule.values.includes("外卖"))).toBe(true);
    expect(rules.every((rule) => rule.locked === false)).toBe(true);
  });
});
