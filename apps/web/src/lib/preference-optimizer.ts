import { z } from "zod";

import {
  preferenceRuleCandidateSchema,
  type PreferenceFeedback,
  type PreferenceRule,
  type PreferenceRuleCandidate,
  type Profile
} from "@boss-agent/shared";

type AnalyzeInput = {
  feedback: PreferenceFeedback[];
  currentRules: PreferenceRule[];
  profile: Profile;
  correction: string;
  previousCandidates: PreferenceRuleCandidate[];
};

type AnalyzeResult = {
  candidates: PreferenceRuleCandidate[];
  provider: string;
  model: string;
  estimatedCostCny: number;
};

export interface PreferenceOptimizer {
  analyze(input: AnalyzeInput): Promise<AnalyzeResult>;
}

type RawResponse = {
  choices: Array<{ message: { content: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

type RequestFn = (
  url: string,
  init: RequestInit,
  signal: AbortSignal
) => Promise<Response | RawResponse>;

type DeepSeekConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  request?: RequestFn;
  timeoutMs?: number;
  inputCnyPerMillion?: number;
  outputCnyPerMillion?: number;
};

type EnvLike = Record<string, string | undefined>;

const responseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
  usage: z.object({
    prompt_tokens: z.number().nonnegative().optional(),
    completion_tokens: z.number().nonnegative().optional(),
    total_tokens: z.number().nonnegative().optional()
  }).optional()
});

const candidateResponseSchema = z.object({
  candidates: z.array(preferenceRuleCandidateSchema).max(20)
});

export function createConfiguredPreferenceOptimizer(
  env: EnvLike = process.env
): PreferenceOptimizer {
  const provider = (env.GREETING_MODEL_PROVIDER ?? "").trim().toLowerCase();
  const apiKey = (env.GREETING_MODEL_API_KEY ?? "").trim();
  if (provider !== "deepseek" || !apiKey) {
    return {
      async analyze() {
        throw new Error("DeepSeek 未配置，无法生成偏好优化建议");
      }
    };
  }

  return createDeepSeekPreferenceOptimizer({
    apiKey,
    baseUrl: env.GREETING_MODEL_BASE_URL?.trim() || "https://api.deepseek.com",
    model: env.GREETING_MODEL_NAME?.trim() || "deepseek-chat",
    inputCnyPerMillion: readNumber(env.GREETING_MODEL_INPUT_CNY_PER_MILLION, 2),
    outputCnyPerMillion: readNumber(env.GREETING_MODEL_OUTPUT_CNY_PER_MILLION, 8)
  });
}

export function createDeepSeekPreferenceOptimizer(config: DeepSeekConfig): PreferenceOptimizer {
  const request = config.request ?? defaultRequest;
  const timeoutMs = config.timeoutMs ?? 15_000;

  return {
    async analyze(input) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const raw = await request(
          `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${config.apiKey}`,
              "content-type": "application/json"
            },
            body: JSON.stringify({
              model: config.model,
              temperature: 0.1,
              response_format: { type: "json_object" },
              messages: [{ role: "user", content: buildPreferencePrompt(input) }]
            })
          },
          controller.signal
        );
        const payload = responseSchema.parse(
          raw instanceof Response ? await parseResponse(raw) : raw
        );
        const parsed = candidateResponseSchema.parse(
          JSON.parse(stripCodeFence(payload.choices[0].message.content))
        );
        if (parsed.candidates.length === 0) {
          throw new Error("AI 没有生成候选规则。请补充纠正意见，或增加更多不喜欢/喜欢的岗位反馈后重试。");
        }
        const knownFeedbackIds = new Set(input.feedback.map((item) => item.id));
        for (const candidate of parsed.candidates) {
          const unknownId = candidate.evidenceFeedbackIds.find((id) => !knownFeedbackIds.has(id));
          if (unknownId) throw new Error(`candidate cites unknown feedback: ${unknownId}`);
        }
        const promptTokens = payload.usage?.prompt_tokens ?? 0;
        const completionTokens = payload.usage?.completion_tokens ?? 0;
        const estimatedCostCny = roundCurrency(
          (promptTokens / 1_000_000) * (config.inputCnyPerMillion ?? 2) +
          (completionTokens / 1_000_000) * (config.outputCnyPerMillion ?? 8)
        );
        return {
          candidates: parsed.candidates,
          provider: "deepseek",
          model: config.model,
          estimatedCostCny
        };
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

export function buildPreferencePrompt(input: AnalyzeInput): string {
  const feedback = input.feedback.map((item) => ({
    id: item.id,
    label: item.label,
    focusFields: item.focusFields,
    note: item.note,
    title: item.jobSnapshot.title,
    industry: item.jobSnapshot.industry,
    jd: item.jobSnapshot.jdText.slice(0, 3000)
  }));
  const rules = input.currentRules.filter((rule) => rule.active).map((rule) => ({
    id: rule.id,
    action: rule.action,
    field: rule.field,
    mode: rule.mode,
    values: rule.values,
    statement: rule.statement
  }));

  return [
    "你是岗位偏好规则分析器。比较正负样本，只输出JSON，不要自动应用规则。",
    "重点分析岗位名称、行业和JD；单个样本不足时降低confidence并给出警告性理由。",
    "即使只有负反馈，也必须从不喜欢样本中提取保守的exclude/prefer候选；除非输入完全无岗位信息，否则至少输出1条候选规则。",
    "为控制成本，本次最多分析30条反馈，每条JD最多3000字；不要凭空补全被截断的信息。",
    "输出格式：{\"candidates\":[{tempId,action,field,mode,values,statement,weight,evidenceFeedbackIds,rationale,confidence}]}。",
    "action只能是include/exclude/prefer；field只能是title/industry/jd/semantic_preference；mode只能是hard/soft。",
    `候选人方向：${JSON.stringify({ major: input.profile.major, graduation: input.profile.graduation, direction: input.profile.direction })}`,
    `当前规则：${JSON.stringify(rules)}`,
    `反馈样本：${JSON.stringify(feedback)}`,
    `上次候选：${JSON.stringify(input.previousCandidates)}`,
    `用户纠正：${input.correction.trim() || "无"}`
  ].join("\n");
}

async function defaultRequest(url: string, init: RequestInit, signal: AbortSignal) {
  return fetch(url, { ...init, signal });
}

async function parseResponse(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`DeepSeek 偏好分析失败：HTTP ${response.status}`);
  return body;
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : trimmed;
}

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function roundCurrency(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
