import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  HermesApprovalPendingResult,
  HermesChatStartResult,
  HermesModelsResult,
  HermesSessionsResult,
} from "./hermes.ts";

const decodeHermesSessions = Schema.decodeUnknownSync(HermesSessionsResult);
const decodeHermesModels = Schema.decodeUnknownSync(HermesModelsResult);
const decodeHermesApproval = Schema.decodeUnknownSync(HermesApprovalPendingResult);
const decodeHermesChatStart = Schema.decodeUnknownSync(HermesChatStartResult);

describe("HermesSessionsResult", () => {
  it("decodes the bounded session list used by the Control Center", () => {
    const decoded = decodeHermesSessions({
      sessions: [
        {
          session_id: "session-1",
          title: "Daily brief",
          workspace: "/home/forbes",
          model: "openai/gpt-5",
          message_count: 3,
          updated_at: 1_784_054_089.29,
          is_streaming: false,
          ignored_remote_field: true,
        },
      ],
      ignored_envelope_field: true,
    });

    expect(decoded.sessions[0]?.title).toBe("Daily brief");
  });
});

describe("HermesModelsResult", () => {
  it("preserves provider ids needed for model switching", () => {
    const decoded = decodeHermesModels({
      active_provider: "custom:x6m6x",
      default_model: "gpt-5.5",
      groups: [
        {
          provider: "x6m6x",
          provider_id: "custom:x6m6x",
          models: [{ id: "gpt-5.5", label: "GPT 5.5" }],
        },
      ],
    });

    expect(decoded.groups[0]?.provider_id).toBe("custom:x6m6x");
  });
});

describe("HermesApprovalPendingResult", () => {
  it("decodes the approval card returned by the live bridge", () => {
    const decoded = decodeHermesApproval({
      pending: {
        approval_id: "approval-1",
        command: "rm -rf build",
        description: "Delete generated build output",
      },
      pending_count: 1,
    });

    expect(decoded.pending?.approval_id).toBe("approval-1");
  });
});

describe("HermesChatStartResult", () => {
  it("keeps the stream id required for steering and stopping a turn", () => {
    const decoded = decodeHermesChatStart({
      stream_id: "stream-1",
      ignored_remote_field: true,
    });

    expect(decoded.stream_id).toBe("stream-1");
  });
});
