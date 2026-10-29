import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { messages } from "./private-beta-messages.mjs";

export const root = fileURLToPath(new URL("../", import.meta.url));

export function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, npm_config_update_notifier: "false" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${messages.commandFailed(command)}\n${result.stderr}`);
  return result.stdout;
}

export function pnpm(args) {
  const executable = process.env.npm_execpath;
  if (!executable) throw new Error(messages.pnpmRequired);
  return /\.[cm]?js$/.test(executable)
    ? run(process.execPath, [executable, ...args])
    : run(executable, args);
}

export async function packPrivate(outputRoot = join(root, "dist", "private-beta")) {
  pnpm(["--filter", "paymentchaos...", "build"]);
  const commit = run("git", ["rev-parse", "HEAD"]).trim();
  const dirty = run("git", ["status", "--porcelain"]).trim() !== "";
  const source = JSON.parse(await readFile(join(root, "packages/cli/package.json"), "utf8"));
  const version = `${source.version}-private.g${commit.slice(0, 12)}${dirty ? ".dirty" : ""}`;
  await mkdir(outputRoot, { recursive: true });
  const output = await mkdtemp(join(resolve(outputRoot), `${version}-`));
  const temporary = await mkdtemp(join(tmpdir(), "paymentchaos-pack-"));
  const stage = join(temporary, "package");
  try {
    // Hoisting is required: npm's bundler cannot preserve pnpm's symlinked virtual store.
    // --prefer-offline, not --offline: a frozen-lockfile install does not always leave registry
    // metadata in pnpm's cache (fresh CI runners). The archive's own install below stays offline.
    pnpm([
      "--filter",
      "paymentchaos",
      "deploy",
      "--prod",
      "--legacy",
      "--prefer-offline",
      "--ignore-scripts",
      "--node-linker=hoisted",
      stage,
    ]);
    const manifestPath = join(stage, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const workspaceNames = Object.keys(manifest.dependencies).filter((name) =>
      name.startsWith("@paymentchaos/"),
    );
    for (const directory of [
      stage,
      ...workspaceNames.map((name) => join(stage, "node_modules", name)),
    ]) {
      const path = join(directory, "package.json");
      const pkg = JSON.parse(await readFile(path, "utf8"));
      for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
        if (String(spec).startsWith("workspace:")) {
          pkg.dependencies[name] = JSON.parse(
            await readFile(join(stage, "node_modules", name, "package.json"), "utf8"),
          ).version;
        }
      }
      await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`);
      await copyFile(join(root, "LICENSE"), join(directory, "LICENSE"));
    }
    const packed = JSON.parse(await readFile(manifestPath, "utf8"));
    Object.assign(packed, {
      version,
      private: true,
      engines: { node: ">=22.12.0" },
      bundleDependencies: Object.keys(packed.dependencies),
      files: ["dist", "PRIVATE-BETA.json"],
    });
    delete packed.scripts;
    delete packed.devDependencies;
    await writeFile(manifestPath, `${JSON.stringify(packed, null, 2)}\n`);
    const provenance = { version, commit, dirty, node: process.version };
    await writeFile(join(stage, "PRIVATE-BETA.json"), `${JSON.stringify(provenance, null, 2)}\n`);
    const [archive] = JSON.parse(
      pnpm([
        "exec",
        "npm",
        "pack",
        stage,
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        output,
      ]),
    );
    if (archive.files.some((file) => file.path.endsWith(".node")))
      throw new Error(messages.nativeAddon);
    const tarball = join(output, archive.filename);
    const sha256 = createHash("sha256")
      .update(await readFile(tarball))
      .digest("hex");
    await writeFile(join(output, "SHA256SUMS"), `${sha256}  ${archive.filename}\n`);
    const result = { ...provenance, tarball, sha256 };
    await writeFile(join(output, "manifest.json"), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 3) throw new Error(messages.usage);
    const result = await packPrivate(process.argv[2]);
    console.error(messages.packaged(result.tarball));
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
