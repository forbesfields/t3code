#!/usr/bin/env node

const args = process.argv.slice(2);

if (args[0] === "--version") {
  process.stdout.write("1.1.8\n");
  process.exit(0);
}

if (args[0] === "models") {
  process.stdout.write("gemini-3.6-flash-high\nclaude-sonnet-4-6\n");
  process.exit(0);
}

const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const conversationId = valueAfter("--conversation") ?? "fake-antigravity-conversation";
const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

write({
  event: "init",
  conversation_id: conversationId,
  init: { model: valueAfter("--model"), cwd: process.cwd(), permission_mode: "request-review" },
});
write({
  event: "step_update",
  step_update: {
    conversation_id: conversationId,
    step_index: 1,
    state: "ACTIVE",
    step_type: "agent_response",
    text_delta: "Hello ",
  },
});
write({
  event: "step_update",
  step_update: {
    conversation_id: conversationId,
    step_index: 2,
    state: "ACTIVE",
    step_type: "tool",
    tool_name: "view_file",
    tool_info: { name: "view_file", parameters: { AbsolutePath: "/tmp/example.ts" } },
  },
});
write({
  event: "step_update",
  step_update: {
    conversation_id: conversationId,
    step_index: 2,
    state: "DONE",
    step_type: "tool",
    tool_name: "view_file",
    tool_info: { name: "view_file", parameters: { AbsolutePath: "/tmp/example.ts" } },
  },
});
write({
  event: "step_update",
  step_update: {
    conversation_id: conversationId,
    step_index: 3,
    state: "DONE",
    step_type: "agent_response",
    text_delta: "from Antigravity",
  },
});
write({
  event: "result",
  result: {
    conversation_id: conversationId,
    status: "SUCCESS",
    response: "Hello from Antigravity",
  },
});
