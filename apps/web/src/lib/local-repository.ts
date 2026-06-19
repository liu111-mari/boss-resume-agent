import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ZodType } from "zod";
import { withFilesystemLock } from "@/lib/filesystem-lock";

type FileOps = {
  mkdir: typeof mkdir;
  readFile: typeof readFile;
  readdir: typeof readdir;
  rename: typeof rename;
  rm: typeof rm;
  stat: typeof stat;
  writeFile: typeof writeFile;
};

type ResidualBackup = {
  path: string;
  name: string;
  mtimeMs: number;
  parsedName: {
    epochMs: number;
    hrtimeNs: bigint;
  } | null;
};

const defaultFileOps: FileOps = {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
};

const fileOperationQueues = new Map<string, Promise<unknown>>();

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function createSafeTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function ensureParentDirectory(filename: string, fileOps: FileOps): Promise<void> {
  await fileOps.mkdir(path.dirname(filename), { recursive: true });
}

export class JsonRepository<T> {
  private readonly defaultValue: T;
  private readonly resolvedFilename: string;

  constructor(
    private readonly filename: string,
    private readonly schema: ZodType<T>,
    defaultValue: T,
    private readonly fileOps: FileOps = defaultFileOps,
    private readonly platformProvider: () => NodeJS.Platform = () => process.platform
  ) {
    this.defaultValue = deepClone(this.schema.parse(defaultValue));
    this.resolvedFilename = path.resolve(filename);
  }

  async read(): Promise<T> {
    return this.enqueue(() =>
      withFilesystemLock(this.resolvedFilename, async () => {
        await this.recoverOrCleanupResidualBackups();
        await ensureParentDirectory(this.filename, this.fileOps);

        let content: string;
        try {
          content = await this.fileOps.readFile(this.filename, "utf8");
        } catch (error) {
          if (isMissingFileError(error)) {
            return deepClone(this.defaultValue);
          }
          throw error;
        }

        try {
          return deepClone(this.schema.parse(JSON.parse(content) as unknown));
        } catch (error) {
          await this.backupCorruptFile();
          throw new Error(`配置文件损坏：${this.filename}`, { cause: error });
        }
      })
    );
  }

  async write(value: T): Promise<T> {
    return this.enqueue(() =>
      withFilesystemLock(this.resolvedFilename, async () => {
        await this.recoverOrCleanupResidualBackups();
        return this.performWrite(value);
      })
    );
  }

  private async performWrite(value: T): Promise<T> {
    const parsed = this.schema.parse(value);
    const cloned = deepClone(parsed);
    const directory = path.dirname(this.filename);
    const tempFilename = path.join(
      directory,
      `${path.basename(this.filename)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );

    await ensureParentDirectory(this.filename, this.fileOps);
    await this.fileOps.writeFile(tempFilename, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

    try {
      await this.replaceFileSafely(tempFilename, this.filename);
    } catch (error) {
      await this.fileOps.rm(tempFilename, { force: true }).catch(() => undefined);
      throw error;
    }

    return cloned;
  }

  private async backupCorruptFile(): Promise<void> {
    const corruptFilename = `${this.filename}.corrupt-${createSafeTimestamp()}`;
    await this.fileOps.rename(this.filename, corruptFilename);
  }

  private enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const previous = fileOperationQueues.get(this.resolvedFilename) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    fileOperationQueues.set(
      this.resolvedFilename,
      next.then(
        () => undefined,
        () => undefined
      )
    );
    return next;
  }

  private async replaceFileSafely(source: string, target: string): Promise<void> {
    if (this.platformProvider() !== "win32") {
      await this.fileOps.rename(source, target);
      return;
    }

    const targetExists = await this.fileOps
      .stat(target)
      .then(() => true)
      .catch((error: unknown) => {
        if (isMissingFileError(error)) return false;
        throw error;
      });

    if (!targetExists) {
      await this.fileOps.rename(source, target);
      return;
    }

    const backup = path.join(
      path.dirname(target),
      `${path.basename(target)}.replace-backup-${Date.now()}-${process.hrtime.bigint()}-${randomUUID()}`
    );
    await this.fileOps.rename(target, backup);

    try {
      await this.fileOps.rename(source, target);
    } catch (error) {
      await this.restoreBackup(backup, target);
      throw error;
    }

    await this.fileOps.rm(backup, { force: true }).catch(() => undefined);
  }

  private async restoreBackup(backup: string, target: string): Promise<void> {
    try {
      await this.fileOps.rename(backup, target);
    } catch (restoreError) {
      await this.fileOps.rm(target, { force: true }).catch(() => undefined);
      await this.fileOps.rename(backup, target).catch(() => undefined);
      throw restoreError;
    }
  }

  private async recoverOrCleanupResidualBackups(): Promise<void> {
    const directory = path.dirname(this.filename);
    const backups = await this.listResidualBackups(directory);
    if (backups.length === 0) {
      return;
    }

    const current = await this.tryReadAndParse(this.filename);
    if (current.status === "missing") {
      const restored = await this.tryRestoreFromBackups(backups);
      if (!restored) {
        throw new Error(`配置文件损坏，且无法恢复：${this.filename}`);
      }
      await this.cleanupBackupFiles(backups.filter((backup) => backup.path !== restored.path).map((backup) => backup.path));
      return;
    }

    if (current.status === "valid") {
      await this.cleanupBackupFiles(backups.map((backup) => backup.path));
      return;
    }

    const restored = await this.tryRestoreFromBackups(backups, async () => {
      await this.backupCorruptFile();
    });
    if (!restored) {
      await this.backupCorruptFile();
      throw new Error(`配置文件损坏，且无法恢复：${this.filename}`);
    }
    await this.cleanupBackupFiles(backups.filter((backup) => backup.path !== restored.path).map((backup) => backup.path));
  }

  private async listResidualBackups(directory: string): Promise<ResidualBackup[]> {
    const prefix = `${path.basename(this.filename)}.replace-backup-`;
    const entries = await this.fileOps.readdir(directory).catch((error: unknown) => {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    });

    const backups: ResidualBackup[] = [];
    for (const entry of entries) {
      if (!entry.startsWith(prefix)) continue;
      const fullPath = path.join(directory, entry);
      try {
        const fileStat = await this.fileOps.stat(fullPath);
        backups.push({
          path: fullPath,
          name: entry,
          mtimeMs: fileStat.mtimeMs,
          parsedName: parseResidualBackupName(entry, prefix)
        });
      } catch (error) {
        if (!isMissingFileError(error)) {
          throw error;
        }
      }
    }

    backups.sort((left, right) => {
      if (left.parsedName && right.parsedName) {
        if (left.parsedName.epochMs !== right.parsedName.epochMs) {
          return right.parsedName.epochMs - left.parsedName.epochMs;
        }
        if (left.parsedName.hrtimeNs !== right.parsedName.hrtimeNs) {
          return right.parsedName.hrtimeNs > left.parsedName.hrtimeNs ? 1 : -1;
        }
      } else if (left.mtimeMs !== right.mtimeMs) {
        return right.mtimeMs - left.mtimeMs;
      }
      return right.name.localeCompare(left.name);
    });

    return backups;
  }

  private async tryRestoreFromBackups(
    backups: ResidualBackup[],
    beforeRestore?: () => Promise<void>
  ): Promise<ResidualBackup | null> {
    for (const backup of backups) {
      const parsed = await this.tryReadAndParse(backup.path);
      if (parsed.status !== "valid") {
        continue;
      }

      if (beforeRestore) {
        await beforeRestore();
      }
      await this.fileOps.rename(backup.path, this.filename);
      return backup;
    }

    return null;
  }

  private async tryReadAndParse(filename: string): Promise<{ status: "missing" | "invalid" | "valid"; value?: T }> {
    let content: string;
    try {
      content = await this.fileOps.readFile(filename, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        return { status: "missing" };
      }
      throw error;
    }

    try {
      return {
        status: "valid",
        value: this.schema.parse(JSON.parse(content) as unknown)
      };
    } catch {
      return { status: "invalid" };
    }
  }

  private async cleanupBackupFiles(paths: string[]): Promise<void> {
    for (const fullPath of paths) {
      await this.tryRemoveResidualBackup(fullPath);
    }
  }

  private async tryRemoveResidualBackup(fullPath: string): Promise<void> {
    const retryDelays = [10, 25, 50];

    for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
      try {
        await this.fileOps.rm(fullPath, { force: true });
        return;
      } catch {
        await delay(retryDelays[attempt]);
      }
    }
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseResidualBackupName(name: string, prefix: string): { epochMs: number; hrtimeNs: bigint } | null {
  const suffix = name.slice(prefix.length);
  const firstDash = suffix.indexOf("-");
  if (firstDash <= 0) {
    return null;
  }

  const secondDash = suffix.indexOf("-", firstDash + 1);
  if (secondDash <= firstDash + 1) {
    return null;
  }

  const epochMsRaw = suffix.slice(0, firstDash);
  const hrtimeRaw = suffix.slice(firstDash + 1, secondDash);
  const uuidRaw = suffix.slice(secondDash + 1);

  if (!/^\d+$/.test(epochMsRaw) || !/^\d+$/.test(hrtimeRaw) || uuidRaw.length === 0) {
    return null;
  }

  return {
    epochMs: Number(epochMsRaw),
    hrtimeNs: BigInt(hrtimeRaw)
  };
}
