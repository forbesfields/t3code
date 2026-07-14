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

export const HermesModel = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
});
export type HermesModel = typeof HermesModel.Type;

export const HermesModelGroup = Schema.Struct({
  provider: Schema.String,
  provider_id: Schema.optionalKey(Schema.String),
  models: Schema.Array(HermesModel),
  extra_models: Schema.optionalKey(Schema.Array(HermesModel)),
});
export type HermesModelGroup = typeof HermesModelGroup.Type;

export const HermesModelsResult = Schema.Struct({
  active_provider: Schema.NullOr(Schema.String),
  default_model: Schema.String,
  groups: Schema.Array(HermesModelGroup),
});
export type HermesModelsResult = typeof HermesModelsResult.Type;

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
    model_provider: Schema.optionalKey(Schema.NullOr(Schema.String)),
    is_streaming: Schema.Boolean,
    active_stream_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
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

export const HermesApproval = Schema.Struct({
  approval_id: Schema.optionalKey(Schema.String),
  command: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  choices: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type HermesApproval = typeof HermesApproval.Type;

export const HermesApprovalPendingResult = Schema.Struct({
  pending: Schema.NullOr(HermesApproval),
  pending_count: Schema.Int,
});
export type HermesApprovalPendingResult = typeof HermesApprovalPendingResult.Type;

export const HermesCreateSessionInput = Schema.Struct({
  model: Schema.optionalKey(Schema.String),
  modelProvider: Schema.optionalKey(Schema.String),
  workspace: Schema.optionalKey(Schema.String),
});
export type HermesCreateSessionInput = typeof HermesCreateSessionInput.Type;

export const HermesChatSendInput = Schema.Struct({
  sessionId: Schema.String,
  message: Schema.String,
  model: Schema.String,
  modelProvider: Schema.optionalKey(Schema.String),
  workspace: Schema.String,
});
export type HermesChatSendInput = typeof HermesChatSendInput.Type;

export const HermesChatStartResult = Schema.Struct({
  stream_id: Schema.String,
});
export type HermesChatStartResult = typeof HermesChatStartResult.Type;

export const HermesChatSteerInput = Schema.Struct({
  sessionId: Schema.String,
  text: Schema.String,
});
export type HermesChatSteerInput = typeof HermesChatSteerInput.Type;

export const HermesChatSteerResult = Schema.Struct({
  accepted: Schema.Boolean,
  fallback: Schema.NullOr(Schema.String),
  stream_id: Schema.NullOr(Schema.String),
});
export type HermesChatSteerResult = typeof HermesChatSteerResult.Type;

export const HermesChatCancelInput = Schema.Struct({
  streamId: Schema.String,
});
export type HermesChatCancelInput = typeof HermesChatCancelInput.Type;

export const HermesChatCancelResult = Schema.Struct({
  ok: Schema.Boolean,
  cancelled: Schema.Boolean,
  stream_id: Schema.String,
});
export type HermesChatCancelResult = typeof HermesChatCancelResult.Type;

export const HermesApprovalChoice = Schema.Literals(["once", "session", "always", "deny"]);
export type HermesApprovalChoice = typeof HermesApprovalChoice.Type;

export const HermesApprovalRespondInput = Schema.Struct({
  sessionId: Schema.String,
  approvalId: Schema.optionalKey(Schema.String),
  choice: HermesApprovalChoice,
});
export type HermesApprovalRespondInput = typeof HermesApprovalRespondInput.Type;

export class HermesBridgeError extends Schema.TaggedErrorClass<HermesBridgeError>()(
  "HermesBridgeError",
  {
    operation: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Int),
  },
) {}
