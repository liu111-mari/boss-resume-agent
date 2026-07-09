import ExcelJS from "exceljs";

import type { JobCard } from "@boss-agent/shared";
import { decodeBossText, resolveJobSalary } from "@/lib/job-display";

export type JobExportStats = {
  total: number;
  completeJd: number;
  missingJd: number;
};

const FORMULA_PREFIX = /^[=+\-@]/;

export function getJobJdStatus(job: JobCard): "完整" | "缺失" {
  return job.jdSource === "detail" && job.jdText.trim().length > 0 ? "完整" : "缺失";
}

export function getJobExportStats(jobs: JobCard[]): JobExportStats {
  const completeJd = jobs.filter((job) => getJobJdStatus(job) === "完整").length;
  return {
    total: jobs.length,
    completeJd,
    missingJd: jobs.length - completeJd
  };
}

export function sanitizeSpreadsheetText(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export async function buildJobsWorkbook(jobs: JobCard[]): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BOSS 求职助手";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("岗位明细", {
    views: [{ state: "frozen", ySplit: 1 }]
  });
  sheet.columns = [
    { header: "序号", key: "index", width: 8 },
    { header: "岗位名称", key: "title", width: 28 },
    { header: "公司", key: "company", width: 24 },
    { header: "薪资", key: "salary", width: 18 },
    { header: "城市", key: "city", width: 12 },
    { header: "工作经验", key: "experience", width: 16 },
    { header: "学历", key: "education", width: 12 },
    { header: "行业", key: "industry", width: 18 },
    { header: "岗位方向", key: "direction", width: 16 },
    { header: "HR", key: "hrName", width: 14 },
    { header: "HR活跃状态", key: "hrActiveText", width: 18 },
    { header: "JD完整度", key: "jdStatus", width: 12 },
    { header: "完整JD", key: "jdText", width: 72 },
    { header: "BOSS详情", key: "detailUrl", width: 20 },
    { header: "采集时间", key: "collectedAt", width: 20 },
    { header: "原始采集文本", key: "rawText", width: 48 }
  ];

  for (const [index, job] of jobs.entries()) {
    const detailUrl = job.detailUrl.trim();
    sheet.addRow({
      index: index + 1,
      title: sanitizeSpreadsheetText(job.title),
      company: sanitizeSpreadsheetText(job.company),
      salary: sanitizeSpreadsheetText(resolveJobSalary(job)),
      city: sanitizeSpreadsheetText(job.city),
      experience: sanitizeSpreadsheetText(job.experience),
      education: sanitizeSpreadsheetText(job.education),
      industry: sanitizeSpreadsheetText(job.industry),
      direction: sanitizeSpreadsheetText(job.direction),
      hrName: sanitizeSpreadsheetText(job.hrName),
      hrActiveText: sanitizeSpreadsheetText(job.hrActiveText),
      jdStatus: getJobJdStatus(job),
      jdText: sanitizeSpreadsheetText(decodeBossText(job.jdText)),
      detailUrl: detailUrl
        ? { text: "打开BOSS详情", hyperlink: detailUrl }
        : "未记录",
      collectedAt: job.collectedAt ? new Date(job.collectedAt) : "",
      rawText: sanitizeSpreadsheetText(decodeBossText(job.rawText))
    });
  }

  const header = sheet.getRow(1);
  header.height = 24;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F8F7A" }
  };
  header.alignment = { vertical: "middle", horizontal: "center" };

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.alignment = { vertical: "top" };
    row.getCell(13).alignment = { vertical: "top", wrapText: true };
    row.getCell(16).alignment = { vertical: "top", wrapText: true };
    row.getCell(15).numFmt = "yyyy-mm-dd hh:mm:ss";
    row.getCell(14).font = { color: { argb: "FF2563EB" }, underline: true };
    row.getCell(12).font = {
      bold: true,
      color: { argb: getJobJdStatus(jobs[rowNumber - 2]) === "完整" ? "FF087F5B" : "FFC2410C" }
    };
  }

  if (sheet.rowCount > 1) {
    sheet.autoFilter = `A1:P${sheet.rowCount}`;
  }
  sheet.properties.defaultRowHeight = 22;
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0
  };

  return workbook;
}
