// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
import * as NodeChildProcess from "node:child_process";

export interface PiRpcCommand {
  readonly type: string;
  readonly [key: string]: unknown;
}

export type PiRpcEventHandler = (event: Record<string, unknown>) => void;

interface PendingRequest {
  readonly resolve: (response: Record<string, unknown>) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export function consumePiRpcChunk(
  remainder: string,
  chunk: string,
): {
  readonly records: ReadonlyArray<string>;
  readonly remainder: string;
} {
  const parts = `${remainder}${chunk}`.split("\n");
  const nextRemainder = parts.pop() ?? "";
  return {
    records: parts.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line)).filter(Boolean),
    remainder: nextRemainder,
  };
}

export class PiRpcProcess {
  readonly child: NodeChildProcess.ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, PendingRequest>();
  private remainder = "";
  private requestCounter = 0;
  private closed = false;

  constructor(input: {
    readonly binaryPath: string;
    readonly cwd: string;
    readonly args?: ReadonlyArray<string>;
    readonly env?: NodeJS.ProcessEnv;
    readonly onEvent?: PiRpcEventHandler;
    readonly onExit?: (detail: string) => void;
  }) {
    this.child = NodeChildProcess.spawn(
      input.binaryPath,
      ["--mode", "rpc", ...(input.args ?? [])],
      {
        cwd: input.cwd,
        env: input.env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      const consumed = consumePiRpcChunk(this.remainder, chunk);
      this.remainder = consumed.remainder;
      for (const record of consumed.records) {
        let message: unknown;
        try {
          message = JSON.parse(record);
        } catch {
          continue;
        }
        if (!message || typeof message !== "object" || Array.isArray(message)) continue;
        const event = message as Record<string, unknown>;
        const id = typeof event.id === "string" ? event.id : undefined;
        if (event.type === "response" && id && this.pending.has(id)) {
          const pending = this.pending.get(id)!;
          this.pending.delete(id);
          clearTimeout(pending.timeout);
          if (event.success === false) {
            pending.reject(
              new Error(typeof event.error === "string" ? event.error : "Pi RPC failed"),
            );
          } else {
            pending.resolve(event);
          }
          continue;
        }
        input.onEvent?.(event);
      }
    });
    this.child.once("error", (error) => this.failPending(error));
    this.child.once("exit", (code, signal) => {
      this.closed = true;
      const detail = `Pi RPC exited (${code ?? signal ?? "unknown"})`;
      this.failPending(new Error(detail));
      input.onExit?.(detail);
    });
  }

  request(command: PiRpcCommand, timeoutMs = 20_000): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new Error("Pi RPC process is closed"));
    const id = `t3-${++this.requestCounter}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi RPC ${command.type} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.child.stdin.write(`${JSON.stringify({ ...command, id })}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(pending.timeout);
        reject(error);
      });
    });
  }

  notify(command: PiRpcCommand): void {
    if (!this.closed) this.child.stdin.write(`${JSON.stringify(command)}\n`);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.child.kill("SIGTERM");
    this.failPending(new Error("Pi RPC process closed"));
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
