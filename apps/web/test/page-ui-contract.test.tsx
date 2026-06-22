import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PageFeedback from "@/components/page-feedback";
import { PageHeader } from "@/components/ui";

describe("page UI", () => {
  it("renders one title, description and action region", () => {
    const html = renderToStaticMarkup(
      <PageHeader actions={<button type="button">刷新</button>} description="页面说明" title="岗位库" />
    );
    expect(html).toContain("<h1>岗位库</h1>");
    expect(html).toContain("页面说明");
    expect(html).toContain("刷新");
  });

  it("announces status and error messages accessibly", () => {
    const html = renderToStaticMarkup(<PageFeedback error="保存失败" status="保存成功" />);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("保存成功");
    expect(html).toContain("保存失败");
  });
});
