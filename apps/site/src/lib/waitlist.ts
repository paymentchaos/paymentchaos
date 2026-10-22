import { waitlistMessages } from "../messages.ts";

const LOOPS_NEWSLETTER_ENDPOINT = "https://app.loops.so/api/newsletter-form";
const DEFAULT_TIMEOUT_MS = 8_000;
const EMAIL_PATTERN =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export type WaitlistState =
  | { readonly status: "idle"; readonly message: "" }
  | { readonly status: "pending"; readonly message: string }
  | { readonly status: "success"; readonly message: string }
  /** `email` means the address itself was rejected; `request` covers transport and service failures. */
  | { readonly status: "error"; readonly cause: "email" | "request"; readonly message: string };

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
  const requestError = (message: string) =>
    transition({ status: "error", cause: "request", message });

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
        return transition({
          status: "error",
          cause: "email",
          message: waitlistMessages.invalidEmail,
        });
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
          return requestError(waitlistMessages.rateLimited);
        }
        if (!isJson(response)) {
          return requestError(waitlistMessages.invalidResponse);
        }

        let body: unknown;
        try {
          body = await response.json();
        } catch (error) {
          // Only a malformed body is an invalid response. An abort or a dropped connection while
          // the body streams is handled below as a timeout or network failure.
          if (!(error instanceof SyntaxError)) throw error;
          return requestError(waitlistMessages.invalidResponse);
        }

        if (response.ok && confirmsSuccess(body)) {
          return transition({
            status: "success",
            message: options.doubleOptIn
              ? waitlistMessages.successConfirm
              : waitlistMessages.success,
          });
        }

        return requestError(responseMessage(body) ?? waitlistMessages.rejected);
      } catch (error) {
        const timedOut =
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError");
        return requestError(timedOut ? waitlistMessages.timeout : waitlistMessages.network);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export interface WaitlistView {
  readonly buttonLabel: string;
  readonly buttonDisabled: boolean;
  /** Read-only while pending, so the address on screen is always the one being submitted. */
  readonly inputReadOnly: boolean;
  readonly inputDisabled: boolean;
  readonly inputInvalid: boolean;
  readonly busy: boolean;
  readonly focus: "input" | "button" | "status" | null;
}

/** How the form should look and where focus should go for a given state. */
export function waitlistView(state: WaitlistState): WaitlistView {
  const pending = state.status === "pending";
  const success = state.status === "success";
  const emailError = state.status === "error" && state.cause === "email";
  let focus: WaitlistView["focus"] = null;
  if (emailError) focus = "input";
  else if (state.status === "error") focus = "button";
  // The input is disabled after success, so focus moves to the confirmation itself.
  else if (success) focus = "status";
  return {
    buttonLabel: pending ? waitlistMessages.buttonPending : waitlistMessages.button,
    buttonDisabled: pending || success,
    inputReadOnly: pending,
    inputDisabled: success,
    inputInvalid: emailError,
    busy: pending,
    focus,
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
      const view = waitlistView(state);
      status.textContent = state.message;
      status.dataset.state = state.status;
      form.setAttribute("aria-busy", String(view.busy));
      button.disabled = view.buttonDisabled;
      button.textContent = view.buttonLabel;
      input.readOnly = view.inputReadOnly;
      input.disabled = view.inputDisabled;
      if (view.inputInvalid) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
      if (view.focus === "input") input.focus();
      else if (view.focus === "button") button.focus();
      else if (view.focus === "status") status.focus({ preventScroll: true });
    },
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void machine.submit(input.value);
  });
  // The form has no action; it stays hidden until this handler can submit it safely.
  form.hidden = false;
}
