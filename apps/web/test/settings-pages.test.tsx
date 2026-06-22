import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import FiltersPage from "@/components/filters-page";
import ProfilePage from "@/components/profile-page";
import TemplatePage from "@/components/template-page";

describe("settings page isolation", () => {
  it("renders only filter controls on the filter page", () => {
    const html = renderToStaticMarkup(<FiltersPage />);
    expect(html).toContain("筛选设置");
    expect(html).not.toContain("学校");
    expect(html).not.toContain("模板正文");
  });

  it("renders only profile controls on the profile page", () => {
    const html = renderToStaticMarkup(<ProfilePage />);
    expect(html).toContain("个人资料");
    expect(html).not.toContain("目标职位");
  });

  it("renders only template controls on the template page", () => {
    const html = renderToStaticMarkup(<TemplatePage />);
    expect(html).toContain("话术模板");
    expect(html).not.toContain("每日打招呼上限");
  });
});
