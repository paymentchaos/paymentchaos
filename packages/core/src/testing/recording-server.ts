import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Headers } from "../contracts/index.ts";

/** One request as the target saw it: raw body bytes, lower-cased headers. */
export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Headers;
  readonly body: Buffer;
  /** `performance.now()` when the body finished arriving. */
  readonly receivedAt: number;
  /** Requests in flight at the target (including this one) when it arrived. */
  readonly inFlight: number;
}

export type RecordingHandler = (
  request: RecordedRequest,
  response: ServerResponse,
) => void | Promise<void>;

export interface RecordingServer {
  readonly url: string;
  readonly requests: readonly RecordedRequest[];
  /** Highest number of requests in flight at once. */
  readonly maxInFlight: number;
  close(): Promise<void>;
}

const readBody = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

/**
 * A local webhook target on 127.0.0.1 for engine and CLI tests. The default handler
 * answers 200; pass a handler to simulate slow, failing or racy apps.
 */
export async function startRecordingServer(
  handler: RecordingHandler = (_req, res) => {
    res.writeHead(200).end();
  },
): Promise<RecordingServer> {
  const requests: RecordedRequest[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const server = createServer((req, res) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const current = inFlight;
    res.on("close", () => inFlight--);
    readBody(req)
      .then(async (body) => {
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(", ") : value;
        }
        const recorded = {
          method: req.method ?? "",
          path: req.url ?? "",
          headers,
          body,
          receivedAt: performance.now(),
          inFlight: current,
        };
        requests.push(recorded);
        await handler(recorded, res);
      })
      .catch(() => res.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}/webhooks`,
    requests,
    get maxInFlight() {
      return maxInFlight;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
