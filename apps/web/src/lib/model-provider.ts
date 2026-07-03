import { z } from "zod";

import type { GreetingTemplate, JobCard, Profile, ProfileItem } from "@boss-agent/shared";

export type ScoreJobInput = {
  job: JobCard;
  profile: Profile;
  keywords: string[];
  softPreferences?: string[];
};

export type ModelUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type ScoreJobResult = {
  score: number;
  matchedRequirements: string[];
  missingRequirements: string[];
  reasons: string[];
  recommendedProfileFields: string[];
  provider: string;
  model: string;
  estimatedCostCny: number;
  usage?: ModelUsage;
};

export type RefineGreetingInput = {
  draft: string;
  job: JobCard;
  selectedProfileItems: ProfileItem[];
  template: GreetingTemplate;
};

export type RefineGreetingResult = {
  text: string;
  provider: string;
  model: string;
  estimatedCostCny: number;
  usage?: ModelUsage;
};

export interface GreetingModelProvider {
  scoreJob(input: ScoreJobInput): Promise<ScoreJobResult>;
  refineGreeting(input: RefineGreetingInput): Promise<RefineGreetingResult>;
}

export type DeepSeekRawResponse = {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type DeepSeekRequest = (
  url: string,
  init: RequestInit,
  signal: AbortSignal
) => Promise<Response | DeepSeekRawResponse>;

type PriceConfig = {
  inputCnyPerMillion: number;
  outputCnyPerMillion: number;
};

type DeepSeekProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  request?: DeepSeekRequest;
  timeoutMs?: number;
  prices?: PriceConfig;
};

type EnvLike = Record<string, string | undefined>;

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";

// These are safe fallbacks only. Operators should override them with env config
// instead of treating them as guaranteed current pricing.
const FALLBACK_INPUT_CNY_PER_MILLION = 2;
const FALLBACK_OUTPUT_CNY_PER_MILLION = 8;

const outerResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string()
        })
      })
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().nonnegative().default(0),
      completion_tokens: z.number().nonnegative().default(0),
      total_tokens: z.number().nonnegative().optional()
    })
    .optional()
});

const stringArraySchema = z.preprocess(
  (value) => (value == null ? [] : Array.isArray(value) ? value : [value]),
  z.array(z.string())
);

const scoreContentSchema = z.object({
  score: z.coerce.number().min(0).max(100),
  matchedRequirements: stringArraySchema,
  missingRequirements: stringArraySchema,
  reasons: stringArraySchema,
  recommendedProfileFields: stringArraySchema
});

const refineContentSchema = z.object({
  text: z.string().min(1),
  usedProfileItemIds: stringArraySchema
});

export class ModelFactGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelFactGuardError";
  }
}

export class ModelRequestError extends Error {
  public readonly provider?: string;
  public readonly model?: string;

  constructor(
    message: string,
    options?: { cause?: unknown; provider?: string; model?: string }
  ) {
    super(message, options);
    this.name = "ModelRequestError";
    this.provider = options?.provider;
    this.model = options?.model;
  }
}

export function createConfiguredProvider(env: EnvLike = process.env): GreetingModelProvider {
  const provider = normalizeForMatch(env.GREETING_MODEL_PROVIDER ?? "");
  const apiKey = env.GREETING_MODEL_API_KEY?.trim() ?? "";

  if (provider === "deepseek" && apiKey) {
    return createDeepSeekGreetingModelProvider({
      apiKey,
      baseUrl: env.GREETING_MODEL_BASE_URL?.trim() || DEFAULT_DEEPSEEK_BASE_URL,
      model: env.GREETING_MODEL_NAME?.trim() || DEFAULT_DEEPSEEK_MODEL,
      prices: {
        inputCnyPerMillion: readNonNegativeNumber(
          env.GREETING_MODEL_INPUT_CNY_PER_MILLION,
          FALLBACK_INPUT_CNY_PER_MILLION
        ),
        outputCnyPerMillion: readNonNegativeNumber(
          env.GREETING_MODEL_OUTPUT_CNY_PER_MILLION,
          FALLBACK_OUTPUT_CNY_PER_MILLION
        )
      }
    });
  }

  return createLocalGreetingModelProvider();
}

export function createDeepSeekGreetingModelProvider(
  config: DeepSeekProviderConfig
): GreetingModelProvider {
  const request = config.request ?? defaultRequest;
  const timeoutMs =
    typeof config.timeoutMs === "number" && config.timeoutMs > 0
      ? config.timeoutMs
      : DEFAULT_TIMEOUT_MS;
  const prices = {
    inputCnyPerMillion:
      config.prices?.inputCnyPerMillion ?? FALLBACK_INPUT_CNY_PER_MILLION,
    outputCnyPerMillion:
      config.prices?.outputCnyPerMillion ?? FALLBACK_OUTPUT_CNY_PER_MILLION
  };
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  return {
    async scoreJob(input) {
      const payload = await invokeDeepSeek(request, {
        url,
        apiKey: config.apiKey,
        timeoutMs,
        model: config.model,
        prompt: buildScorePrompt(input)
      });
      const content = parseModelContent(payload, scoreContentSchema, config.model);
      const usage = mapUsage(payload.usage);

      return {
        ...content,
        provider: "deepseek",
        model: config.model,
        estimatedCostCny: estimateCostCny(usage, prices),
        usage
      };
    },
    async refineGreeting(input) {
      const payload = await invokeDeepSeek(request, {
        url,
        apiKey: config.apiKey,
        timeoutMs,
        model: config.model,
        prompt: buildRefinePrompt(input)
      });
      const content = parseModelContent(payload, refineContentSchema, config.model);
      validateUsedProfileItemIds(content.usedProfileItemIds, input.selectedProfileItems);
      assertNoUnknownFacts(content.text, input);
      const usage = mapUsage(payload.usage);

      return {
        text: content.text,
        provider: "deepseek",
        model: config.model,
        estimatedCostCny: estimateCostCny(usage, prices),
        usage
      };
    }
  };
}

export function createLocalGreetingModelProvider(): GreetingModelProvider {
  return {
    async scoreJob(input) {
      const enabledItems = input.profile.items.filter((item) => item.enabled);
      const jobSource = normalizeForMatch(
        [input.job.title, input.job.jdText, ...input.keywords].join(" ")
      );
      const profileSource = normalizeForMatch(
        enabledItems.flatMap((item) => [item.content, ...item.tags]).join(" ")
      );
      const matchedRequirements = unique(
        input.keywords.filter((keyword) => {
          const normalizedKeyword = normalizeForMatch(keyword);
          return (
            normalizedKeyword.length > 0 &&
            jobSource.includes(normalizedKeyword) &&
            profileSource.includes(normalizedKeyword)
          );
        })
      );
      const missingRequirements = unique(
        input.keywords.filter((keyword) => {
          const normalizedKeyword = normalizeForMatch(keyword);
          return normalizedKeyword.length > 0 && jobSource.includes(normalizedKeyword)
            ? !profileSource.includes(normalizedKeyword)
            : false;
        })
      );
      const rankedItems = enabledItems
        .map((item, index) => ({
          id: item.id,
          index,
          overlap: countOverlappingKeywords(
            [item.content, ...item.tags].join(" "),
            input.keywords,
            jobSource
          )
        }))
        .filter((item) => item.overlap > 0)
        .sort((left, right) => {
          if (right.overlap !== left.overlap) return right.overlap - left.overlap;
          return left.index - right.index;
        });
      const recommendedProfileFields = rankedItems.slice(0, 4).map((item) => item.id);
      const coverage =
        input.keywords.length === 0 ? 0 : matchedRequirements.length / input.keywords.length;
      const itemCoverage =
        enabledItems.length === 0 ? 0 : Math.min(1, recommendedProfileFields.length / 3);
      const score = Math.max(
        0,
        Math.min(100, Math.round(coverage * 80 + itemCoverage * 20))
      );
      const reasons = [
        matchedRequirements.length > 0
          ? `匹配关键词：${matchedRequirements.join("、")}`
          : "未找到可直接证明的关键词重叠",
        recommendedProfileFields.length > 0
          ? `建议优先使用素材：${recommendedProfileFields.join("、")}`
          : "没有可直接推荐的已启用素材"
      ];

      return {
        score,
        matchedRequirements,
        missingRequirements,
        reasons,
        recommendedProfileFields,
        provider: "local",
        model: "template",
        estimatedCostCny: 0
      };
    },
    async refineGreeting(input) {
      return {
        text: input.draft,
        provider: "local",
        model: "template",
        estimatedCostCny: 0
      };
    }
  };
}

async function defaultRequest(
  url: string,
  init: RequestInit,
  signal: AbortSignal
): Promise<Response> {
  return fetch(url, { ...init, signal });
}

async function invokeDeepSeek(
  request: DeepSeekRequest,
  input: {
    url: string;
    apiKey: string;
    timeoutMs: number;
    model: string;
    prompt: string;
  }
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await request(
      input.url,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: input.model,
          temperature: 0.2,
          response_format: {
            type: "json_object"
          },
          messages: [
            {
              role: "system",
              content:
                "你是求职问候语模型。只能基于输入事实输出 JSON，不得添加未提供事实。"
            },
            {
              role: "user",
              content: input.prompt
            }
          ]
        })
      },
      controller.signal
    );
    const payload = await readJsonPayload(response);
    return outerResponseSchema.parse(payload);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ModelRequestError(`DeepSeek request timed out after ${input.timeoutMs}ms`, {
        cause: error,
        provider: "deepseek",
        model: input.model
      });
    }

    if (error instanceof ModelRequestError) {
      throw new ModelRequestError(error.message, {
        cause: error,
        provider: error.provider ?? "deepseek",
        model: error.model ?? input.model
      });
    }

    throw new ModelRequestError(
      error instanceof Error ? error.message : "DeepSeek request failed",
      {
        cause: error,
        provider: "deepseek",
        model: input.model
      }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readJsonPayload(response: Response | DeepSeekRawResponse): Promise<unknown> {
  if (response instanceof Response) {
    if (!response.ok) {
      throw new ModelRequestError(`DeepSeek request failed with status ${response.status}`);
    }

    return response.json();
  }

  return response;
}

function parseModelContent<T extends z.ZodTypeAny>(
  payload: z.infer<typeof outerResponseSchema>,
  schema: T,
  model: string
): z.infer<T> {
  const rawContent = payload.choices[0]?.message.content ?? "";

  try {
    return schema.parse(JSON.parse(rawContent));
  } catch (error) {
    const message =
      error instanceof SyntaxError
        ? "DeepSeek model response was not valid JSON"
        : "DeepSeek model response did not match the expected schema";
    throw new ModelRequestError(message, {
      cause: error,
      provider: "deepseek",
      model
    });
  }
}

function mapUsage(
  usage: z.infer<typeof outerResponseSchema>["usage"]
): ModelUsage | undefined {
  if (!usage) return undefined;

  const promptTokens = usage.prompt_tokens;
  const completionTokens = usage.completion_tokens;
  const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;

  return {
    promptTokens,
    completionTokens,
    totalTokens
  };
}

function estimateCostCny(usage: ModelUsage | undefined, prices: PriceConfig): number {
  if (!usage) return 0;

  const inputPrice = Number.isFinite(prices.inputCnyPerMillion)
    ? prices.inputCnyPerMillion
    : 0;
  const outputPrice = Number.isFinite(prices.outputCnyPerMillion)
    ? prices.outputCnyPerMillion
    : 0;
  const total =
    (usage.promptTokens / 1_000_000) * inputPrice +
    (usage.completionTokens / 1_000_000) * outputPrice;

  return Number.isFinite(total) ? Number(total.toFixed(8)) : 0;
}

function buildScorePrompt(input: ScoreJobInput): string {
  const enabledItems = input.profile.items
    .filter((item) => item.enabled)
    .map((item) => ({
      id: item.id,
      category: item.category,
      content: item.content,
      tags: item.tags
    }));

  return [
    "请评估候选人与岗位的匹配度，只输出 JSON。",
    "字段必须包含 score, matchedRequirements, missingRequirements, reasons, recommendedProfileFields。",
    "recommendedProfileFields 只能填写提供的素材 id。",
    JSON.stringify(
      {
        job: {
          title: input.job.title,
          company: input.job.company,
          jdText: input.job.jdText,
          keywords: input.keywords,
          confirmedSoftPreferences: input.softPreferences ?? []
        },
        profile: {
          school: input.profile.school,
          major: input.profile.major,
          graduation: input.profile.graduation,
          direction: input.profile.direction,
          enabledItems
        }
      },
      null,
      2
    )
  ].join("\n\n");
}

function buildRefinePrompt(input: RefineGreetingInput): string {
  return [
    "请遵循 template.body 的话术结构，并根据 job.jdText 调整信息优先级；只改写 draft 的表达，不得添加 draft 或已选素材里不存在的新事实。",
    "只输出 JSON，字段必须包含 text 和 usedProfileItemIds。",
    "usedProfileItemIds 必须是已选素材 id 的子集。",
    JSON.stringify(
      {
        job: {
          title: input.job.title,
          company: input.job.company,
          jdText: input.job.jdText
        },
        template: {
          body: input.template.body,
          tone: input.template.tone,
          minLength: input.template.minLength,
          maxLength: input.template.maxLength
        },
        draft: input.draft,
        selectedProfileItems: input.selectedProfileItems.map((item) => ({
          id: item.id,
          category: item.category,
          content: item.content
        }))
      },
      null,
      2
    )
  ].join("\n\n");
}

function validateUsedProfileItemIds(ids: string[], selectedItems: ProfileItem[]) {
  const allowedIds = new Set(selectedItems.map((item) => item.id));

  for (const id of ids) {
    if (!allowedIds.has(id)) {
      throw new ModelFactGuardError(`Refinement returned unknown profile item id: ${id}`);
    }
  }
}

function assertNoUnknownFacts(text: string, input: RefineGreetingInput) {
  const allowedPersonalFacts = normalizeForMatch(
    [input.draft, ...input.selectedProfileItems.map((item) => item.content)].join(" ")
  );
  const textWithoutAllowedJobFacts = stripAllowedJobFacts(text, input);
  const unknownPersonalFacts = unique(
    collectPersonalFactFindings(textWithoutAllowedJobFacts).filter(
      (fragment) => !allowedPersonalFacts.includes(normalizeForMatch(fragment))
    )
  );

  if (unknownPersonalFacts.length > 0) {
    throw new ModelFactGuardError(
      `Refinement introduced unsupported facts: ${unknownPersonalFacts.join(" | ")}`
    );
  }
}

// This is a high-risk mechanical guard for obvious hard facts only.
// It reduces hallucination risk, but it does not replace semantic review.
function collectPersonalFactFindings(text: string): string[] {
  const patterns = [
    /\d+(?:\.\d+)?%/g,
    /\b\d+(?:\.\d+)?\b/g,
    /(?:约|近|超|超出)?\d+(?:\.\d+)?(?:元|万元|万|k|K|w|W)/g,
    /[\u4e00-\u9fa5A-Za-z]{2,}(?:大学|学院|学校)/g,
    /[\u4e00-\u9fa5A-Za-z]{2,}专业/g,
    /20\d{2}(?:届|年)?/g,
    /[\u4e00-\u9fa5A-Za-z]{2,}(?:证书)/g
  ];
  const certificateKeywords = [
    "证书",
    "PMP",
    "CPA",
    "CFA",
    "软考",
    "教师资格",
    "证券从业",
    "基金从业",
    "雅思",
    "托福",
    "四六级"
  ];
  const findings: string[] = [];

  for (const pattern of patterns) {
    findings.push(...text.match(pattern) ?? []);
  }

  for (const keyword of certificateKeywords) {
    if (text.includes(keyword)) findings.push(keyword);
  }

  return findings;
}

function stripAllowedJobFacts(text: string, input: RefineGreetingInput): string {
  const allowedJobFacts = unique([
    input.job.company,
    input.job.title,
    `${input.job.title}岗位`,
    `${input.job.title}职位`,
    input.draft
  ])
    .filter((fact) => fact.trim().length > 0)
    .sort((left, right) => right.length - left.length);
  let output = text;

  for (const fact of allowedJobFacts) {
    output = output.replaceAll(fact, " ");
  }

  return output;
}

function countOverlappingKeywords(
  source: string,
  keywords: string[],
  normalizedJobSource: string
): number {
  const normalizedSource = normalizeForMatch(source);

  return keywords.reduce((count, keyword) => {
    const normalizedKeyword = normalizeForMatch(keyword);
    return normalizedKeyword.length > 0 &&
      normalizedJobSource.includes(normalizedKeyword) &&
      normalizedSource.includes(normalizedKeyword)
      ? count + 1
      : count;
  }, 0);
}

function readNonNegativeNumber(input: string | undefined, fallback: number): number {
  const value = Number(input);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeForMatch(input: string): string {
  return input.normalize("NFKC").toLowerCase();
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
