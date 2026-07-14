import { describe, expect, it } from "@effect/vitest";

import { consumePiRpcChunk } from "./PiRpcProcess.ts";

describe("consumePiRpcChunk", () => {
  it("preserves partial JSONL records and only splits on LF", () => {
    const first = consumePiRpcChunk("", '{"type":"message_update","delta":"one');
    expect(first.records).toEqual([]);

    const second = consumePiRpcChunk(first.remainder, '\u2028two"}\r\n{"type":"agent_settled"}\n');
    expect(second.records).toEqual([
      '{"type":"message_update","delta":"one\u2028two"}',
      '{"type":"agent_settled"}',
    ]);
    expect(second.remainder).toBe("");
  });
});
