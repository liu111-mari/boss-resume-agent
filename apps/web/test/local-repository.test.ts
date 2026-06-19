import { mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
});
