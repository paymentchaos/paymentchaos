import type { DatabaseSync } from "node:sqlite";
import express from "express";
import { readState } from "./db.js";
import { verifyStripeSignature } from "./stripe.js";
import { handleStripeEvent } from "./webhooks.js";

export function createApp(db: DatabaseSync, webhookSecret: string): express.Express {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/__test__/state", (req, res) => {
    const customer = req.query.customer;
    if (typeof customer !== "string" || customer.length === 0) {
      res.status(400).json({ error: "query parameter customer is required" });
      return;
    }
    res.json(readState(db, customer));
  });

  app.post("/webhooks/stripe", express.raw({ type: "application/json" }), (req, res) => {
    const signature = req.headers["stripe-signature"];
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const verified = verifyStripeSignature(
      rawBody,
      typeof signature === "string" ? signature : undefined,
      webhookSecret,
    );
    if (!verified.ok) {
      res.status(400).send(`Webhook signature verification failed: ${verified.reason}`);
      return;
    }

    let event: unknown;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.status(400).send("Invalid JSON payload");
      return;
    }

    try {
      handleStripeEvent(db, event as Parameters<typeof handleStripeEvent>[1]);
      res.json({ received: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "processing failed";
      res.status(500).json({ error: message });
    }
  });

  return app;
}
