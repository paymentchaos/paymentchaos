import { createServer } from "node:http";
import { validateWebhookSignature } from "razorpay/dist/utils/razorpay-utils.js";
import { Webhook } from "standardwebhooks";
import Stripe from "stripe";

export async function startSandboxServer(secret: string) {
  const stripe = new Stripe("sk_test_sandbox_no_api_calls");
  const bodies = new Map<string, Buffer>();
  const state = {
    deliveries: 0,
    rejected: 0,
    resets: 0,
    reads: 0,
    redirects: 0,
    counts: {} as Record<string, number>,
    order: [] as string[],
    ids: [] as string[],
    bytesMatch: true,
    testMode: true,
    unicode: false,
    money: [] as { currency: string; amount: number }[],
  };
  const mode = { naive: false, status: 200, hang: false, staleRead: false };
  const resetRecords = () => {
    bodies.clear();
    Object.assign(state, { counts: {}, order: [], ids: [], money: [], reads: 0 });
  };
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/reset") {
        state.resets++;
        resetRecords();
        res.end();
        return;
      }
      if (req.url === "/state") {
        state.reads++;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            ...state,
            ...(mode.staleRead && state.reads === 1 ? { counts: {} } : {}),
          }),
        );
        return;
      }
      if (req.url === "/redirected") {
        state.redirects++;
        res.end();
        return;
      }
      state.deliveries++;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const headers = Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [
          k,
          Array.isArray(v) ? v.join(",") : (v ?? ""),
        ]),
      );
      let id: string;
      let type: string;
      if (req.url === "/stripe") {
        // https://docs.stripe.com/webhooks/signature — verification receives the original bytes.
        const event = stripe.webhooks.constructEvent(
          body,
          headers["stripe-signature"] ?? "",
          secret,
        );
        id = event.id;
        type = event.type;
        state.testMode &&= event.livemode === false;
        const object = event.data.object as {
          currency?: string;
          amount?: number;
          amount_paid?: number;
        };
        const amount = object.amount ?? object.amount_paid;
        if (object.currency && amount !== undefined)
          state.money.push({ currency: object.currency, amount });
      } else if (req.url === "/razorpay") {
        // https://razorpay.com/docs/webhooks/validate-test/#validate-webhooks
        if (
          !validateWebhookSignature(
            body.toString("utf8"),
            headers["x-razorpay-signature"] ?? "",
            secret,
          )
        )
          throw new Error();
        const event = JSON.parse(body.toString("utf8"));
        id = headers["x-razorpay-event-id"] ?? "";
        type = event.event;
        state.testMode &&= event.payload.payment.entity.notes.paymentchaos === "synthetic-test";
        state.money.push({
          currency: event.payload.payment.entity.currency,
          amount: event.payload.payment.entity.amount,
        });
      } else {
        // https://www.standardwebhooks.com/ — official SDK verifies ID, timestamp and raw body.
        const event = new Webhook(secret).verify(body, headers) as { type: string };
        id = headers["webhook-id"] ?? "";
        type = event.type;
        state.testMode &&= headers["x-paymentchaos-mode"] === "test";
      }
      if (!id || !type) throw new Error();
      const previous = bodies.get(id);
      state.bytesMatch &&= previous === undefined || previous.equals(body);
      state.unicode ||= body.includes(Buffer.from("Zoë 東京"));
      if (!previous || mode.naive) state.counts[type] = (state.counts[type] ?? 0) + 1;
      bodies.set(id, body);
      state.ids.push(id);
      state.order.push(type);
      if (mode.hang) return;
      if (mode.status === 302) res.setHeader("location", "/redirected");
      res.writeHead(mode.status).end();
    } catch {
      state.rejected++;
      res.writeHead(400).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    state,
    mode,
    reset() {
      resetRecords();
      Object.assign(state, {
        deliveries: 0,
        rejected: 0,
        resets: 0,
        redirects: 0,
        bytesMatch: true,
        testMode: true,
        unicode: false,
      });
      Object.assign(mode, { naive: false, status: 200, hang: false, staleRead: false });
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
