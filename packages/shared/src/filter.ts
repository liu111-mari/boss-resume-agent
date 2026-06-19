import type { FilterConfig, JobCard } from "./index.js";

export type HardFilterResult = {
  accepted: boolean;
  reasons: string[];
};

type SalaryUnit = "day" | "month";

type SalaryRange = {
  min: number;
  max: number;
  unit: SalaryUnit;
};

export function evaluateJob(job: JobCard, config: FilterConfig): HardFilterResult {
  const blockedCompany = findFirstMatch(job.company, config.blockedCompanies);
  if (blockedCompany) {
    return reject(`命中屏蔽公司：${blockedCompany}`);
  }

  const blockedIndustry = findFirstMatch(job.industry, config.blockedIndustries);
  if (blockedIndustry) {
    return reject(`命中屏蔽行业：${blockedIndustry}`);
  }

  const excludedKeyword = findFirstMatch(
    `${job.title} ${job.jdText} ${job.rawText}`,
    config.excludedKeywords
  );
  if (excludedKeyword) {
    return reject(`命中排除关键词：${excludedKeyword}`);
  }

  if (
    config.targetTitles.length > 0 &&
    !config.targetTitles.some((title) => includesIgnoreCase(job.title, title))
  ) {
    return reject(`岗位名称不匹配：${job.title}`);
  }

  if (
    config.cities.length > 0 &&
    !config.cities.some((city) => includesIgnoreCase(job.city, city))
  ) {
    return reject(`城市不匹配：${job.city}`);
  }

  const requiredKeyword = config.requiredKeywords.find(
    (keyword) =>
      !includesIgnoreCase(`${job.title} ${job.jdText} ${job.rawText}`, keyword)
  );
  if (requiredKeyword) {
    return reject(`缺少必需关键词：${requiredKeyword}`);
  }

  if (
    config.allowedExperience.length > 0 &&
    !config.allowedExperience.some((item) => includesIgnoreCase(job.experience, item))
  ) {
    return reject(`经验要求不匹配：${job.experience}`);
  }

  if (
    config.allowedEducation.length > 0 &&
    !config.allowedEducation.some((item) => includesIgnoreCase(job.education, item))
  ) {
    return reject(`学历要求不匹配：${job.education}`);
  }

  const salaryReasons: string[] = [];
  const parsedSalary = parseSalaryRange(job.salary);
  const needsSalaryCheck = config.minSalary !== null || config.maxSalary !== null;
  if (needsSalaryCheck) {
    if (!parsedSalary) {
      salaryReasons.push("薪资未识别");
    } else {
      if (parsedSalary.unit !== config.salaryUnit) {
        return reject(`薪资单位不匹配：${job.salary}`);
      }

      const expectedMin = config.minSalary ?? Number.NEGATIVE_INFINITY;
      const expectedMax = config.maxSalary ?? Number.POSITIVE_INFINITY;
      if (parsedSalary.max < expectedMin || parsedSalary.min > expectedMax) {
        return reject(`薪资范围不匹配：${job.salary}`);
      }
    }
  }

  return {
    accepted: true,
    reasons: salaryReasons
  };
}

function reject(reason: string): HardFilterResult {
  return {
    accepted: false,
    reasons: [reason]
  };
}

function includesIgnoreCase(source: string, candidate: string): boolean {
  return normalizeForMatch(source).includes(normalizeForMatch(candidate));
}

function findFirstMatch(source: string, candidates: string[]): string | null {
  return candidates.find((candidate) => includesIgnoreCase(source, candidate)) ?? null;
}

function parseSalaryRange(input: string): SalaryRange | null {
  const normalized = normalizeForMatch(input).replace(/\s+/g, "");
  if (!normalized) {
    return null;
  }

  const dayMatch = normalized.match(
    /^(\d+(?:\.\d+)?)[\-–—－~～至](\d+(?:\.\d+)?)元\/天$/i
  );
  if (dayMatch) {
    return {
      min: Number(dayMatch[1]),
      max: Number(dayMatch[2]),
      unit: "day"
    };
  }

  const monthMatch = normalized.match(
    /^(\d+(?:\.\d+)?)[\-–—－~～至](\d+(?:\.\d+)?)k(?:·\d+薪)?$/i
  );
  if (monthMatch) {
    return {
      min: Number(monthMatch[1]) * 1000,
      max: Number(monthMatch[2]) * 1000,
      unit: "month"
    };
  }

  return null;
}

function normalizeForMatch(input: string): string {
  return input.normalize("NFKC").toLocaleLowerCase();
}
