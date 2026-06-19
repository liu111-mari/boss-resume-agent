import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type FileOps = {
  mkdir: typeof mkdir;
  readFile: typeof readFile;
  rename: typeof rename;
  rm: typeof rm;
  stat: typeof stat;
  writeFile: typeof writeFile;
};

export type FilesystemLockOptions = {
  fileOps?: FileOps;
  ownerMetadata?: Record<string, unknown>;
  retryDelayMs?: number;
  staleMs?: number;
  timeoutMs?: number;
};

export const defaultFileOps: FileOps = {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
};

export class FilesystemLockTimeoutError extends Error {
  constructor(
    public readonly lockPath: string,
    public readonly timeoutMs: number
  ) {
    super(`Timed out waiting for filesystem lock: ${lockPath}`);
    this.name = "FilesystemLockTimeoutError";
  }
}

export async function withFilesystemLock<T>(
  lockPath: string,
  action: () => Promise<T>,
  options: FilesystemLockOptions = {}
): Promise<T> {
  const fileOps = options.fileOps ?? defaultFileOps;
  const retryDelayMs = options.retryDelayMs ?? 25;
  const staleMs = options.staleMs ?? 30_000;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const startedAt = Date.now();

  await fileOps.mkdir(path.dirname(lockPath), { recursive: true });

  while (true) {
    try {
      await fileOps.mkdir(lockPath);
      await writeOwnerMetadata(lockPath, fileOps, options.ownerMetadata);
      try {
        return await action();
      } finally {
        await fileOps.rm(lockPath, { recursive: true, force: true });
      }
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }

      const stale = await isStaleLock(lockPath, staleMs, fileOps);
      if (stale) {
        await fileOps.rm(lockPath, { recursive: true, force: true });
        continue;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        throw new FilesystemLockTimeoutError(lockPath, timeoutMs);
      }

      await delay(retryDelayMs);
    }
  }
}

async function writeOwnerMetadata(
  lockPath: string,
  fileOps: FileOps,
  ownerMetadata: Record<string, unknown> | undefined
): Promise<void> {
  if (!ownerMetadata) {
    return;
  }

  const payload = {
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    ...ownerMetadata
  };
  await fileOps
    .writeFile(path.join(lockPath, "owner.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    .catch(() => undefined);
}

async function isStaleLock(lockPath: string, staleMs: number, fileOps: FileOps): Promise<boolean> {
  try {
    const stats = await fileOps.stat(lockPath);
    return Date.now() - stats.mtimeMs > staleMs;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
