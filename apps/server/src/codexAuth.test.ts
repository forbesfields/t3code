import { describe, expect, it } from "vite-plus/test";

import { isCodexAuthCommand } from "./codexAuth.ts";

describe("isCodexAuthCommand", () => {
  it("allows codex-auth commands but not arbitrary executables", () => {
    expect(isCodexAuthCommand(["switch", "personal"])).toBe(true);
    expect(isCodexAuthCommand(["clean"])).toBe(true);
    expect(isCodexAuthCommand(["--version"])).toBe(true);
    expect(isCodexAuthCommand(["bash", "-c", "echo nope"])).toBe(false);
  });
});
