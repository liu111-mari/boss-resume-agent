import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ZodType } from "zod";

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function createSafeTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function ensureParentDirectory(filename: string): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true });
}

export class JsonRepository<T> {
  private readonly defaultValue: T;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly filename: string,
    private readonly schema: ZodType<T>,
    defaultValue: T
  ) {
    this.defaultValue = deepClone(this.schema.parse(defaultValue));
  }

  async read(): Promise<T> {
    await ensureParentDirectory(this.filename);

    let content: string;
    try {
      content = await readFile(this.filename, "utf8");
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
  }

  async write(value: T): Promise<T> {
    const operation = this.writeChain.then(() => this.performWrite(value));
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  private async performWrite(value: T): Promise<T> {
    const parsed = this.schema.parse(value);
    const cloned = deepClone(parsed);
    const directory = path.dirname(this.filename);
    const tempFilename = path.join(
      directory,
      `${path.basename(this.filename)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );

    await ensureParentDirectory(this.filename);
    await writeFile(tempFilename, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

    try {
      await replaceFileSafely(tempFilename, this.filename);
    } catch (error) {
      await rm(tempFilename, { force: true }).catch(() => undefined);
      throw error;
    }

    return cloned;
  }

  private async backupCorruptFile(): Promise<void> {
    const corruptFilename = `${this.filename}.corrupt-${createSafeTimestamp()}`;
    await rename(this.filename, corruptFilename);
  }
}

async function replaceFileSafely(source: string, target: string): Promise<void> {
  try {
    if (process.platform !== "win32") {
      await rename(source, target);
      return;
    }

    await readFile(target);
  } catch (error) {
    if (isMissingFileError(error)) {
      await rename(source, target);
      return;
    }

    if (process.platform !== "win32") {
      throw error;
    }
  }

  const backup = `${target}.replace-backup-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  await copyFile(target, backup);

  try {
    await copyFile(source, target);
    await rm(source, { force: true });
    await rm(backup, { force: true });
  } catch (error) {
    await copyFile(backup, target).catch(() => undefined);
    await rm(source, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await rm(backup, { force: true }).catch(() => undefined);
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
