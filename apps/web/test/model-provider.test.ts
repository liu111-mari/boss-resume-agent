import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GreetingTemplate, JobCard, Profile, ProfileItem } from "@boss-agent/shared";

import {
  ModelFactGuardError,
  ModelRequestError,
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

async function startJsonServer(
  handler: (request: IncomingMessage, response: ServerResponse<IncomingMessage>) => void
): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(handler);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected an ephemeral TCP port");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("createDeepSeekGreetingModelProvider", () => {
  it("includes confirmed soft job preferences in the existing score prompt", async () => {
    let requestBody: Record<string, any> = {};
    const provider = createDeepSeekGreetingModelProvider({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      request: async (_url, init) => {
        requestBody = JSON.parse(String(init.body));
        return jsonResponse({
          choices: [{ message: { content: JSON.stringify({
            score: 80,
            matchedRequirements: [],
            missingRequirements: [],
            reasons: [],
            recommendedProfileFields: []
          }) } }]
        });
      }
    });

    await provider.scoreJob({
      job: createJob(),
      profile: createProfile(),
      keywords: [],
      softPreferences: ["偏好能沉淀数据项目成果的岗位"]
    });

    expect(String(requestBody.messages[1].content)).toContain("偏好能沉淀数据项目成果的岗位");
  });

  it("normalizes common DeepSeek JSON type drift", async () => {
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
                  score: "82",
                  matchedRequirements: "SQL",
                  missingRequirements: null,
                  reasons: ["技能匹配"],
                  recommendedProfileFields: "skill-sql"
                })
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
    ).resolves.toMatchObject({
      score: 82,
      matchedRequirements: ["SQL"],
      missingRequirements: [],
      reasons: ["技能匹配"],
      recommendedProfileFields: ["skill-sql"],
      provider: "deepseek"
    });
  });

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

  it("allows company and job title facts from the job even when they are not in personal facts", async () => {
    const provider = createDeepSeekGreetingModelProvider({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      request: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                text: "你好，我对示例科技的数据分析师岗位很感兴趣。我熟悉 SQL 和 Python 数据分析，也做过经营分析看板项目。",
                usedProfileItemIds: ["skill-sql", "project-dashboard"]
              })
            }
          }
        ]
      })
    });

    await expect(
      provider.refineGreeting({
        draft: "你好，我想应聘这个岗位。我熟悉 SQL 和 Python 数据分析，也做过经营分析看板项目。",
        job: createJob(),
        selectedProfileItems: selectedProfileItems(),
        template: createTemplate()
      })
    ).resolves.toMatchObject({
      text: "你好，我对示例科技的数据分析师岗位很感兴趣。我熟悉 SQL 和 Python 数据分析，也做过经营分析看板项目。"
    });
  });

  it("rejects usedProfileItemIds outside the selected subset", async () => {
    const provider = createDeepSeekGreetingModelProvider({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      request: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                text: "你好，我熟悉 SQL 和 Python 数据分析，也做过经营分析看板项目。",
                usedProfileItemIds: ["skill-sql", "intro-unknown"]
              })
            }
          }
        ]
      })
    });

    await expect(
      provider.refineGreeting({
        draft: "你好，我熟悉 SQL 和 Python 数据分析，也做过经营分析看板项目。",
        job: createJob(),
        selectedProfileItems: selectedProfileItems(),
        template: createTemplate()
      })
    ).rejects.toBeInstanceOf(ModelFactGuardError);
  });

  it("accepts a normal refinement and returns usage metadata", async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    const provider = createDeepSeekGreetingModelProvider({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      prices: {
        inputCnyPerMillion: 2,
        outputCnyPerMillion: 8
      },
      request: async (_url, init) => {
        calls.push({ init });
        return (
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
        );
      }
    });

    await expect(
      provider.refineGreeting({
        draft: "你好，我想应聘数据分析师。我熟悉 SQL 和 Python 数据分析，也做过经营分析看板项目。",
        job: createJob(),
        selectedProfileItems: selectedProfileItems(),
        template: createTemplate({
          body: "BOSS您好，我对您发布的{{jobTitle}}岗位很感兴趣。根据JD选择3项经历并以查看简历收尾。"
        })
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

    const requestBody = JSON.parse(String(calls[0]?.init?.body));
    const prompt = String(requestBody.messages[1].content);
    expect(prompt).toContain("BOSS您好，我对您发布的{{jobTitle}}岗位很感兴趣");
    expect(prompt).toContain("负责数据分析与报表建设，要求熟悉 SQL、Python、Tableau");
    expect(prompt).toContain("熟悉 SQL 和 Python 数据分析");
    expect(prompt).toContain("遵循 template.body");
    expect(prompt).toContain("不得添加");
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

  it("falls back to default prices when env values are NaN, Infinity, or negative", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  score: 80,
                  matchedRequirements: ["SQL"],
                  missingRequirements: [],
                  reasons: ["匹配"],
                  recommendedProfileFields: ["skill-sql"]
                })
              }
            }
          ],
          usage: {
            prompt_tokens: 1_000_000,
            completion_tokens: 1_000_000,
            total_tokens: 2_000_000
          }
        })
      )
    );

    const provider = createConfiguredProvider({
      GREETING_MODEL_PROVIDER: "deepseek",
      GREETING_MODEL_API_KEY: "test-key",
      GREETING_MODEL_BASE_URL: "https://api.deepseek.com",
      GREETING_MODEL_NAME: "deepseek-chat",
      GREETING_MODEL_INPUT_CNY_PER_MILLION: "NaN",
      GREETING_MODEL_OUTPUT_CNY_PER_MILLION: "Infinity"
    });

    const result = await provider.scoreJob({
      job: createJob(),
      profile: createProfile(),
      keywords: ["SQL"]
    });

    expect(result.estimatedCostCny).toBe(10);

    const providerWithNegative = createConfiguredProvider({
      GREETING_MODEL_PROVIDER: "deepseek",
      GREETING_MODEL_API_KEY: "test-key",
      GREETING_MODEL_BASE_URL: "https://api.deepseek.com",
      GREETING_MODEL_NAME: "deepseek-chat",
      GREETING_MODEL_INPUT_CNY_PER_MILLION: "-1",
      GREETING_MODEL_OUTPUT_CNY_PER_MILLION: "-8"
    });

    const negativeResult = await providerWithNegative.scoreJob({
      job: createJob(),
      profile: createProfile(),
      keywords: ["SQL"]
    });

    expect(negativeResult.estimatedCostCny).toBe(10);
  });
});

describe("createDeepSeekGreetingModelProvider with real fetch", () => {
  it("times out through the real fetch AbortController integration", async () => {
    const { server, baseUrl } = await startJsonServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    score: 81,
                    matchedRequirements: ["SQL"],
                    missingRequirements: [],
                    reasons: ["匹配"],
                    recommendedProfileFields: ["skill-sql"]
                  })
                }
              }
            ]
          })
        );
      }, 200);
    });

    try {
      const provider = createDeepSeekGreetingModelProvider({
        apiKey: "test-key",
        baseUrl,
        model: "deepseek-chat",
        timeoutMs: 40
      });

      await expect(
        provider.scoreJob({
          job: createJob(),
          profile: createProfile(),
          keywords: ["SQL"]
        })
      ).rejects.toBeInstanceOf(ModelRequestError);

      await expect(
        provider.scoreJob({
          job: createJob(),
          profile: createProfile(),
          keywords: ["SQL"]
        })
      ).rejects.toThrow(/timed out/i);
    } finally {
      await closeServer(server);
    }
  });

  it("parses a real Response.json payload from a local server", async () => {
    const { server, baseUrl } = await startJsonServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  score: 88,
                  matchedRequirements: ["SQL"],
                  missingRequirements: ["Tableau"],
                  reasons: ["本地服务返回成功"],
                  recommendedProfileFields: ["skill-sql"]
                })
              }
            }
          ],
          usage: {
            prompt_tokens: 200,
            completion_tokens: 50,
            total_tokens: 250
          }
        })
      );
    });

    try {
      const provider = createDeepSeekGreetingModelProvider({
        apiKey: "test-key",
        baseUrl,
        model: "deepseek-chat"
      });

      await expect(
        provider.scoreJob({
          job: createJob(),
          profile: createProfile(),
          keywords: ["SQL", "Tableau"]
        })
      ).resolves.toMatchObject({
        score: 88,
        matchedRequirements: ["SQL"],
        missingRequirements: ["Tableau"],
        reasons: ["本地服务返回成功"],
        recommendedProfileFields: ["skill-sql"],
        provider: "deepseek",
        model: "deepseek-chat"
      });
    } finally {
      await closeServer(server);
    }
  });
});
