"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useState } from "react";

import { WORKBENCH_NAV_ITEMS, isActiveRoute } from "@/lib/navigation";

export function DesktopNavigation({
  pathname,
  onNavigate
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="主要导航" className="desktop-navigation">
      {WORKBENCH_NAV_ITEMS.map((item) => {
        const active = isActiveRoute(pathname, item.href);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`navigation-link${active ? " navigation-link-active" : ""}`}
            href={item.href}
            key={item.href}
            onClick={onNavigate}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function WorkbenchNavigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  if (!mobile) {
    return <DesktopNavigation pathname={pathname} />;
  }

  return (
    <>
      <button
        aria-expanded={open}
        aria-label="打开导航菜单"
        className="mobile-menu-button"
        onClick={() => setOpen(true)}
        type="button"
      >
        菜单
      </button>
      {open ? (
        <div className="mobile-navigation-layer">
          <button
            aria-label="关闭导航菜单"
            className="mobile-navigation-backdrop"
            onClick={() => setOpen(false)}
            type="button"
          />
          <div className="mobile-navigation-drawer">
            <div className="mobile-navigation-heading">
              <strong>工作台导航</strong>
              <button className="mobile-navigation-close" onClick={() => setOpen(false)} type="button">
                关闭
              </button>
            </div>
            <DesktopNavigation pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
