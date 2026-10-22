import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(siteRoot, "..", "..");
const outputPath = join(siteRoot, "src", "data", "demo.txt");

const child = spawn("pnpm", ["--filter", "@paymentchaos/golden-e2e", "demo"], {
  cwd: repoRoot,
  env: { ...process.env, FORCE_COLOR: "0" },
  stdio: ["ignore", "pipe", "pipe"],
  // pnpm is a .cmd shim on Windows, which spawn can only start through a shell.
  shell: process.platform === "win32",
});

const chunks: Buffer[] = [];
child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));

const exitCode = await new Promise<number>((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code) => resolve(code ?? 1));
});

if (exitCode !== 0) {
  process.stderr.write(Buffer.concat(chunks));
  throw new Error(`Golden demo exited with code ${exitCode}; transcript was not replaced.`);
}

const capturedOutput = Buffer.concat(chunks)
  .toString("utf8")
  .replaceAll(process.execPath, "node")
  .replaceAll(repoRoot, "<repo>");
const transcript = [
  "$ pnpm --filter @paymentchaos/golden-e2e demo",
  "",
  capturedOutput.trimEnd(),
  "",
].join("\n");

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, transcript, "utf8");
process.stdout.write(`Captured real seed-1337 demo output in ${outputPath}\n`);
