import type { JobCard } from "@boss-agent/shared";

const salaryPattern = /\d{2,4}-\d{2,4}元\/天|\d{1,3}-\d{1,3}[Kk](?:·\d+薪)?|\d+元\/天/;

export function decodeBossText(value: string): string {
  return value.replace(/[\uE031-\uE03A]/g, (character) =>
    String(character.charCodeAt(0) - 0xE031)
  );
}

export function resolveJobSalary(job: JobCard): string {
  if (job.salary.trim()) return decodeBossText(job.salary.trim());
  return decodeBossText(job.jdText).match(salaryPattern)?.[0] ?? "";
}

export function resolveJobDescription(job: JobCard): string {
  const decoded = decodeBossText(job.jdText)
    .replaceAll("来自BOSS直聘", "")
    .replace(/\s+/g, " ")
    .trim();
  if (!decoded) return "";
  if (job.jdSource === "detail") return decoded;

  let summary = decoded;
  for (const value of [job.title, job.company, job.city, resolveJobSalary(job)]) {
    if (value) summary = summary.replaceAll(value, " ");
  }
  summary = summary
    .replace(salaryPattern, " ")
    .replace(/\d+天\/周|\d+个月|在校\/应届|本科|硕士|博士|大专/g, " ")
    .replace(/[·•]+[^，。；]{0,18}$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return summary.length >= 16 ? summary : "";
}

export function findMatchedTerms(text: string, terms: string[]): string[] {
  const normalized = text.toLocaleLowerCase("zh-CN");
  return Array.from(new Set(terms.map((term) => term.trim()).filter((term) =>
    term && normalized.includes(term.toLocaleLowerCase("zh-CN"))
  )));
}
