import * as Schema from "effect/Schema";

export const HermesSessionSummary = Schema.Struct({
  session_id: Schema.String,
  title: Schema.String,
  workspace: Schema.String,
  model: Schema.NullOr(Schema.String),
  message_count: Schema.Int,
  updated_at: Schema.Number,
  is_streaming: Schema.Boolean,
});
export type HermesSessionSummary = typeof HermesSessionSummary.Type;

export const HermesSessionsResult = Schema.Struct({
  sessions: Schema.Array(HermesSessionSummary),
});
export type HermesSessionsResult = typeof HermesSessionsResult.Type;

export const HermesMessage = Schema.Struct({
  role: Schema.String,
  content: Schema.Unknown,
  timestamp: Schema.optionalKey(Schema.Unknown),
});
export type HermesMessage = typeof HermesMessage.Type;

export const HermesSessionResult = Schema.Struct({
  session: Schema.Struct({
    session_id: Schema.String,
    title: Schema.String,
    workspace: Schema.String,
    model: Schema.String,
    is_streaming: Schema.Boolean,
    messages: Schema.Array(HermesMessage),
  }),
});
export type HermesSessionResult = typeof HermesSessionResult.Type;

export const HermesCronJob = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  prompt: Schema.String,
  model: Schema.NullOr(Schema.String),
  schedule_display: Schema.String,
  enabled: Schema.Boolean,
  state: Schema.String,
  next_run_at: Schema.NullOr(Schema.String),
  last_status: Schema.NullOr(Schema.String),
});
export type HermesCronJob = typeof HermesCronJob.Type;

export const HermesCronJobsResult = Schema.Struct({
  jobs: Schema.Array(HermesCronJob),
});
export type HermesCronJobsResult = typeof HermesCronJobsResult.Type;

export const HermesCronAction = Schema.Literals(["run", "pause", "resume", "delete"]);
export type HermesCronAction = typeof HermesCronAction.Type;

export const HermesCronSaveInput = Schema.Struct({
  jobId: Schema.optionalKey(Schema.String),
  name: Schema.String,
  prompt: Schema.String,
  schedule: Schema.String,
});
export type HermesCronSaveInput = typeof HermesCronSaveInput.Type;

export const HermesMutationResult = Schema.Record(Schema.String, Schema.Unknown);
export type HermesMutationResult = typeof HermesMutationResult.Type;

export class HermesBridgeError extends Schema.TaggedErrorClass<HermesBridgeError>()(
  "HermesBridgeError",
  {
    operation: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Int),
  },
) {}
