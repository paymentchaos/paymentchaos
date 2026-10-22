import { afterEach, describe, expect, it, vi } from "vitest";
import { waitlistMessages } from "../messages.ts";
import { createWaitlistMachine, type WaitlistState, waitlistView } from "./waitlist.ts";

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("waitlist state machine", () => {
  it("rejects an invalid email without making a request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const machine = createWaitlistMachine({ formId: "form-id", fetchImpl });

    await expect(machine.submit("not-an-email")).resolves.toEqual({
      status: "error",
      cause: "email",
      message: waitlistMessages.invalidEmail,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("shows success only for a 2xx response that explicitly confirms success", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ success: true }));
    const machine = createWaitlistMachine({ formId: "form/id", fetchImpl });

    await expect(machine.submit("reader@example.com")).resolves.toEqual({
      status: "success",
      message: waitlistMessages.success,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://app.loops.so/api/newsletter-form/form%2Fid",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email: "reader@example.com" }),
      }),
    );
  });

  it("asks the user to confirm by email when double opt-in is enabled", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ success: true }));
    const machine = createWaitlistMachine({ formId: "form-id", doubleOptIn: true, fetchImpl });

    await expect(machine.submit("reader@example.com")).resolves.toEqual({
      status: "success",
      message: waitlistMessages.successConfirm,
    });
  });

  it("does not treat a 2xx response without success:true as success", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: 1 }));
    const machine = createWaitlistMachine({ formId: "form-id", fetchImpl });

    await expect(machine.submit("reader@example.com")).resolves.toEqual({
      status: "error",
      cause: "request",
      message: waitlistMessages.rejected,
    });
  });

  it("does not treat an explicit success body on a non-2xx response as success", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ success: true }, { status: 500 }));
    const machine = createWaitlistMachine({ formId: "form-id", fetchImpl });

    await expect(machine.submit("reader@example.com")).resolves.toEqual({
      status: "error",
      cause: "request",
      message: waitlistMessages.rejected,
    });
  });

  it("surfaces a success:false message", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ success: false, message: "Email is already subscribed." }));
    const machine = createWaitlistMachine({ formId: "form-id", fetchImpl });

    await expect(machine.submit("reader@example.com")).resolves.toEqual({
      status: "error",
      cause: "request",
      message: "Email is already subscribed.",
    });
  });

  it("handles rate limiting", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ success: false }, { status: 429 }));
    const machine = createWaitlistMachine({ formId: "form-id", fetchImpl });

    await expect(machine.submit("reader@example.com")).resolves.toEqual({
      status: "error",
      cause: "request",
      message: waitlistMessages.rateLimited,
    });
  });

  it("rejects non-JSON responses", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("<html>unavailable</html>", { status: 502 }));
    const machine = createWaitlistMachine({ formId: "form-id", fetchImpl });

    await expect(machine.submit("reader@example.com")).resolves.toEqual({
      status: "error",
      cause: "request",
      message: waitlistMessages.invalidResponse,
    });
  });

  it("rejects invalid JSON responses", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const machine = createWaitlistMachine({ formId: "form-id", fetchImpl });

    await expect(machine.submit("reader@example.com")).resolves.toEqual({
      status: "error",
      cause: "request",
      message: waitlistMessages.invalidResponse,
    });
  });

  it("handles network errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    const machine = createWaitlistMachine({ formId: "form-id", fetchImpl });

    await expect(machine.submit("reader@example.com")).resolves.toEqual({
      status: "error",
      cause: "request",
      message: waitlistMessages.network,
    });
  });

  it("aborts and reports a timeout", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    const machine = createWaitlistMachine({ formId: "form-id", fetchImpl, timeoutMs: 50 });

    const result = machine.submit("reader@example.com");
    await vi.advanceTimersByTimeAsync(50);
    await expect(result).resolves.toEqual({
      status: "error",
      cause: "request",
      message: waitlistMessages.timeout,
    });
  });

  it("ignores a second submit while the first is pending", async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const machine = createWaitlistMachine({ formId: "form-id", fetchImpl });

    const first = machine.submit("first@example.com");
    const second = machine.submit("second@example.com");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(second).resolves.toEqual({
      status: "pending",
      message: waitlistMessages.pending,
    });

    resolveRequest?.(jsonResponse({ success: true }));
    await expect(first).resolves.toMatchObject({ status: "success" });
  });
  it("allows a retry after a failure", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    const machine = createWaitlistMachine({ formId: "form-id", fetchImpl });

    await expect(machine.submit("reader@example.com")).resolves.toMatchObject({
      status: "error",
    });
    await expect(machine.submit("reader@example.com")).resolves.toMatchObject({
      status: "success",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not submit again after success", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ success: true }));
    const machine = createWaitlistMachine({ formId: "form-id", fetchImpl });

    await machine.submit("reader@example.com");
    await expect(machine.submit("other@example.com")).resolves.toMatchObject({
      status: "success",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports every transition to the listener in order", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ success: true }));
    const states: string[] = [];
    const machine = createWaitlistMachine({
      formId: "form-id",
      fetchImpl,
      onStateChange: (state) => states.push(state.status),
    });

    await machine.submit("  reader@example.com  ");
    expect(states).toEqual(["pending", "success"]);
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toEqual(
      new URLSearchParams({ email: "reader@example.com" }),
    );
  });
  it("reports a timeout when the body stalls after the headers arrive", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => {
            controller.error(new DOMException("aborted", "AbortError"));
          });
        },
      });
      return new Response(body, { headers: { "Content-Type": "application/json" } });
    });
    const machine = createWaitlistMachine({ formId: "form-id", fetchImpl, timeoutMs: 50 });

    const result = machine.submit("reader@example.com");
    await vi.advanceTimersByTimeAsync(50);
    await expect(result).resolves.toEqual({
      status: "error",
      cause: "request",
      message: waitlistMessages.timeout,
    });
  });

  it("reports a network error when the connection drops while the body streams", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"succ'));
        controller.error(new TypeError("terminated"));
      },
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(body, { headers: { "Content-Type": "application/json" } }));
    const machine = createWaitlistMachine({ formId: "form-id", fetchImpl });

    await expect(machine.submit("reader@example.com")).resolves.toEqual({
      status: "error",
      cause: "request",
      message: waitlistMessages.network,
    });
  });
});

describe("waitlist view", () => {
  const view = (state: WaitlistState) => waitlistView(state);

  it("locks the submitted address and the button while pending", () => {
    expect(view({ status: "pending", message: waitlistMessages.pending })).toEqual({
      buttonLabel: waitlistMessages.buttonPending,
      buttonDisabled: true,
      inputReadOnly: true,
      inputDisabled: false,
      inputInvalid: false,
      busy: true,
      focus: null,
    });
  });

  it("marks only an invalid address as invalid and returns focus to it", () => {
    expect(
      view({ status: "error", cause: "email", message: waitlistMessages.invalidEmail }),
    ).toMatchObject({ inputInvalid: true, inputReadOnly: false, focus: "input" });
  });

  it("keeps the address valid after a service failure and focuses the retry button", () => {
    expect(
      view({ status: "error", cause: "request", message: waitlistMessages.network }),
    ).toMatchObject({ inputInvalid: false, buttonDisabled: false, focus: "button" });
  });

  it("disables the form and focuses the confirmation after success", () => {
    expect(view({ status: "success", message: waitlistMessages.success })).toMatchObject({
      buttonDisabled: true,
      inputDisabled: true,
      focus: "status",
    });
  });
});
