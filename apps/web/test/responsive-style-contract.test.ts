import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.resolve(testDir, "../src/app/globals.css"), "utf8");

describe("A1 responsive style contract", () => {
  it("uses the approved real white and teal palette", () => {
    expect(css).toContain("--page-bg: #f8faf9");
    expect(css).toContain("--surface: #ffffff");
    expect(css).toContain("--accent: #0f8f78");
  });

  it("uses a fixed desktop sidebar and mobile drawer without page overflow", () => {
    expect(css).toMatch(/\.app-sidebar\s*\{[^}]*position:\s*fixed/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*840px\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*840px\)[\s\S]*\.app-sidebar\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/body\s*\{[^}]*overflow-x:\s*hidden/s);
  });
});
