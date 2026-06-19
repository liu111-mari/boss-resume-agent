import path from "node:path";

import type { ZodType } from "zod";
import { defaultFileOps, type FileOps, withFilesystemLock } from "@/lib/filesystem-lock";

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
  private readonly lockPath: string;
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
    this.lockPath = `${this.resolvedFilename}.lock`;
  }

  async read(): Promise<T> {
    return this.enqueue(() =>
      withFilesystemLock(this.lockPath, async () => {
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
      }, { fileOps: this.fileOps })
    );
  }

  async write(value: T): Promise<T> {
    return this.enqueue(() => withFilesystemLock(this.lockPath, () => this.performWrite(value), { fileOps: this.fileOps }));
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

    const backup = `${target}.replace-backup-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await this.fileOps.rename(target, backup);

    try {
      await this.fileOps.rename(source, target);
    } catch (error) {
      await this.restoreBackup(backup, target);
      throw error;
    }

    await this.fileOps.rm(backup, { force: true });
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
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
