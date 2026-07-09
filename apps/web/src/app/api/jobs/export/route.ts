import { z } from "zod";

import type { JobCard } from "@boss-agent/shared";
import { getDomainStore } from "@/lib/domain-store";
import { buildJobsWorkbook } from "@/lib/job-export";
import { parseJsonBody, withApiErrorHandling } from "@/lib/http";

const requestSchema = z.object({
  jobIds: z.array(z.string().min(1)).min(1)
}).strict();

export async function GET() {
  return withApiErrorHandling(async () => {
    const jobs = await getDomainStore().getJobs();
    return createWorkbookResponse(jobs);
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { jobIds } = await parseJsonBody(request, requestSchema);
    const selectedIds = new Set(jobIds);
    const jobs = (await getDomainStore().getJobs()).filter((job) => selectedIds.has(job.id));
    return createWorkbookResponse(jobs);
  });
}

async function createWorkbookResponse(jobs: JobCard[]) {
  const workbook = await buildJobsWorkbook(jobs);
  const bytes = await workbook.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);
  const filename = `岗位库-${date}.xlsx`;

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="boss-jobs-${date}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }
  });
}
