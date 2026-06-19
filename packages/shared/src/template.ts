import type { GreetingTemplate, JobCard, Profile, ProfileItem } from "./index.js";

export type SelectedProfileItems = {
  skills: ProfileItem[];
  projects: ProfileItem[];
  selfIntro: string;
};

export function selectProfileItems(
  profile: Profile,
  keywords: string[],
  limits: { maxSkills: number; maxProjects: number }
): SelectedProfileItems {
  const rankedItems = profile.items
    .map((item, index) => ({
      item,
      index,
      score: scoreProfileItem(item, keywords)
    }))
    .filter(({ item, score }) => item.enabled && score > 0);

  const skills = rankedItems
    .filter(({ item }) => item.category === "skill")
    .sort(compareRankedItems)
    .slice(0, limits.maxSkills)
    .sort((left, right) => left.index - right.index)
    .map(({ item }) => item);

  const projects = rankedItems
    .filter(({ item }) => item.category === "project")
    .sort(compareRankedItems)
    .slice(0, limits.maxProjects)
    .sort((left, right) => left.index - right.index)
    .map(({ item }) => item);

  const selfIntro =
    profile.items.find((item) => item.enabled && item.category === "intro")?.content ?? "";

  return {
    skills,
    projects,
    selfIntro
  };
}

export function renderGreeting(input: {
  template: GreetingTemplate;
  job: JobCard;
  profile: Profile;
  selectedItems: SelectedProfileItems;
  matchedRequirements: string[];
}): string {
  const { template, job, profile, selectedItems, matchedRequirements } = input;
  const variables: Record<string, string> = {
    jobTitle: job.title,
    company: job.company,
    matchedRequirements: matchedRequirements.join("，"),
    school: profile.school,
    major: profile.major,
    graduation: profile.graduation,
    skills: selectedItems.skills.map((item) => item.content).join("；"),
    projects: selectedItems.projects.map((item) => item.content).join("；"),
    selfIntro: selectedItems.selfIntro
  };

  const rendered = collapseWhitespace(
    template.body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
      return variables[key] ?? "";
    })
  );

  const bannedPhrase = template.bannedPhrases.find((phrase) =>
    includesIgnoreCase(rendered, phrase)
  );
  if (bannedPhrase) {
    throw new Error(`命中禁用表达：${bannedPhrase}`);
  }

  if (rendered.length < template.minLength || rendered.length > template.maxLength) {
    throw new Error("生成话术长度不符合要求");
  }

  return rendered;
}

function scoreProfileItem(item: ProfileItem, keywords: string[]): number {
  const haystacks = [...item.tags, item.content];
  return keywords.reduce((score, keyword) => {
    return haystacks.some((entry) => includesIgnoreCase(entry, keyword)) ? score + 1 : score;
  }, 0);
}

function compareRankedItems(
  left: { index: number; score: number },
  right: { index: number; score: number }
): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  return left.index - right.index;
}

function includesIgnoreCase(source: string, candidate: string): boolean {
  return normalizeForMatch(source).includes(normalizeForMatch(candidate));
}

function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function normalizeForMatch(input: string): string {
  return input.normalize("NFKC").toLocaleLowerCase();
}
