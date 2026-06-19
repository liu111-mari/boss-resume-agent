import { mkdir } from "node:fs/promises";
import path from "node:path";

import * as properLockfile from "proper-lockfile";

type ProperLockRetries = NonNullable<properLockfile.LockOptions["retries"]>;

export type FilesystemLockOptions = {
  lockType?: "file" | "directory";
  staleMs?: number;
  updateMs?: number;
  retries?: ProperLockRetries;
};

export class FilesystemLockTimeoutError extends Error {
  constructor(public readonly targetPath: string) {
    super(`Timed out waiting for filesystem lock: ${targetPath}`);
    this.name = "FilesystemLockTimeoutError";
  }
}

export class FilesystemLockCompromisedError extends Error {
  constructor(
    public readonly targetPath: string,
    cause: unknown
  ) {
    super(`Filesystem lock was compromised: ${targetPath}`, { cause });
    this.name = "FilesystemLockCompromisedError";
  }
}

const defaultRetries: ProperLockRetries = {
  retries: 50,
  factor: 1,
  minTimeout: 20,
  maxTimeout: 100
};

export async function withFilesystemLock<T>(
  targetPath: string,
  action: () => Promise<T>,
  options: FilesystemLockOptions = {}
): Promise<T> {
  const lockType = options.lockType ?? "file";

  if (lockType === "directory") {
    await mkdir(targetPath, { recursive: true });
  } else {
    await mkdir(path.dirname(targetPath), { recursive: true });
  }

  let release: (() => Promise<void>) | undefined;
  try {
    release = await properLockfile.lock(targetPath, {
      realpath: false,
      stale: options.staleMs ?? 30_000,
      update: options.updateMs ?? 10_000,
      retries: options.retries ?? defaultRetries,
      onCompromised(error) {
        throw new FilesystemLockCompromisedError(targetPath, error);
      }
    });
  } catch (error) {
    throw normalizeLockError(targetPath, error);
  }

  try {
    return await action();
  } finally {
    try {
      await release();
    } catch (error) {
      throw normalizeLockError(targetPath, error);
    }
  }
}

function normalizeLockError(targetPath: string, error: unknown): Error {
  if (error instanceof FilesystemLockCompromisedError || error instanceof FilesystemLockTimeoutError) {
    return error;
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "ELOCKED") {
      return new FilesystemLockTimeoutError(targetPath);
    }
    if (error.code === "ECOMPROMISED") {
      return new FilesystemLockCompromisedError(targetPath, error);
    }
  }

  return error instanceof Error ? error : new Error(String(error));
}
