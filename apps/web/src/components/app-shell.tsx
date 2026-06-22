import React from "react";

import { WorkbenchNavigation } from "@/components/navigation";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <strong>BOSS 求职助手</strong>
          <span>本地打招呼工作台</span>
        </div>
        <WorkbenchNavigation />
      </aside>
      <div className="app-content">
        <header className="mobile-app-header">
          <strong>BOSS 求职助手</strong>
          <WorkbenchNavigation mobile />
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}
