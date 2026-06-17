import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import {
  cleanJDText,
  localAnalyzeJD,
  parsedJDSchema,
  resumeVersionSchema,
  type ParsedJD,
  type ProfileAsset,
  type ResumeVersion
} from "@boss-agent/shared";

export async function analyzeJD(jdText: string): Promise<ParsedJD> {
  const cleaned = cleanJDText(jdText);
  if (!process.env.OPENAI_API_KEY) return localAnalyzeJD(cleaned);

  const result = await generateObject({
    model: openai("gpt-4.1-mini"),
    schema: parsedJDSchema,
    prompt: [
      "你是求职 JD 分析助手。请只抽取岗位要求，不要扩写。",
      "输出结构化字段，中文简洁。",
      `JD:\n${cleaned}`
    ].join("\n\n")
  });

  return result.object;
}

export async function generateResume(parsedJD: ParsedJD, assets: ProfileAsset[], targetJob: string): Promise<ResumeVersion> {
  const relevantAssets = assets
    .filter((asset) => asset.evidenceLevel !== "do_not_claim")
    .filter((asset) => {
      const haystack = `${asset.skillTags.join(" ")} ${asset.directionTags.join(" ")} ${asset.content}`;
      return parsedJD.keywords.some((keyword) => haystack.toLowerCase().includes(keyword.toLowerCase())) || asset.evidenceLevel === "verified";
    })
    .slice(0, 5);

  if (!process.env.OPENAI_API_KEY) {
    return localResume(parsedJD, relevantAssets, targetJob);
  }

  const result = await generateObject({
    model: openai("gpt-4.1-mini"),
    schema: resumeVersionSchema,
    prompt: [
      "你是中文实习简历优化助手。只能基于给定真实素材改写、排序、强调关键词。",
      "禁止编造公司、岗位、时间、上线、提升比例和不存在的技能。",
      "输出一份 Markdown 简历摘要、匹配分、风险项、面试追问题。",
      `目标岗位：${targetJob}`,
      `JD 摘要：${JSON.stringify(parsedJD)}`,
      `真实素材：${JSON.stringify(relevantAssets)}`
    ].join("\n\n")
  });

  return result.object;
}

export function reviewRisk(markdown: string): string[] {
  const risks: string[] = [];
  if (/提升约?\d+%|增长约?\d+%|上线|主导/.test(markdown)) {
    risks.push("包含量化结果或主导/上线表述，请确认有证据支撑。");
  }
  if (/985|211|硕士|研究生/.test(markdown)) {
    risks.push("出现学历相关敏感表述，请确认与真实背景一致。");
  }
  if (/公司|实习生/.test(markdown) && /202[0-9]\./.test(markdown)) {
    risks.push("出现实习公司或时间线，请确认不是为匹配 JD 虚构。");
  }
  return risks;
}

function localResume(parsedJD: ParsedJD, assets: ProfileAsset[], targetJob: string): ResumeVersion {
  const skills = Array.from(new Set([...parsedJD.hardSkills, ...parsedJD.tools, "需求分析", "文档表达"])).slice(0, 10);
  const projectBullets = assets.map((asset) => `- **${asset.title}**：${asset.content}`).join("\n");
  const markdown = [
    `# 刘帅｜${targetJob}`,
    "",
    "## 核心技能",
    skills.length ? skills.map((skill) => `- ${skill}`).join("\n") : "- SQL / Excel / Python / PRD / AI 工具应用",
    "",
    "## 匹配项目",
    projectBullets || "- 请补充一个与岗位相关的真实项目。",
    "",
    "## JD 匹配表达",
    `- 能围绕岗位中的「${parsedJD.keywords.slice(0, 5).join("、") || "业务理解、数据分析、AI应用"}」要求组织项目表达。`,
    "- 可在面试中重点讲清问题背景、分析过程、工具选择、结果复盘。"
  ].join("\n");

  return {
    targetJob,
    resumeMarkdown: markdown,
    matchScore: Math.min(92, 58 + parsedJD.keywords.length * 4 + assets.length * 5),
    risks: reviewRisk(markdown),
    interviewQuestions: [
      "这个项目的数据来源是什么，如何保证指标口径一致？",
      "如果让你把 AI 能力接到真实业务流程里，你会先选哪个场景？",
      "你在项目里具体负责哪些部分，哪些是工具辅助完成的？"
    ]
  };
}
