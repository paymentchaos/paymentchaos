import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureMessages } from "./capture-demo-messages.js";

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
  throw new Error(captureMessages.failed(exitCode));
}

const capturedOutput = Buffer.concat(chunks)
  .toString("utf8")
  .replaceAll(process.execPath, "node")
  .replaceAll(repoRoot, "<repo>");
if (
  !capturedOutput.includes("naive exit 1 (expected)") ||
  !capturedOutput.includes("correct exit 0 (expected)")
) {
  throw new Error(captureMessages.unexpected);
}
const transcript = [
  "$ pnpm --filter @paymentchaos/golden-e2e demo",
  "",
  capturedOutput.trimEnd(),
  "",
].join("\n");

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, transcript, "utf8");
// Asciicast v2 stores terminal output events. Pace the real captured lines over 35s;
// this is a readable replay, not a claim about the execution's wall-clock duration.
// https://docs.asciinema.org/manual/asciicast/v2/
const lines = transcript.trimEnd().split("\n");
const recording = [
  JSON.stringify({
    version: 2,
    width: 120,
    height: 36,
    duration: 35,
    title: captureMessages.title,
  }),
  ...lines.map((line, index) =>
    JSON.stringify([
      Number(((35 * index) / Math.max(1, lines.length - 1)).toFixed(3)),
      "o",
      `${line}\r\n`,
    ]),
  ),
].join("\n");
await mkdir(join(siteRoot, "public"), { recursive: true });
await writeFile(join(siteRoot, "public", "demo.cast"), `${recording}\n`, "utf8");
process.stdout.write(`${captureMessages.finished(outputPath)}\n`);
