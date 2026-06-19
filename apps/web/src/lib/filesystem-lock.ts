import { randomUUID } from "node:crypto";
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
  isProcessAlive?: (pid: number) => boolean | Promise<boolean>;
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
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const retryDelayMs = options.retryDelayMs ?? 25;
  const staleMs = options.staleMs ?? 30_000;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const startedAt = Date.now();
  const owner = createOwnerMetadata();

  await fileOps.mkdir(path.dirname(lockPath), { recursive: true });

  while (true) {
    try {
      await fileOps.mkdir(lockPath);
      try {
        await writeOwnerMetadata(lockPath, fileOps, owner);
      } catch (error) {
        await releaseOwnedLock(lockPath, owner, fileOps).catch(() => undefined);
        throw error;
      }

      try {
        return await action();
      } finally {
        await releaseOwnedLock(lockPath, owner, fileOps).catch(() => undefined);
      }
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }

      const reclaimable = await shouldReclaimLock(lockPath, staleMs, fileOps, isProcessAlive);
      if (reclaimable) {
        const quarantined = await quarantineLock(lockPath, fileOps);
        if (quarantined) {
          continue;
        }
      }

      if (Date.now() - startedAt >= timeoutMs) {
        throw new FilesystemLockTimeoutError(lockPath, timeoutMs);
      }

      await delay(retryDelayMs);
    }
  }
}

type LockOwnerMetadata = {
  pid: number;
  token: string;
  acquiredAt: string;
};

function createOwnerMetadata(): LockOwnerMetadata {
  return {
    pid: process.pid,
    token: randomUUID(),
    acquiredAt: new Date().toISOString()
  };
}

async function writeOwnerMetadata(
  lockPath: string,
  fileOps: FileOps,
  owner: LockOwnerMetadata
): Promise<void> {
  await fileOps.writeFile(path.join(lockPath, "owner.json"), `${JSON.stringify(owner, null, 2)}\n`, "utf8");
}

async function shouldReclaimLock(
  lockPath: string,
  staleMs: number,
  fileOps: FileOps,
  isProcessAlive: (pid: number) => boolean | Promise<boolean>
): Promise<boolean> {
  const owner = await readOwnerMetadata(lockPath, fileOps);

  if (owner) {
    return !(await isProcessAlive(owner.pid));
  }

  return isLockDirectoryStale(lockPath, staleMs, fileOps);
}

async function quarantineLock(lockPath: string, fileOps: FileOps): Promise<boolean> {
  const quarantinePath = `${lockPath}.quarantine-${process.pid}-${Date.now()}-${randomUUID()}`;

  try {
    await fileOps.rename(lockPath, quarantinePath);
  } catch (error) {
    if (isMissingFileError(error) || isAlreadyExistsError(error)) {
      return false;
    }
    throw error;
  }

  await fileOps.rm(quarantinePath, { recursive: true, force: true }).catch(() => undefined);
  return true;
}

async function releaseOwnedLock(lockPath: string, owner: LockOwnerMetadata, fileOps: FileOps): Promise<void> {
  const currentOwner = await readOwnerMetadata(lockPath, fileOps);
  if (!currentOwner || currentOwner.token !== owner.token) {
    return;
  }

  const releasePath = `${lockPath}.release-${process.pid}-${Date.now()}-${randomUUID()}`;

  try {
    await fileOps.rename(lockPath, releasePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }
    throw error;
  }

  await fileOps.rm(releasePath, { recursive: true, force: true }).catch(() => undefined);
}

async function readOwnerMetadata(lockPath: string, fileOps: FileOps): Promise<LockOwnerMetadata | null> {
  try {
    const raw = await fileOps.readFile(path.join(lockPath, "owner.json"), "utf8");
    return parseOwnerMetadata(raw);
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

function parseOwnerMetadata(raw: string): LockOwnerMetadata | null {
  try {
    const parsed = JSON.parse(raw) as Partial<LockOwnerMetadata>;
    if (
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.token === "string" &&
      parsed.token.length > 0 &&
      typeof parsed.acquiredAt === "string" &&
      parsed.acquiredAt.length > 0
    ) {
      return {
        pid: parsed.pid,
        token: parsed.token,
        acquiredAt: parsed.acquiredAt
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function isLockDirectoryStale(lockPath: string, staleMs: number, fileOps: FileOps): Promise<boolean> {
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

async function defaultIsProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      if (error.code === "EPERM") {
        return true;
      }
      if (error.code === "ESRCH") {
        return false;
      }
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
