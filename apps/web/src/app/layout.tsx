import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BOSS 求职助手",
  description: "审批后自动发送的本地求职自动化工作台"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
