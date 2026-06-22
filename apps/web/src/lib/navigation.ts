export type WorkbenchNavItem = {
  href: string;
  label: string;
};

export const WORKBENCH_NAV_ITEMS: WorkbenchNavItem[] = [
  { href: "/", label: "概览" },
  { href: "/jobs", label: "岗位库" },
  { href: "/filters", label: "筛选设置" },
  { href: "/profile", label: "个人资料" },
  { href: "/template", label: "话术模板" },
  { href: "/approvals", label: "审批队列" },
  { href: "/runs", label: "运行记录" }
];

export function isActiveRoute(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
