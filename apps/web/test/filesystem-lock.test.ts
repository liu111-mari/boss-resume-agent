import { mkdir, mkdtemp, readdir, rm, utimes } from "node:fs/promises";
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

  it("locks a missing file path and releases it for the next caller", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-filesystem-lock-"));
    const targetPath = path.join(tempDir, "state.json");

    await expect(withFilesystemLock(targetPath, async () => "first")).resolves.toBe("first");
    await expect(withFilesystemLock(targetPath, async () => "second")).resolves.toBe("second");
    await expect(readdir(tempDir)).resolves.toEqual([]);
  });

  it("times out clearly when an external fresh lock directory exists", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-filesystem-lock-"));
    const targetPath = path.join(tempDir, "state.json");

    await mkdir(`${targetPath}.lock`, { recursive: true });

    await expect(
      withFilesystemLock(targetPath, async () => "never", {
        staleMs: 30_000,
        retries: {
          retries: 3,
          factor: 1,
          minTimeout: 20,
          maxTimeout: 20
        }
      })
    ).rejects.toBeInstanceOf(FilesystemLockTimeoutError);
  });

  it("allows acquisition once an external stale lock directory is old enough", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-filesystem-lock-"));
    const targetPath = path.join(tempDir, "state.json");
    const lockDir = `${targetPath}.lock`;

    await mkdir(lockDir, { recursive: true });
    const staleTime = new Date(Date.now() - 60_000);
    await utimes(lockDir, staleTime, staleTime);

    await expect(
      withFilesystemLock(targetPath, async () => "acquired", {
        staleMs: 50,
        retries: {
          retries: 3,
          factor: 1,
          minTimeout: 20,
          maxTimeout: 20
        }
      })
    ).resolves.toBe("acquired");
    await expect(readdir(tempDir)).resolves.toEqual([]);
  });
});
