// @effect-diagnostics nodeBuiltinImport:off globalFetchInEffect:off schemaSyncInEffect:off
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";

import {
  HermesBridgeError,
  HermesCronJobsResult,
  HermesMutationResult,
  HermesSessionResult,
  HermesSessionsResult,
  type HermesCronAction,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const execFileAsync = NodeUtil.promisify(NodeChildProcess.execFile);
const isHermesBridgeError = Schema.is(HermesBridgeError);
const bridgeUrl = process.env.T3_HERMES_BRIDGE_URL ?? "http://100.122.147.69:8788";
const sshHost = process.env.T3_HERMES_SSH_HOST ?? "forbes@vibeserver";

let tokenPromise: Promise<string> | undefined;

function getBridgeToken(): Promise<string> {
  tokenPromise ??= execFileAsync("ssh", [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=5",
    sshHost,
    "sed -n 's/^HERMES_BRIDGE_TOKEN=//p' /home/forbes/.config/hermes-bridge.env",
  ]).then(({ stdout }) => {
    const token = stdout.trim();
    if (token.length === 0) throw new Error("Hermes bridge token was empty");
    return token;
  });
  return tokenPromise;
}

function request<A>(
  operation: string,
  path: string,
  schema: Schema.Decoder<A, never>,
  init?: RequestInit,
): Effect.Effect<A, HermesBridgeError> {
  return Effect.tryPromise({
    try: async () => {
      const token = await getBridgeToken();
      const response = await fetch(new URL(path, bridgeUrl), {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });
      if (!response.ok) {
        throw new HermesBridgeError({
          operation,
          message: `Hermes bridge returned HTTP ${response.status}`,
          status: response.status,
        });
      }
      return Schema.decodeUnknownSync(schema)(await response.json());
    },
    catch: (cause) =>
      isHermesBridgeError(cause)
        ? cause
        : new HermesBridgeError({
            operation,
            message: cause instanceof Error ? cause.message : "Hermes bridge request failed",
          }),
  });
}

export const listSessions = request("list sessions", "/api/sessions", HermesSessionsResult);

export const getSession = (sessionId: string) =>
  request(
    "get session",
    `/api/session?${new URLSearchParams({ session_id: sessionId })}`,
    HermesSessionResult,
  );

export const listCronJobs = request("list cron jobs", "/api/crons", HermesCronJobsResult);

export const runCronAction = (action: HermesCronAction, jobId: string) =>
  request("cron action", `/api/crons/${action}`, HermesMutationResult, {
    method: "POST",
    body: JSON.stringify({ job_id: jobId }),
  });

export const saveCron = (input: {
  readonly jobId?: string;
  readonly name: string;
  readonly prompt: string;
  readonly schedule: string;
}) =>
  request(
    input.jobId ? "update cron job" : "create cron job",
    input.jobId ? "/api/crons/update" : "/api/crons/create",
    HermesMutationResult,
    {
      method: "POST",
      body: JSON.stringify({
        ...(input.jobId ? { job_id: input.jobId } : {}),
        name: input.name,
        prompt: input.prompt,
        schedule: input.schedule,
      }),
    },
  );
