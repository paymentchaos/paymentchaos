import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./db.js";
import { createApp } from "./server.js";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_test_naive_example";
const dbPath =
  process.env.EXAMPLE_DB_PATH ??
  join(mkdtempSync(join(tmpdir(), "stripe-express-naive-")), "app.db");

const db = openDatabase(dbPath);
const app = createApp(db, webhookSecret);

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const server = app.listen(port, "127.0.0.1", () => {
  process.stdout.write(`stripe-express-naive listening on http://127.0.0.1:${port}\n`);
});

function shutdown(): void {
  server.close(() => {
    db.close();
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export { createApp, db, server };
