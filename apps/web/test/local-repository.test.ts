import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { JsonRepository } from "@/lib/local-repository";

const sampleSchema = z.object({
  version: z.number().int().nonnegative(),
  nested: z.object({
    label: z.string()
  })
});

describe("JsonRepository", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  async function createRepo(defaultValue = { version: 0, nested: { label: "default" } }) {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-local-repository-"));
    return new JsonRepository(path.join(tempDir, "state.json"), sampleSchema, defaultValue);
  }

  it("persists writes and reads them back from disk", async () => {
    const repo = await createRepo();

    await repo.write({ version: 1, nested: { label: "saved" } });

    await expect(repo.read()).resolves.toEqual({
      version: 1,
      nested: { label: "saved" }
    });
    await expect(readFile(path.join(tempDir, "state.json"), "utf8")).resolves.toContain('"version": 1');
  });

  it("returns deep-cloned defaults and stored values", async () => {
    const repo = await createRepo();

    const firstDefault = await repo.read();
    firstDefault.nested.label = "mutated";

    await expect(repo.read()).resolves.toEqual({
      version: 0,
      nested: { label: "default" }
    });

    await repo.write({ version: 2, nested: { label: "stored" } });
    const firstStored = await repo.read();
    firstStored.nested.label = "changed";

    await expect(repo.read()).resolves.toEqual({
      version: 2,
      nested: { label: "stored" }
    });
  });

  it("backs up corrupt json files instead of silently resetting", async () => {
    const repo = await createRepo();
    const filename = path.join(tempDir, "state.json");
    await writeFile(filename, "{not valid json", "utf8");

    await expect(repo.read()).rejects.toThrow("配置文件损坏");

    await expect(readdir(tempDir)).resolves.toEqual(
      expect.arrayContaining([expect.stringMatching(/^state\.json\.corrupt-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/)])
    );
    await expect(readdir(tempDir)).resolves.not.toContain("state.json");
  });

  it("backs up schema-invalid files and preserves the original bytes", async () => {
    const repo = await createRepo();
    const filename = path.join(tempDir, "state.json");
    const invalidPayload = JSON.stringify({ version: "wrong", nested: { label: "x" } });
    await writeFile(filename, invalidPayload, "utf8");

    await expect(repo.read()).rejects.toThrow("配置文件损坏");

    const files = await readdir(tempDir);
    const backupName = files.find((file) => /^state\.json\.corrupt-/.test(file));
    expect(backupName).toBeTruthy();
    await expect(readFile(path.join(tempDir, backupName!), "utf8")).resolves.toBe(invalidPayload);
  });

  it("serializes concurrent writes so the last call wins", async () => {
    const repo = await createRepo();

    await Promise.all([
      repo.write({ version: 1, nested: { label: "first" } }),
      repo.write({ version: 2, nested: { label: "second" } }),
      repo.write({ version: 3, nested: { label: "third" } })
    ]);

    await expect(repo.read()).resolves.toEqual({
      version: 3,
      nested: { label: "third" }
    });
  });

  it("keeps the write queue usable after a failed write", async () => {
    const repo = await createRepo();
    const filename = path.join(tempDir, "state.json");

    await repo.write({ version: 1, nested: { label: "good" } });
    const initialBytes = await readFile(filename, "utf8");

    await expect(repo.write({ version: -1, nested: { label: "bad" } })).rejects.toThrow();

    await repo.write({ version: 2, nested: { label: "recovered" } });

    await expect(repo.read()).resolves.toEqual({
      version: 2,
      nested: { label: "recovered" }
    });
    expect(await readFile(filename, "utf8")).not.toBe(initialBytes);
  });

  it("shares one queue across repository instances for the same file so reads do not observe replacement gaps", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-local-repository-"));
    const filename = path.join(tempDir, "state.json");
    await writeFile(filename, JSON.stringify({ version: 0, nested: { label: "initial" } }), "utf8");

    let allowSecondRename!: () => void;
    const secondRenameStarted = new Promise<void>((resolve) => {
      allowSecondRename = resolve;
    });

    const releaseSecondRename = new Promise<void>((resolve) => {
      secondRenameStarted.then(resolve);
    });

    const delayedFileOps = {
      mkdir,
      readFile,
      writeFile,
      rm,
      stat,
      async rename(source: Parameters<typeof rename>[0], target: Parameters<typeof rename>[1]) {
        const sourcePath = String(source);
        const targetPath = String(target);
        const basename = path.basename(sourcePath);
        if (basename.includes(".tmp-") && path.basename(targetPath) === "state.json") {
          await releaseSecondRename;
        }
        return rename(source, target);
      }
    };

    const writer = new JsonRepository(filename, sampleSchema, { version: 0, nested: { label: "default" } }, delayedFileOps);
    const reader = new JsonRepository(filename, sampleSchema, { version: 0, nested: { label: "default" } }, delayedFileOps);

    const writePromise = writer.write({ version: 1, nested: { label: "updated" } });
    const readPromise = reader.read();

    allowSecondRename();

    await expect(readPromise).resolves.toEqual({
      version: 1,
      nested: { label: "updated" }
    });
    await expect(writePromise).resolves.toEqual({
      version: 1,
      nested: { label: "updated" }
    });

    const files = await readdir(tempDir);
    expect(files.filter((file) => file.includes(".corrupt-"))).toEqual([]);
  });

  it("keeps the shared filename queue usable after a failed operation from another instance", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-local-repository-"));
    const filename = path.join(tempDir, "state.json");
    const first = new JsonRepository(filename, sampleSchema, { version: 0, nested: { label: "default" } });
    const second = new JsonRepository(filename, sampleSchema, { version: 0, nested: { label: "default" } });

    await first.write({ version: 1, nested: { label: "good" } });
    await expect(first.write({ version: -1, nested: { label: "bad" } })).rejects.toThrow();

    await second.write({ version: 2, nested: { label: "recovered" } });

    await expect(second.read()).resolves.toEqual({
      version: 2,
      nested: { label: "recovered" }
    });
    await expect(first.read()).resolves.toEqual({
      version: 2,
      nested: { label: "recovered" }
    });
  });

  it("restores the original target if replacement fails after target was moved to backup", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-local-repository-"));
    const filename = path.join(tempDir, "state.json");
    await writeFile(filename, JSON.stringify({ version: 1, nested: { label: "stable" } }), "utf8");

    let renameCallCount = 0;
    const injectedOps = {
      mkdir,
      readFile,
      writeFile,
      rm,
      stat,
      async rename(source: Parameters<typeof rename>[0], target: Parameters<typeof rename>[1]) {
        renameCallCount += 1;
        if (renameCallCount === 2) {
          throw new Error("rename temp -> target failed");
        }
        return rename(source, target);
      }
    };

    const repo = new JsonRepository(filename, sampleSchema, { version: 0, nested: { label: "default" } }, injectedOps);

    await expect(repo.write({ version: 2, nested: { label: "new" } })).rejects.toThrow("rename temp -> target failed");

    await expect(readFile(filename, "utf8")).resolves.toContain('"label":"stable"');
    await expect(repo.read()).resolves.toEqual({
      version: 1,
      nested: { label: "stable" }
    });
  });

  it("uses direct rename on posix replacement without deleting the target first", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-local-repository-"));
    const filename = path.join(tempDir, "state.json");
    await writeFile(filename, JSON.stringify({ version: 1, nested: { label: "stable" } }), "utf8");

    const operations: string[] = [];
    const targetRemovals: string[] = [];
    const recordingOps = {
      mkdir,
      readFile,
      writeFile,
      stat,
      async rename(source: Parameters<typeof rename>[0], target: Parameters<typeof rename>[1]) {
        operations.push(`rename:${path.basename(String(source))}->${path.basename(String(target))}`);
        return rename(source, target);
      },
      async rm(target: Parameters<typeof rm>[0], options?: Parameters<typeof rm>[1]) {
        const targetPath = String(target);
        operations.push(`rm:${path.basename(targetPath)}`);
        if (path.resolve(targetPath) === path.resolve(filename)) {
          targetRemovals.push(targetPath);
        }
        return rm(target, options);
      }
    };

    const repo = new JsonRepository(
      filename,
      sampleSchema,
      { version: 0, nested: { label: "default" } },
      recordingOps,
      () => "linux"
    );

    await repo.write({ version: 2, nested: { label: "new" } });

    expect(targetRemovals).toEqual([]);
    expect(operations).toContainEqual(expect.stringMatching(/^rename:state\.json\.tmp-.*->state\.json$/));
    expect(operations).not.toContainEqual(expect.stringMatching(/^rename:state\.json->state\.json\.replace-backup-/));
  });

  it("waits for an external process holding the file lock before writing", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-local-repository-"));
    const filename = path.join(tempDir, "state.json");
    const lockPath = `${filename}.lock`;
    const workerPath = path.join(process.cwd(), "apps/web/test/helpers/fs-lock-worker.mjs");
    const repo = new JsonRepository(filename, sampleSchema, { version: 0, nested: { label: "default" } });

    const worker = spawn(process.execPath, [workerPath, lockPath, "250"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });

    const workerReady = new Promise<void>((resolve, reject) => {
      worker.stdout.setEncoding("utf8");
      worker.stdout.on("data", (chunk) => {
        if (chunk.includes("locked")) resolve();
      });
      worker.once("error", reject);
      worker.once("exit", (code) => {
        if (code !== 0) reject(new Error(`lock worker exited with code ${code}`));
      });
    });

    try {
      await workerReady;

      const startedAt = Date.now();
      await repo.write({ version: 1, nested: { label: "after-lock" } });
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeGreaterThanOrEqual(150);
      await expect(repo.read()).resolves.toEqual({
        version: 1,
        nested: { label: "after-lock" }
      });
    } finally {
      worker.kill();
    }
  });

  it("does not reject when windows backup cleanup fails after the new target is committed", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-local-repository-"));
    const filename = path.join(tempDir, "state.json");
    await writeFile(filename, JSON.stringify({ version: 1, nested: { label: "stable" } }), "utf8");

    const injectedOps = {
      mkdir,
      readFile,
      writeFile,
      stat,
      async rename(source: Parameters<typeof rename>[0], target: Parameters<typeof rename>[1]) {
        return rename(source, target);
      },
      async rm(target: Parameters<typeof rm>[0], options?: Parameters<typeof rm>[1]) {
        const targetPath = String(target);
        if (path.basename(targetPath).includes(".replace-backup-")) {
          throw new Error("backup cleanup failed");
        }
        return rm(target, options);
      }
    };

    const repo = new JsonRepository(
      filename,
      sampleSchema,
      { version: 0, nested: { label: "default" } },
      injectedOps,
      () => "win32"
    );

    await expect(repo.write({ version: 2, nested: { label: "new" } })).resolves.toEqual({
      version: 2,
      nested: { label: "new" }
    });
    await expect(repo.read()).resolves.toEqual({
      version: 2,
      nested: { label: "new" }
    });

    const files = await readdir(tempDir);
    expect(files.some((file) => file.includes(".replace-backup-"))).toBe(true);
  });
});
