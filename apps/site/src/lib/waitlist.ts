import { waitlistMessages } from "../messages.ts";

const LOOPS_NEWSLETTER_ENDPOINT = "https://app.loops.so/api/newsletter-form";
const DEFAULT_TIMEOUT_MS = 8_000;
const EMAIL_PATTERN =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export type WaitlistState =
  | { readonly status: "idle"; readonly message: "" }
  | { readonly status: "pending"; readonly message: string }
  | { readonly status: "success"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

type StateListener = (state: WaitlistState) => void;

export interface WaitlistMachineOptions {
  readonly formId: string;
  /** Loops' form response does not say whether a contact is pending confirmation, so the build declares it. */
  readonly doubleOptIn?: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly onStateChange?: StateListener;
}

export interface WaitlistMachine {
  readonly state: WaitlistState;
  submit(email: string): Promise<WaitlistState>;
}

function isJson(response: Response): boolean {
  return response.headers.get("content-type")?.toLowerCase().includes("application/json") ?? false;
}

function responseMessage(body: unknown): string | undefined {
  if (
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string" &&
    body.message.trim() !== ""
  ) {
    return body.message;
  }
  return undefined;
}

function confirmsSuccess(body: unknown): boolean {
  return typeof body === "object" && body !== null && "success" in body && body.success === true;
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

export function createWaitlistMachine(options: WaitlistMachineOptions): WaitlistMachine {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let current: WaitlistState = { status: "idle", message: waitlistMessages.idle };

  const transition = (state: WaitlistState): WaitlistState => {
    current = state;
    options.onStateChange?.(state);
    return state;
  };

  return {
    get state() {
      return current;
    },
    async submit(rawEmail: string) {
      if (current.status === "pending" || current.status === "success") {
        return current;
      }

      const email = rawEmail.trim();
      if (!isValidEmail(email)) {
        return transition({ status: "error", message: waitlistMessages.invalidEmail });
      }

      transition({ status: "pending", message: waitlistMessages.pending });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        // Loops requires URL-encoded form values on its public newsletter endpoint.
        // https://loops.so/docs/forms/custom-form
        const response = await fetchImpl(
          `${LOOPS_NEWSLETTER_ENDPOINT}/${encodeURIComponent(options.formId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ email }),
            signal: controller.signal,
          },
        );

        if (response.status === 429) {
          return transition({ status: "error", message: waitlistMessages.rateLimited });
        }
        if (!isJson(response)) {
          return transition({ status: "error", message: waitlistMessages.invalidResponse });
        }

        let body: unknown;
        try {
          body = await response.json();
        } catch {
          return transition({ status: "error", message: waitlistMessages.invalidResponse });
        }

        if (response.ok && confirmsSuccess(body)) {
          return transition({
            status: "success",
            message: options.doubleOptIn
              ? waitlistMessages.successConfirm
              : waitlistMessages.success,
          });
        }

        return transition({
          status: "error",
          message: responseMessage(body) ?? waitlistMessages.rejected,
        });
      } catch (error) {
        const timedOut =
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError");
        return transition({
          status: "error",
          message: timedOut ? waitlistMessages.timeout : waitlistMessages.network,
        });
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function mountWaitlistForm(
  form: HTMLFormElement,
  formId: string,
  doubleOptIn: boolean,
): void {
  const input = form.elements.namedItem("email");
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const status = form.querySelector<HTMLElement>("[data-waitlist-status]");
  if (!(input instanceof HTMLInputElement) || button === null || status === null) {
    return;
  }

  const machine = createWaitlistMachine({
    formId,
    doubleOptIn,
    onStateChange(state) {
      status.textContent = state.message;
      status.dataset.state = state.status;
      form.setAttribute("aria-busy", String(state.status === "pending"));
      button.disabled = state.status === "pending" || state.status === "success";
      input.disabled = state.status === "success";
      button.textContent =
        state.status === "pending" ? waitlistMessages.buttonPending : waitlistMessages.button;
      if (state.status === "error") {
        input.setAttribute("aria-invalid", "true");
        input.focus();
      } else {
        input.removeAttribute("aria-invalid");
      }
      // The input is disabled after success, so focus moves to the confirmation itself.
      if (state.status === "success") status.focus({ preventScroll: true });
    },
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void machine.submit(input.value);
  });
  // The form has no action; it stays hidden until this handler can submit it safely.
  form.hidden = false;
}
