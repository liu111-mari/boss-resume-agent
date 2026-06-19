import { mkdir, rm } from "node:fs/promises";

const [, , lockPath, holdMsArg] = process.argv;
const holdMs = Number(holdMsArg ?? "250");

async function main() {
  await mkdir(lockPath, { recursive: false });
  process.stdout.write("locked\n");
  await new Promise((resolve) => setTimeout(resolve, holdMs));
  await rm(lockPath, { recursive: true, force: true });
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
