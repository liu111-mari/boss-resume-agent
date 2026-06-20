import { describe, expect, it, vi } from "vitest";

import type { GreetingTemplate, JobCard, Profile, ProfileItem } from "@boss-agent/shared";

import {
  ModelFactGuardError,
  createConfiguredProvider,
  createDeepSeekGreetingModelProvider
} from "@/lib/model-provider";

function createJob(overrides: Partial<JobCard> = {}): JobCard {
  return {
    id: "job-1",
    title: "数据分析师",
    company: "示例科技",
    city: "上海",
    salary: "15-25K",
    hrName: "",
    hrActiveText: "",
    detailUrl: "https://example.com/jobs/1",
    sourcePage: "boss",
    jdText: "负责数据分析与报表建设，要求熟悉 SQL、Python、Tableau。",
    experience: "1-3年",
    education: "本科",
    industry: "SaaS",
    rawText: "",
    direction: "数据分析",
    collectedAt: "2026-06-20T00:00:00.000Z",
    ...overrides
  };
}

function createProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    school: "复旦大学",
    major: "信息管理",
    graduation: "2026",
    direction: "数据分析",
    items: [
      {
        id: "intro-1",
        category: "intro",
        content: "我有数据分析相关实习经历。",
        tags: ["数据分析"],
        enabled: true
      },
      {
        id: "skill-sql",
        category: "skill",
        content: "熟悉 SQL 和 Python 数据分析。",
        tags: ["SQL", "Python", "数据分析"],
        enabled: true
      },
      {
        id: "project-dashboard",
        category: "project",
        content: "做过经营分析看板项目。",
        tags: ["经营分析", "看板"],
        enabled: true
      }
    ],
    ...overrides
  };
}

function createTemplate(overrides: Partial<GreetingTemplate> = {}): GreetingTemplate {
  return {
    body: "你好，我想应聘{{jobTitle}}。",
    tone: "自然",
    minLength: 10,
    maxLength: 120,
    maxSkills: 2,
    maxProjects: 1,
    bannedPhrases: [],
    version: 1,
    ...overrides
  };
}

function selectedProfileItems(): ProfileItem[] {
  return [
    {
      id: "skill-sql",
      category: "skill",
      content: "熟悉 SQL 和 Python 数据分析。",
      tags: ["SQL", "Python", "数据分析"],
      enabled: true
    },
    {
      id: "project-dashboard",
      category: "project",
      content: "做过经营分析看板项目。",
      tags: ["经营分析", "看板"],
      enabled: true
    }
  ];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("createDeepSeekGreetingModelProvider", () => {
  it("uses structured DeepSeek output for scoring and sends the expected request", async () => {
    const calls: Array<{ url: string; init?: RequestInit; aborted: boolean }> = [];
    const provider = createDeepSeekGreetingModelProvider({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com/",
      model: "deepseek-chat",
      prices: {
        inputCnyPerMillion: 2,
        outputCnyPerMillion: 8
      },
      request: async (url, init, signal) => {
        calls.push({ url, init, aborted: signal.aborted });
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  score: 82,
                  matchedRequirements: ["SQL", "Python"],
                  missingRequirements: ["Tableau"],
                  reasons: ["技能和项目经历匹配"],
                  recommendedProfileFields: ["skill-sql", "project-dashboard"]
                })
              }
            }
          ],
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 500,
            total_tokens: 1500
          }
        });
      }
    });

    const result = await provider.scoreJob({
      job: createJob(),
      profile: createProfile(),
      keywords: ["SQL", "Python", "Tableau"]
    });

    expect(result).toEqual({
      score: 82,
      matchedRequirements: ["SQL", "Python"],
      missingRequirements: ["Tableau"],
      reasons: ["技能和项目经历匹配"],
      recommendedProfileFields: ["skill-sql", "project-dashboard"],
      provider: "deepseek",
      model: "deepseek-chat",
      estimatedCostCny: 0.006,
      usage: {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500
      }
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.deepseek.com/chat/completions");
    expect(calls[0]?.aborted).toBe(false);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: "Bearer test-key",
      "content-type": "application/json"
    });

    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body).toMatchObject({
      model: "deepseek-chat",
      temperature: 0.2,
      response_format: {
        type: "json_object"
      }
    });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].content).toContain("不得添加未提供事实");
    expect(body.messages[1].content).toContain("数据分析师");
    expect(body.messages[1].content).toContain("复旦大学");
    expect(body.messages[1].content).not.toContain("rawText");
  });

  it("rejects malformed model JSON content", async () => {
    const provider = createDeepSeekGreetingModelProvider({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      request: async () =>
        jsonResponse({
          choices: [
            {
              message: {
                content: "{not-json}"
              }
            }
          ]
        })
    });

    await expect(
      provider.scoreJob({
        job: createJob(),
        profile: createProfile(),
        keywords: ["SQL"]
      })
    ).rejects.toThrow(/model response/i);
  });

  it("surfaces HTTP status without leaking response body", async () => {
    const provider = createDeepSeekGreetingModelProvider({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      request: async () =>
        jsonResponse(
          {
            error: {
              message: "secret backend detail"
            }
          },
          503
        )
    });

    await expect(
      provider.scoreJob({
        job: createJob(),
        profile: createProfile(),
        keywords: ["SQL"]
      })
    ).rejects.toThrow("DeepSeek request failed with status 503");
  });

  it("aborts when the request exceeds the configured timeout", async () => {
    vi.useFakeTimers();

    const provider = createDeepSeekGreetingModelProvider({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      timeoutMs: 5,
      request: (_url, _init, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new Error(`aborted:${signal.aborted}`));
          });
        })
    });

    const pending = provider.scoreJob({
      job: createJob(),
      profile: createProfile(),
      keywords: ["SQL"]
    });
    const expectation = expect(pending).rejects.toThrow(
      "DeepSeek request timed out after 5ms"
    );

    await vi.advanceTimersByTimeAsync(5);

    await expectation;
    vi.useRealTimers();
  });

  it("rejects refined text that adds unknown hard facts", async () => {
    const provider = createDeepSeekGreetingModelProvider({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      request: async () =>
        jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  text: "你好，我是复旦大学信息管理专业学生，做过经营分析看板项目，曾把转化率提升30%。",
                  usedProfileItemIds: ["project-dashboard"]
                })
              }
            }
          ]
        })
    });

    await expect(
      provider.refineGreeting({
        draft: "你好，我是信息管理专业学生，做过经营分析看板项目。",
        job: createJob(),
        selectedProfileItems: selectedProfileItems(),
        template: createTemplate()
      })
    ).rejects.toBeInstanceOf(ModelFactGuardError);
  });

  it("accepts a normal refinement and returns usage metadata", async () => {
    const provider = createDeepSeekGreetingModelProvider({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      prices: {
        inputCnyPerMillion: 2,
        outputCnyPerMillion: 8
      },
      request: async () =>
        jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  text: "你好，我对贵司数据分析师岗位很感兴趣。我熟悉 SQL 和 Python 数据分析，也做过经营分析看板项目。",
                  usedProfileItemIds: ["skill-sql", "project-dashboard"]
                })
              }
            }
          ],
          usage: {
            prompt_tokens: 600,
            completion_tokens: 120,
            total_tokens: 720
          }
        })
    });

    await expect(
      provider.refineGreeting({
        draft: "你好，我想应聘数据分析师。我熟悉 SQL 和 Python 数据分析，也做过经营分析看板项目。",
        job: createJob(),
        selectedProfileItems: selectedProfileItems(),
        template: createTemplate()
      })
    ).resolves.toEqual({
      text: "你好，我对贵司数据分析师岗位很感兴趣。我熟悉 SQL 和 Python 数据分析，也做过经营分析看板项目。",
      provider: "deepseek",
      model: "deepseek-chat",
      estimatedCostCny: 0.00216,
      usage: {
        promptTokens: 600,
        completionTokens: 120,
        totalTokens: 720
      }
    });
  });
});

describe("createConfiguredProvider", () => {
  it("falls back to local scoring and zero cost when no key exists", async () => {
    const provider = createConfiguredProvider({});

    const result = await provider.scoreJob({
      job: createJob(),
      profile: createProfile(),
      keywords: ["SQL", "Python", "Tableau"]
    });

    expect(result.provider).toBe("local");
    expect(result.model).toBe("template");
    expect(result.estimatedCostCny).toBe(0);
    expect(result.matchedRequirements).toEqual(["SQL", "Python"]);
    expect(result.missingRequirements).toEqual(["Tableau"]);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.recommendedProfileFields).toContain("skill-sql");
  });

  it("keeps local scoring deterministic and refine returns the original draft", async () => {
    const provider = createConfiguredProvider({
      GREETING_MODEL_PROVIDER: "local"
    });

    const first = await provider.scoreJob({
      job: createJob(),
      profile: createProfile(),
      keywords: ["SQL", "Python", "Tableau"]
    });
    const second = await provider.scoreJob({
      job: createJob(),
      profile: createProfile(),
      keywords: ["SQL", "Python", "Tableau"]
    });
    const refined = await provider.refineGreeting({
      draft: "你好，我想应聘数据分析师。",
      job: createJob(),
      selectedProfileItems: selectedProfileItems(),
      template: createTemplate()
    });

    expect(second).toEqual(first);
    expect(first.score).toBeGreaterThanOrEqual(0);
    expect(first.score).toBeLessThanOrEqual(100);
    expect(refined).toEqual({
      text: "你好，我想应聘数据分析师。",
      provider: "local",
      model: "template",
      estimatedCostCny: 0
    });
  });
});
