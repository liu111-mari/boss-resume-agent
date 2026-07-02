import type { GreetingTask } from "@boss-agent/shared";

type NumberParseSuccess<T> = {
  ok: true;
  value: T;
};

type NumberParseFailure = {
  ok: false;
  message: string;
};

export type NumberParseResult<T> = NumberParseSuccess<T> | NumberParseFailure;

export function isApprovableTask(task: GreetingTask): boolean {
  return task.status === "pending_review" || task.status === "paused";
}

export function reconcileSelectedTaskIds(tasks: GreetingTask[], selected: string[]): string[] {
  const approvableIds = new Set(
    tasks.filter(isApprovableTask).map((task) => task.id)
  );

  return selected.filter((taskId) => approvableIds.has(taskId));
}

export function parseNullableNumberDraft(input: string): NumberParseResult<number | null> {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: true, value: null };
  }

  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, message: "请输入有效数字" };
  }

  return { ok: true, value };
}

export function parseRequiredNumberDraft(input: string): NumberParseResult<number> {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, message: "该字段不能为空" };
  }

  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, message: "请输入有效数字" };
  }

  if (!Number.isInteger(value)) {
    return { ok: false, message: "请输入整数" };
  }

  return { ok: true, value };
}
