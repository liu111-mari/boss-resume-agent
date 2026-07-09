import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const appRoot = join(root, "..");
const dist = join(appRoot, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(appRoot, "src"), dist, { recursive: true });

const cjsModules = ["job-extractor", "boss-page-adapter", "task-runner", "job-enrichment-runner"];
for (const moduleName of cjsModules) {
  await rename(join(dist, `${moduleName}.cjs`), join(dist, `${moduleName}.js`));
}

const manifestPath = join(dist, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.content_scripts = manifest.content_scripts.map((entry) => ({
  ...entry,
  js: entry.js.map((filename) => filename.replace(/\.cjs$/i, ".js"))
}));
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const backgroundPath = join(dist, "background.js");
const background = await readFile(backgroundPath, "utf8");
await writeFile(
  backgroundPath,
  background
    .replace('import "./task-runner.cjs";', 'import "./task-runner.js";')
    .replace('import "./job-enrichment-runner.cjs";', 'import "./job-enrichment-runner.js";'),
  "utf8"
);

console.log(`Chrome-loadable extension built at ${dist}`);
