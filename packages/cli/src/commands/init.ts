import { mkdir, open, readFile, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { assertTargetAllowed, PaymentChaosError } from "@paymentchaos/core";
import type { CommandDef } from "citty";
import { stringify } from "yaml";
import { initMessages as m, messages } from "../messages.ts";

const providers = {
  stripe: { env: "STRIPE_WEBHOOK_SECRET", scenario: "stripe-subscription-renewal" },
  razorpay: { env: "RAZORPAY_WEBHOOK_SECRET", scenario: "razorpay-subscription-charged" },
  "generic-hmac": { env: "WEBHOOK_SECRET", scenario: "generic-hmac-duplicate" },
} as const;

async function detect(cwd: string) {
  let pkg: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
  try {
    pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
    if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) throw new Error();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { framework: "", detected: [] };
    throw new PaymentChaosError("CONFIG_INVALID", m.manifestInvalid(join(cwd, "package.json")));
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  return {
    framework: ["next", "express", "fastify", "koa"].find((name) => name in deps) ?? "",
    detected: ["stripe", "razorpay"].filter((name) => name in deps),
  };
}

export async function initializeProject(
  cwd: string,
  options: {
    provider?: string;
    target?: string;
    secretEnv?: string;
    allowRemoteTarget?: string;
  } = {},
): Promise<string> {
  const { framework, detected } = await detect(cwd);
  if (options.provider === undefined && detected.length > 1)
    throw new PaymentChaosError("CONFIG_INVALID", m.providerAmbiguous);
  const provider = options.provider ?? detected[0] ?? "stripe";
  if (!Object.hasOwn(providers, provider))
    throw new PaymentChaosError(
      "CONFIG_INVALID",
      messages.providerUnknown(provider, Object.keys(providers)),
    );
  const selected = providers[provider as keyof typeof providers];
  const secretEnv = options.secretEnv ?? selected.env;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(secretEnv))
    throw new PaymentChaosError("CONFIG_INVALID", m.secretEnvInvalid);
  const target = options.target ?? `http://127.0.0.1:3000/webhooks/${provider}`;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new PaymentChaosError("CONFIG_INVALID", m.targetInvalid);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new PaymentChaosError("CONFIG_INVALID", m.targetInvalid);
  assertTargetAllowed(
    target,
    options.allowRemoteTarget === undefined ? {} : { allowRemoteTarget: options.allowRemoteTarget },
  );

  const directory = join(cwd, "paymentchaos");
  const config = join(cwd, "paymentchaos.config.yaml");
  const created: string[] = [];
  let madeDirectory = false;
  const writeNew = async (file: string, body: string) => {
    const handle = await open(file, "wx");
    created.push(file);
    try {
      await handle.writeFile(body, "utf8");
    } finally {
      await handle.close();
    }
  };
  try {
    // Exclusive creation also refuses symlinks. Roll back only files created by this run.
    await mkdir(directory);
    madeDirectory = true;
    await writeNew(join(directory, "verify.mjs"), m.assertionTemplate);
    await writeNew(
      config,
      stringify({
        version: 1,
        providers: { [provider]: { target: { url: target, secret: `\${${secretEnv}}` } } },
        assert: { command: "node paymentchaos/verify.mjs" },
      }),
    );
  } catch (error) {
    for (const file of created.reverse()) await unlink(file);
    if (madeDirectory) await rmdir(directory);
    throw new PaymentChaosError(
      "CONFIG_INVALID",
      m.writeFailed(cwd, (error as NodeJS.ErrnoException).code ?? "IO_ERROR"),
    );
  }
  return m.created(provider, framework, secretEnv, selected.scenario, provider === "generic-hmac");
}

export function createInitCommand(): CommandDef {
  return {
    meta: { name: "init", description: m.description },
    args: {
      provider: { type: "string", description: m.provider },
      target: { type: "string", description: m.target },
      "secret-env": { type: "string", description: m.secretEnv },
      "allow-remote-target": { type: "string", description: messages.runArgAllowRemoteTarget },
    },
    async run(ctx) {
      if (
        ctx.args._.length > 0 ||
        Object.entries(ctx.args).some(
          ([key, value]) => key !== "_" && value !== undefined && typeof value !== "string",
        ) ||
        Object.keys(ctx.args).some(
          (key) => !["_", "provider", "target", "secret-env", "allow-remote-target"].includes(key),
        )
      )
        throw new PaymentChaosError("CONFIG_INVALID", m.argumentsInvalid);
      console.log(
        await initializeProject(process.cwd(), {
          ...(ctx.args.provider === undefined ? {} : { provider: ctx.args.provider as string }),
          ...(ctx.args.target === undefined ? {} : { target: ctx.args.target as string }),
          ...(ctx.args["secret-env"] === undefined
            ? {}
            : { secretEnv: ctx.args["secret-env"] as string }),
          ...(ctx.args["allow-remote-target"] === undefined
            ? {}
            : { allowRemoteTarget: ctx.args["allow-remote-target"] as string }),
        }),
      );
    },
  };
}
