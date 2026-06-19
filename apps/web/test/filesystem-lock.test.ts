import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
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

  it("writes owner metadata with pid token and acquiredAt", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-filesystem-lock-"));
    const lockPath = path.join(tempDir, "state.json.lock");

    await withFilesystemLock(lockPath, async () => {
      const owner = JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8")) as {
        pid: number;
        token: string;
        acquiredAt: string;
      };

      expect(owner.pid).toBe(process.pid);
      expect(owner.token).toEqual(expect.any(String));
      expect(owner.token.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(owner.acquiredAt))).toBe(false);
    });
  });

  it("recovers a stale lock directory before acquiring the lock", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-filesystem-lock-"));
    const lockPath = path.join(tempDir, "state.json.lock");

    await mkdir(lockPath, { recursive: true });
    await writeFile(path.join(lockPath, "owner.json"), JSON.stringify({ pid: 1234, token: "dead-owner", acquiredAt: new Date().toISOString() }), "utf8");
    const staleTime = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleTime, staleTime);

    await expect(
      withFilesystemLock(lockPath, async () => "acquired", {
        isProcessAlive: async () => false,
        staleMs: 50,
        retryDelayMs: 20,
        timeoutMs: 500
      })
    ).resolves.toBe("acquired");

    await expect(readdir(tempDir)).resolves.toEqual([]);
  });

  it("times out on a live owner even when the lock mtime is stale", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-filesystem-lock-"));
    const lockPath = path.join(tempDir, "state.json.lock");

    await mkdir(lockPath, { recursive: true });
    await writeFile(path.join(lockPath, "owner.json"), JSON.stringify({ pid: 5678, token: "live-owner", acquiredAt: new Date().toISOString() }), "utf8");
    const staleTime = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleTime, staleTime);

    await expect(
      withFilesystemLock(lockPath, async () => "never", {
        isProcessAlive: async () => true,
        staleMs: 50,
        retryDelayMs: 20,
        timeoutMs: 100
      })
    ).rejects.toBeInstanceOf(FilesystemLockTimeoutError);

    await expect(readdir(tempDir)).resolves.toEqual(["state.json.lock"]);
    await expect(readdir(lockPath)).resolves.toContain("owner.json");
  });

  it("recovers a dead owner lock even when the mtime is fresh", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-filesystem-lock-"));
    const lockPath = path.join(tempDir, "state.json.lock");

    await mkdir(lockPath, { recursive: true });
    await writeFile(path.join(lockPath, "owner.json"), JSON.stringify({ pid: 42, token: "dead-owner", acquiredAt: new Date().toISOString() }), "utf8");

    await expect(
      withFilesystemLock(lockPath, async () => "recovered", {
        isProcessAlive: async () => false,
        staleMs: 30_000,
        retryDelayMs: 20,
        timeoutMs: 500
      })
    ).resolves.toBe("recovered");

    await expect(readdir(tempDir)).resolves.toEqual([]);
  });

  it("does not remove a replaced lock when finally sees a different owner token", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-filesystem-lock-"));
    const lockPath = path.join(tempDir, "state.json.lock");

    await withFilesystemLock(lockPath, async () => {
      await rm(lockPath, { recursive: true, force: true });
      await mkdir(lockPath, { recursive: true });
      await writeFile(
        path.join(lockPath, "owner.json"),
        JSON.stringify({ pid: 9999, token: "new-owner-token", acquiredAt: new Date().toISOString() }),
        "utf8"
      );
    });

    await expect(readdir(tempDir)).resolves.toEqual(["state.json.lock"]);
    await expect(readFile(path.join(lockPath, "owner.json"), "utf8")).resolves.toContain("new-owner-token");
  });

  it("does not reclaim corrupted owner metadata before stale timeout", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-filesystem-lock-"));
    const lockPath = path.join(tempDir, "state.json.lock");

    await mkdir(lockPath, { recursive: true });
    await writeFile(path.join(lockPath, "owner.json"), "{bad json", "utf8");

    await expect(
      withFilesystemLock(lockPath, async () => "never", {
        staleMs: 30_000,
        retryDelayMs: 20,
        timeoutMs: 100
      })
    ).rejects.toBeInstanceOf(FilesystemLockTimeoutError);

    await expect(readdir(tempDir)).resolves.toEqual(["state.json.lock"]);
  });

  it("reclaims corrupted owner metadata after stale timeout", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-filesystem-lock-"));
    const lockPath = path.join(tempDir, "state.json.lock");

    await mkdir(lockPath, { recursive: true });
    await writeFile(path.join(lockPath, "owner.json"), "{bad json", "utf8");
    const staleTime = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleTime, staleTime);

    await expect(
      withFilesystemLock(lockPath, async () => "reclaimed", {
        staleMs: 50,
        retryDelayMs: 20,
        timeoutMs: 500
      })
    ).resolves.toBe("reclaimed");

    await expect(readdir(tempDir)).resolves.toEqual([]);
  });
});
