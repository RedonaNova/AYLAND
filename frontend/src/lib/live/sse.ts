import type { AgentEvent } from "../types";

function parse(block: string): AgentEvent | null {
  let type = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue; // comment / heartbeat
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return data.length ? ({ type, data: JSON.parse(data.join("\n")) } as AgentEvent) : null;
}

/**
 * §8.4 events from a streaming POST response (EventSource can't POST).
 * Stopping early cancels the request, which ends the server-side turn too.
 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
      for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
        const event = parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (event) yield event;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
