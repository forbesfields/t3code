import { describe, expect, it } from "vite-plus/test";

import { parseCodexAuthAccountRows, resolveCodexAccountSelector } from "./-codex-accounts.logic.ts";

const output = `     ACCOUNT               PLAN  5H USAGE      WEEKLY USAGE  LAST ACTIVITY
---------------------------------------------------------------------------------
* 01 first@example.com     Plus  67% (Tomorrow)  12% (Friday)  Now
  02 second@example.com    Pro   6% (Tonight)    4% (Sunday)   5h ago`;

describe("codex account output", () => {
  it("maps padded row numbers to the matching account selector", () => {
    const accounts = parseCodexAuthAccountRows(output);

    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({
      active: true,
      number: "01",
      selector: "first@example.com",
    });
    expect(resolveCodexAccountSelector("1", accounts)).toBe("first@example.com");
    expect(resolveCodexAccountSelector("01", accounts)).toBe("first@example.com");
  });
});
