import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export function getNextDistDir(nodeEnv: string | undefined): string {
  return nodeEnv === "development" ? ".next-dev" : ".next";
}

const nextConfig: NextConfig = {
  distDir: getNextDistDir(process.env.NODE_ENV),
  transpilePackages: ["@boss-agent/shared"],
  turbopack: {
    root: path.resolve(currentDir, "../..")
  }
};

export default nextConfig;
