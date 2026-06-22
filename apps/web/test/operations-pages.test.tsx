import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ApprovalsPage from "@/components/approvals-page";
import RunsPage from "@/components/runs-page";

describe("operations pages", () => {
  it("keeps approval actions on the approval route", () => {
    const html = renderToStaticMarkup(<ApprovalsPage />);
    expect(html).toContain("审批队列");
    expect(html).not.toContain("导出诊断");
  });

  it("keeps logs and diagnostics on the runs route", () => {
    const html = renderToStaticMarkup(<RunsPage />);
    expect(html).toContain("运行记录");
    expect(html).toContain("导出诊断");
    expect(html).not.toContain("模板正文");
  });
});
