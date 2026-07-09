import { describe, expect, it } from "vitest";

import { getNextDistDir } from "../next.config";

describe("Next.js build directories", () => {
  it("keeps development output separate from production builds", () => {
    expect(getNextDistDir("development")).toBe(".next-dev");
    expect(getNextDistDir("production")).toBe(".next");
  });
});
