import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { HermesSessionsResult } from "./hermes.ts";

const decodeHermesSessions = Schema.decodeUnknownSync(HermesSessionsResult);

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
