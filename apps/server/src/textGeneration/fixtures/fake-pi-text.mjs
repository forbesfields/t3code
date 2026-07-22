#!/usr/bin/env node

import * as NodeFS from "node:fs";

if (process.env.PI_TEST_ARGS_PATH) {
  NodeFS.writeFileSync(process.env.PI_TEST_ARGS_PATH, JSON.stringify(process.argv.slice(2)));
}

process.stdout.write(
  JSON.stringify({
    verdict: "fix",
    summary: "A verification blocker remains.",
    instruction: "Run the restart integration test.",
    evidenceSummary: "A diff was provided without restart-test output.",
    blockers: [
      {
        requirement: "Verify reconnect behavior after restart.",
        evidenceRequired: "Passing restart integration-test output.",
        status: "open",
      },
    ],
  }),
);
