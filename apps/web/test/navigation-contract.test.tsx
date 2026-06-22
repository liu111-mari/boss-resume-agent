import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DesktopNavigation } from "@/components/navigation";
import { WORKBENCH_NAV_ITEMS } from "@/lib/navigation";

describe("workbench navigation", () => {
  it("defines every approved route exactly once", () => {
    expect(WORKBENCH_NAV_ITEMS).toEqual([
      { href: "/", label: "概览" },
      { href: "/jobs", label: "岗位库" },
      { href: "/filters", label: "筛选设置" },
      { href: "/profile", label: "个人资料" },
      { href: "/template", label: "话术模板" },
      { href: "/approvals", label: "审批队列" },
      { href: "/runs", label: "运行记录" }
    ]);
  });

  it("marks only the current route as active", () => {
    const html = renderToStaticMarkup(<DesktopNavigation pathname="/profile" />);
    expect(html).toContain('href="/profile"');
    expect(html).toContain('aria-current="page"');
    expect((html.match(/aria-current="page"/g) ?? [])).toHaveLength(1);
  });
});
