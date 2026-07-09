import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { JobCard } from "@boss-agent/shared";
import {
  buildJobsWorkbook,
  getJobExportStats,
  getJobJdStatus,
  sanitizeSpreadsheetText
} from "@/lib/job-export";

function createJob(overrides: Partial<JobCard> = {}): JobCard {
  return {
    id: "job-1",
    title: "AI产品实习生",
    company: "示例科技",
    city: "北京",
    salary: "200-300元/天",
    hrName: "张女士",
    hrActiveText: "今日活跃",
    detailUrl: "https://www.zhipin.com/job_detail/job-1.html",
    sourcePage: "boss",
    jdText: "负责AI产品需求分析、原型设计和数据复盘。",
    jdSource: "detail",
    experience: "在校/应届",
    education: "本科",
    industry: "企业服务",
    rawText: "原始岗位文本",
    direction: "AI产品",
    collectedAt: "2026-07-09T00:00:00.000Z",
    ...overrides
  };
}

describe("job XLSX export", () => {
  it("counts only non-empty detail-page JD as complete", () => {
    const jobs = [
      createJob(),
      createJob({ id: "job-2", jdSource: "list", jdText: "列表摘要" }),
      createJob({ id: "job-3", jdSource: "detail", jdText: "" })
    ];

    expect(getJobExportStats(jobs)).toEqual({ total: 3, completeJd: 1, missingJd: 2 });
    expect(getJobJdStatus(jobs[0])).toBe("完整");
    expect(getJobJdStatus(jobs[1])).toBe("缺失");
  });

  it("neutralizes spreadsheet formulas while preserving ordinary JD text", () => {
    expect(sanitizeSpreadsheetText("=HYPERLINK(\"https://evil.test\")")).toBe(
      "'=HYPERLINK(\"https://evil.test\")"
    );
    expect(sanitizeSpreadsheetText("负责 SQL 数据分析")).toBe("负责 SQL 数据分析");
  });

  it("creates a formatted workbook with exact JD and clickable BOSS links", async () => {
    const workbook = await buildJobsWorkbook([
      createJob(),
      createJob({
        id: "job-2",
        title: "+恶意公式",
        detailUrl: "https://www.zhipin.com/job_detail/job-2.html",
        jdSource: "list",
        jdText: "列表摘要"
      })
    ]);
    const bytes = await workbook.xlsx.writeBuffer();
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(bytes);
    const sheet = loaded.getWorksheet("岗位明细");

    expect(sheet).toBeDefined();
    expect(sheet?.rowCount).toBe(3);
    expect(sheet?.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet?.autoFilter).toBe("A1:P3");
    expect(sheet?.getRow(1).values).toEqual([
      undefined,
      "序号",
      "岗位名称",
      "公司",
      "薪资",
      "城市",
      "工作经验",
      "学历",
      "行业",
      "岗位方向",
      "HR",
      "HR活跃状态",
      "JD完整度",
      "完整JD",
      "BOSS详情",
      "采集时间",
      "原始采集文本"
    ]);
    expect(sheet?.getCell("M2").value).toBe("负责AI产品需求分析、原型设计和数据复盘。");
    expect(sheet?.getCell("L2").value).toBe("完整");
    expect(sheet?.getCell("L3").value).toBe("缺失");
    expect(sheet?.getCell("B3").value).toBe("'+恶意公式");
    expect(sheet?.getCell("N2").value).toEqual({
      text: "打开BOSS详情",
      hyperlink: "https://www.zhipin.com/job_detail/job-1.html"
    });
  });
});

describe("job XLSX export route", () => {
  let tempDir = "";
  let previousDataDir: string | undefined;

  beforeEach(async () => {
    previousDataDir = process.env.BOSS_AGENT_DATA_DIR;
    tempDir = await mkdtemp(path.join(os.tmpdir(), "boss-agent-job-export-"));
    process.env.BOSS_AGENT_DATA_DIR = tempDir;
    const { resetDomainStoreCache } = await import("@/lib/domain-store");
    resetDomainStoreCache();
  });

  afterEach(async () => {
    const { resetDomainStoreCache } = await import("@/lib/domain-store");
    resetDomainStoreCache();
    if (previousDataDir === undefined) delete process.env.BOSS_AGENT_DATA_DIR;
    else process.env.BOSS_AGENT_DATA_DIR = previousDataDir;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("downloads all jobs as an XLSX file", async () => {
    const { createDomainStore } = await import("@/lib/domain-store");
    await createDomainStore(tempDir).upsertJobs([createJob()]);
    const route = await import("@/app/api/jobs/export/route");

    const response = await route.GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(response.headers.get("content-disposition")).toContain(".xlsx");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });
});
