import { describe, expect, it } from "vitest";

import {
  evaluateJob,
  renderGreeting,
  selectProfileItems,
  type FilterConfig,
  type GreetingTemplate,
  type JobCard,
  type Profile
} from "@boss-agent/shared";

function createJob(overrides: Partial<JobCard> = {}): JobCard {
  return {
    id: "job-1",
    title: "数据分析师",
    company: "示例科技",
    city: "上海",
    salary: "15-25K",
    hrName: "",
    hrActiveText: "",
    detailUrl: "",
    sourcePage: "boss",
    jdText: "负责数据分析，熟悉 SQL",
    experience: "1-3年",
    education: "本科",
    industry: "",
    rawText: "",
    direction: "数据分析",
    collectedAt: "2026-06-19T00:00:00.000Z",
    ...overrides
  };
}

function createFilterConfig(overrides: Partial<FilterConfig> = {}): FilterConfig {
  return {
    targetTitles: [],
    cities: [],
    salaryUnit: "day",
    minSalary: null,
    maxSalary: null,
    employmentTypes: [],
    requiredKeywords: [],
    excludedKeywords: [],
    blockedCompanies: [],
    blockedIndustries: [],
    allowedExperience: [],
    allowedEducation: [],
    scoreThreshold: 70,
    dailyLimit: 100,
    ...overrides
  };
}

function createProfile(): Profile {
  return {
    school: "复旦大学",
    major: "信息管理",
    graduation: "2026",
    direction: "数据分析",
    items: [
      {
        id: "intro-1",
        category: "intro",
        content: "我有数据分析相关实习经验。",
        tags: ["数据分析"],
        enabled: true
      },
      {
        id: "skill-sql",
        category: "skill",
        content: "熟悉 SQL 和数据分析。",
        tags: ["SQL", "数据分析"],
        enabled: true
      },
      {
        id: "skill-design",
        category: "skill",
        content: "会基础 design 协作。",
        tags: ["design"],
        enabled: true
      },
      {
        id: "skill-python",
        category: "skill",
        content: "熟悉 Python 数据清洗。",
        tags: ["Python", "数据分析"],
        enabled: true
      },
      {
        id: "skill-disabled",
        category: "skill",
        content: "熟悉 Tableau。",
        tags: ["BI"],
        enabled: false
      },
      {
        id: "project-sql",
        category: "project",
        content: "做过 SQL 用户分群项目。",
        tags: ["SQL"],
        enabled: true
      },
      {
        id: "project-analysis",
        category: "project",
        content: "做过经营分析看板项目。",
        tags: ["数据分析"],
        enabled: true
      },
      {
        id: "project-disabled",
        category: "project",
        content: "做过禁用项目。",
        tags: ["SQL"],
        enabled: false
      }
    ]
  };
}

function createTemplate(overrides: Partial<GreetingTemplate> = {}): GreetingTemplate {
  return {
    body: "你好，我是{{school}}{{major}}学生，想应聘{{jobTitle}}，熟悉{{skills}}，做过{{projects}}。{{selfIntro}}",
    tone: "自然",
    minLength: 20,
    maxLength: 120,
    maxSkills: 2,
    maxProjects: 1,
    bannedPhrases: ["海投"],
    version: 1,
    ...overrides
  };
}

describe("evaluateJob", () => {
  it("returns exactly the excluded keyword rejection reason", () => {
    const result = evaluateJob(
      createJob({
        title: "AI产品销售",
        jdText: "负责 AI 产品销售拓展"
      }),
      createFilterConfig({
        excludedKeywords: ["销售"]
      })
    );

    expect(result).toEqual({
      accepted: false,
      reasons: ["命中排除关键词：销售"]
    });
  });

  it("rejects in strict priority order and returns only the first reason", () => {
    const result = evaluateJob(
      createJob({
        company: "黑名单公司",
        industry: "FinTech",
        title: "销售专员",
        city: "北京",
        jdText: "需要销售经验"
      }),
      createFilterConfig({
        blockedCompanies: ["黑名单"],
        blockedIndustries: ["fintech"],
        excludedKeywords: ["销售"],
        targetTitles: ["数据分析师"],
        cities: ["上海"],
        requiredKeywords: ["SQL"],
        allowedExperience: ["应届生"],
        allowedEducation: ["硕士"],
        minSalary: 30,
        maxSalary: 40
      })
    );

    expect(result).toEqual({
      accepted: false,
      reasons: ["命中屏蔽公司：黑名单"]
    });
  });

  it("rejects blocked industries before excluded keywords", () => {
    const result = evaluateJob(
      createJob({
        industry: "ＡＩ Saas",
        title: "产品销售",
        jdText: "需要销售经验"
      }),
      createFilterConfig({
        blockedIndustries: ["ai saas"],
        excludedKeywords: ["销售"]
      })
    );

    expect(result).toEqual({
      accepted: false,
      reasons: ["命中屏蔽行业：ai saas"]
    });
  });

  it("rejects title city required keyword experience and education boundaries", () => {
    expect(
      evaluateJob(
        createJob({ title: "产品经理" }),
        createFilterConfig({ targetTitles: ["数据分析师"] })
      )
    ).toEqual({
      accepted: false,
      reasons: ["岗位名称不匹配：产品经理"]
    });

    expect(
      evaluateJob(
        createJob({ city: "北京" }),
        createFilterConfig({ cities: ["上海"] })
      )
    ).toEqual({
      accepted: false,
      reasons: ["城市不匹配：北京"]
    });

    expect(
      evaluateJob(
        createJob({ jdText: "熟悉 Python" }),
        createFilterConfig({ requiredKeywords: ["SQL"] })
      )
    ).toEqual({
      accepted: false,
      reasons: ["缺少必需关键词：SQL"]
    });

    expect(
      evaluateJob(
        createJob({ experience: "5-10年" }),
        createFilterConfig({ allowedExperience: ["1-3年"] })
      )
    ).toEqual({
      accepted: false,
      reasons: ["经验要求不匹配：5-10年"]
    });

    expect(
      evaluateJob(
        createJob({ education: "大专" }),
        createFilterConfig({ allowedEducation: ["本科"] })
      )
    ).toEqual({
      accepted: false,
      reasons: ["学历要求不匹配：大专"]
    });
  });

  it("accepts overlapping salary ranges only when units match", () => {
    expect(
      evaluateJob(
        createJob({ salary: "150-200元/天" }),
        { ...createFilterConfig({ minSalary: 180, maxSalary: 220 }), salaryUnit: "day" } as FilterConfig
      )
    ).toEqual({
      accepted: true,
      reasons: []
    });

    expect(
      evaluateJob(
        createJob({ salary: "15 - 25k ·13薪" }),
        {
          ...createFilterConfig({ minSalary: 20000, maxSalary: 30000 }),
          salaryUnit: "month"
        } as FilterConfig
      )
    ).toEqual({
      accepted: true,
      reasons: []
    });
  });

  it("rejects parsed salaries when config and job units do not match", () => {
    const result = evaluateJob(
      createJob({ salary: "15-25K" }),
      {
        ...createFilterConfig({ minSalary: 150, maxSalary: 250 }),
        salaryUnit: "day"
      } as FilterConfig
    );

    expect(result).toEqual({
      accepted: false,
      reasons: ["薪资单位不匹配：15-25K"]
    });
  });

  it("rejects parsed salaries with non-overlapping ranges in the same unit", () => {
    const result = evaluateJob(
      createJob({ salary: "15-25K" }),
      {
        ...createFilterConfig({ minSalary: 26000, maxSalary: 30000 }),
        salaryUnit: "month"
      } as FilterConfig
    );

    expect(result).toEqual({
      accepted: false,
      reasons: ["薪资范围不匹配：15-25K"]
    });
  });

  it("does not reject when salary is missing or unsupported and records unrecognized salary", () => {
    expect(
      evaluateJob(
        createJob({ salary: "" }),
        {
          ...createFilterConfig({ minSalary: 20000, maxSalary: 30000 }),
          salaryUnit: "month"
        } as FilterConfig
      )
    ).toEqual({
      accepted: true,
      reasons: ["薪资未识别"]
    });

    expect(
      evaluateJob(
        createJob({ salary: "面议" }),
        {
          ...createFilterConfig({ minSalary: 20000, maxSalary: 30000 }),
          salaryUnit: "month"
        } as FilterConfig
      )
    ).toEqual({
      accepted: true,
      reasons: ["薪资未识别"]
    });
  });

  it("matches target titles and required keywords case-insensitively", () => {
    const result = evaluateJob(
      createJob({
        title: "ＡI Product Intern",
        jdText: "Built pipelines and RAＧ evaluation workflows"
      }),
      {
        ...createFilterConfig({
        targetTitles: ["ai product"],
        requiredKeywords: ["rag"]
        }),
        salaryUnit: "day"
      } as FilterConfig
    );

    expect(result).toEqual({
      accepted: true,
      reasons: []
    });
  });

  it("matches blocked companies and excluded keywords case-insensitively", () => {
    expect(
      evaluateJob(
        createJob({
          company: "Acme SALES Group",
          title: "Data Analyst",
          jdText: "Focus on analytics"
        }),
        createFilterConfig({
          blockedCompanies: ["sales"]
        })
      )
    ).toEqual({
      accepted: false,
      reasons: ["命中屏蔽公司：sales"]
    });

    expect(
      evaluateJob(
        createJob({
          title: "Data Analyst",
          jdText: "Need SALES enablement support"
        }),
        createFilterConfig({
          excludedKeywords: ["sales"]
        })
      )
    ).toEqual({
      accepted: false,
      reasons: ["命中排除关键词：sales"]
    });
  });
});

describe("selectProfileItems", () => {
  it("selects only the SQL tagged skill for SQL keywords with independent limits", () => {
    const profile: Profile = {
      school: "",
      major: "",
      graduation: "",
      direction: "",
      items: [
        {
          id: "skill-sql",
          category: "skill",
          content: "熟悉 SQL",
          tags: ["SQL"],
          enabled: true
        },
        {
          id: "skill-design",
          category: "skill",
          content: "会 design",
          tags: ["design"],
          enabled: true
        },
        {
          id: "project-sql",
          category: "project",
          content: "做过 SQL 项目",
          tags: ["SQL"],
          enabled: true
        }
      ]
    };
    const result = selectProfileItems(profile, ["SQL", "数据分析"], {
      maxSkills: 2,
      maxProjects: 1
    });

    expect(result.skills.map((item) => item.id)).toEqual(["skill-sql"]);
    expect(result.projects.map((item) => item.id)).toEqual(["project-sql"]);
  });

  it("keeps a stable original order for same-score items and skips disabled entries", () => {
    const profile = createProfile();
    const result = selectProfileItems(profile, ["数据分析"], {
      maxSkills: 5,
      maxProjects: 5
    });

    expect(result.skills.map((item) => item.id)).toEqual(["skill-sql", "skill-python"]);
    expect(result.projects.map((item) => item.id)).toEqual(["project-analysis"]);
  });

  it("applies separate limits to skills and projects", () => {
    const result = selectProfileItems(createProfile(), ["SQL", "数据分析"], {
      maxSkills: 1,
      maxProjects: 2
    });

    expect(result.skills.map((item) => item.id)).toEqual(["skill-sql"]);
    expect(result.projects.map((item) => item.id)).toEqual(["project-sql", "project-analysis"]);
  });

  it("selects items when only content matches keywords case-insensitively", () => {
    const profile: Profile = {
      school: "",
      major: "",
      graduation: "",
      direction: "",
      items: [
        {
          id: "skill-rag",
          category: "skill",
          content: "Built RAG workflow",
          tags: [],
          enabled: true
        },
        {
          id: "skill-other",
          category: "skill",
          content: "Built dashboard",
          tags: [],
          enabled: true
        }
      ]
    };

    const result = selectProfileItems(profile, ["rag"], {
      maxSkills: 2,
      maxProjects: 1
    });

    expect(result.skills.map((item) => item.id)).toEqual(["skill-rag"]);
    expect(result.projects).toEqual([]);
  });

  it("matches profile content and tags with NFKC normalization", () => {
    const profile: Profile = {
      school: "",
      major: "",
      graduation: "",
      direction: "",
      items: [
        {
          id: "skill-fullwidth",
          category: "skill",
          content: "Built ＲＡＧ workflow",
          tags: ["Cafe\u0301"],
          enabled: true
        }
      ]
    };

    expect(
      selectProfileItems(profile, ["rag", "café"], {
        maxSkills: 2,
        maxProjects: 1
      }).skills.map((item) => item.id)
    ).toEqual(["skill-fullwidth"]);
  });
});

describe("renderGreeting", () => {
  it("renders template variables and includes 熟悉 SQL", () => {
    const profile = createProfile();
    const selected = selectProfileItems(profile, ["SQL", "数据分析"], {
      maxSkills: 2,
      maxProjects: 1
    });

    const result = renderGreeting({
      template: createTemplate(),
      job: createJob(),
      profile,
      selectedItems: selected,
      matchedRequirements: ["熟悉 SQL"]
    });

    expect(result).toContain("熟悉 SQL");
    expect(result).toContain("数据分析师");
    expect(result).toContain("复旦大学");
  });

  it("renders unknown variables as empty strings and collapses whitespace", () => {
    const result = renderGreeting({
      template: createTemplate({
        body: "你好  {{unknown}}  我想应聘 {{jobTitle}}   熟悉 {{skills}}  ",
        minLength: 1
      }),
      job: createJob(),
      profile: createProfile(),
      selectedItems: {
        skills: [],
        projects: [],
        selfIntro: ""
      },
      matchedRequirements: []
    });

    expect(result).toBe("你好 我想应聘 数据分析师 熟悉");
  });

  it("throws when a banned phrase appears", () => {
    expect(() =>
      renderGreeting({
        template: createTemplate({
          body: "你好，我不是海投，想应聘{{jobTitle}}"
        }),
        job: createJob(),
        profile: createProfile(),
        selectedItems: {
          skills: [],
          projects: [],
          selfIntro: ""
        },
        matchedRequirements: []
      })
    ).toThrow("命中禁用表达：海投");
  });

  it("throws when the final length is outside the configured bounds", () => {
    expect(() =>
      renderGreeting({
        template: createTemplate({
          body: "短消息",
          minLength: 10,
          maxLength: 20
        }),
        job: createJob(),
        profile: createProfile(),
        selectedItems: {
          skills: [],
          projects: [],
          selfIntro: ""
        },
        matchedRequirements: []
      })
    ).toThrow("生成话术长度不符合要求");

    expect(() =>
      renderGreeting({
        template: createTemplate({
          body: "{{selfIntro}}{{selfIntro}}{{selfIntro}}{{selfIntro}}{{selfIntro}}",
          minLength: 10,
          maxLength: 20
        }),
        job: createJob(),
        profile: createProfile(),
        selectedItems: {
          skills: [],
          projects: [],
          selfIntro: "这是一个超过上限的自我介绍文本。"
        },
        matchedRequirements: []
      })
    ).toThrow("生成话术长度不符合要求");
  });
});
