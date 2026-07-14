#!/usr/bin/env node

let buffer = "";

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line) continue;
    const command = JSON.parse(line);
    if (command.type === "get_state") {
      send({
        id: command.id,
        type: "response",
        command: "get_state",
        success: true,
        data: { sessionId: "fake", isStreaming: false },
      });
    } else if (command.type === "set_model") {
      send({
        id: command.id,
        type: "response",
        command: "set_model",
        success: true,
        data: { provider: command.provider, id: command.modelId },
      });
    } else if (command.type === "prompt") {
      send({ id: command.id, type: "response", command: "prompt", success: true });
      send({
        type: "message_update",
        assistantMessageEvent: { type: "text_start", contentIndex: 0 },
      });
      send({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hello from Pi" },
      });
      send({
        type: "message_update",
        assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "Hello from Pi" },
      });
      send({ type: "agent_settled" });
    } else if (command.type === "abort") {
      send({ id: command.id, type: "response", command: "abort", success: true });
    }
  }
});
