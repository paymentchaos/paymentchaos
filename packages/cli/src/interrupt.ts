import { messages } from "./messages.ts";

const SIGNALS = ["SIGINT", "SIGTERM"] as const;
export type InterruptSignal = (typeof SIGNALS)[number];
const SIGNAL_NUMBER: Record<InterruptSignal, number> = { SIGINT: 2, SIGTERM: 15 };

/** The abort reason when the user interrupts a run. */
export class Interrupted extends Error {
  readonly signal: InterruptSignal;

  constructor(signal: InterruptSignal) {
    super(messages.interrupted(signal));
    this.name = "Interrupted";
    this.signal = signal;
  }
}

export interface InterruptScope {
  readonly signal: AbortSignal;
  dispose(): void;
}

/**
 * Turn SIGINT and SIGTERM into an abort while a run is in progress. Hook and assertion
 * commands run in their own process groups, so a terminal's Ctrl-C never reaches them;
 * the abort is what kills them. A second signal ends the process at once.
 */
export function interruptOnSignals(): InterruptScope {
  const controller = new AbortController();
  const handlers = SIGNALS.map((name) => {
    const handler = () => {
      if (!controller.signal.aborted) {
        controller.abort(new Interrupted(name));
        return;
      }
      dispose();
      if (process.platform === "win32") process.exit(128 + SIGNAL_NUMBER[name]);
      process.kill(process.pid, name);
    };
    process.on(name, handler);
    return [name, handler] as const;
  });
  const dispose = () => {
    for (const [name, handler] of handlers) process.off(name, handler);
  };
  return { signal: controller.signal, dispose };
}

/**
 * End the process as the signal would have, after cleanup, so shells and CI see an
 * interrupted run rather than an exit code from the 0–4 contract. Windows has no signal
 * re-raise (`process.kill` there terminates with exit code 1), so use the shell
 * convention 128 + signal number instead.
 */
export function exitForSignal(signal: InterruptSignal): void {
  if (process.platform === "win32") {
    process.exitCode = 128 + SIGNAL_NUMBER[signal];
    return;
  }
  process.kill(process.pid, signal);
}
