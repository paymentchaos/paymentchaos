import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase, resetDatabase } from "./db.js";
import { createApp } from "./server.js";

export interface RunningExample {
  readonly baseUrl: string;
  readonly port: number;
  readonly db: DatabaseSync;
  readonly dbPath: string;
  readonly webhookSecret: string;
  close(): Promise<void>;
}

export async function startExample(options?: {
  webhookSecret?: string;
  dbPath?: string;
}): Promise<RunningExample> {
  const webhookSecret = options?.webhookSecret ?? "whsec_test_naive_example";
  const dbPath =
    options?.dbPath ?? join(mkdtempSync(join(tmpdir(), "stripe-express-naive-")), "app.db");
  const db = openDatabase(dbPath);
  resetDatabase(db);
  const app = createApp(db, webhookSecret);

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind ephemeral port");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    port: address.port,
    db,
    dbPath,
    webhookSecret,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          db.close();
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}
