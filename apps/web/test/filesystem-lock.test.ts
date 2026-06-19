import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FilesystemLockTimeoutError, withFilesystemLock } from "@/lib/filesystem-lock";

describe("withFilesystemLock", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("recovers a stale lock directory before acquiring the lock", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-filesystem-lock-"));
    const lockPath = path.join(tempDir, "state.json.lock");

    await mkdir(lockPath, { recursive: true });
    await writeFile(path.join(lockPath, "owner.json"), JSON.stringify({ pid: 1234 }), "utf8");
    const staleTime = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleTime, staleTime);

    await expect(
      withFilesystemLock(lockPath, async () => "acquired", {
        staleMs: 50,
        retryDelayMs: 20,
        timeoutMs: 500
      })
    ).resolves.toBe("acquired");

    await expect(readdir(tempDir)).resolves.toEqual([]);
  });

  it("times out on a fresh lock without deleting it", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-filesystem-lock-"));
    const lockPath = path.join(tempDir, "state.json.lock");

    await mkdir(lockPath, { recursive: true });
    await writeFile(path.join(lockPath, "owner.json"), JSON.stringify({ pid: 5678 }), "utf8");

    await expect(
      withFilesystemLock(lockPath, async () => "never", {
        staleMs: 30_000,
        retryDelayMs: 20,
        timeoutMs: 100
      })
    ).rejects.toBeInstanceOf(FilesystemLockTimeoutError);

    await expect(readdir(tempDir)).resolves.toEqual(["state.json.lock"]);
    await expect(readdir(lockPath)).resolves.toContain("owner.json");
  });
});
