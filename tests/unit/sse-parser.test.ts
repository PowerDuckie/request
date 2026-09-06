import { describe, expect, it } from "vitest";
import { SseParser } from "../../src/protocols/http/sse-parser";

function collect(chunks: string[]) {
  const parser = new SseParser();
  const events = chunks.flatMap((chunk) => parser.push(chunk));
  return [...events, ...parser.flush()];
}

describe("SseParser", () => {
  it("parses a single well-formed event", () => {
    const events = collect(['data: {"a":1}\n\n']);
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('{"a":1}');
    expect(events[0].parsed).toEqual({ a: 1 });
  });

  it("keeps id and event fields", () => {
    const events = collect([`id: 7\nevent: chunk\ndata: {"seq":7}\n\n`]);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("7");
    expect(events[0].event).toBe("chunk");
    expect(events[0].parsed).toEqual({ seq: 7 });
  });

  it("does not throw on non-JSON payloads", () => {
    const events = collect(['data: {"seq":1}\n\n', "data: [DONE]\n\n"]);
    expect(events).toHaveLength(2);
    expect(events[1].data).toBe("[DONE]");
    expect(events[1].parsed).toBeUndefined();
    expect(events[0].parsed).toEqual({ seq: 1 });
  });

  it("reassembles events split across chunk boundaries", () => {
    const whole = `id: 1\nevent: chunk\ndata: {"content":"hi"}\n\n`;

    for (let cut = 1; cut < whole.length; cut += 1) {
      const events = collect([whole.slice(0, cut), whole.slice(cut)]);
      expect(events, `split at ${cut}`).toHaveLength(1);
      expect(events[0].parsed).toEqual({ content: "hi" });
    }
  });

  it("emits multiple events from one chunk", () => {
    const events = collect(["data: 1\n\ndata: 2\n\ndata: 3\n\n"]);
    expect(events.map((e) => e.data)).toEqual(["1", "2", "3"]);
  });

  it("joins multi-line data with newlines", () => {
    const events = collect(["data: line one\ndata: line two\n\n"]);
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("line one\nline two");
  });

  it("ignores comment lines", () => {
    const events = collect([": keep-alive\n\n", "data: real\n\n"]);
    expect(events.filter((e) => e.data !== "")).toHaveLength(1);
    expect(events.at(-1)?.data).toBe("real");
  });

  it("handles CRLF line endings", () => {
    const events = collect(['event: chunk\r\ndata: {"a":1}\r\n\r\n']);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("chunk");
    expect(events[0].parsed).toEqual({ a: 1 });
  });

  it("strips one leading space after colon", () => {
    const events = collect(["data:  two spaces\n\n"]);
    expect(events[0].data).toBe(" two spaces");
  });

  it("accepts a field with no value", () => {
    const events = collect(["data\n\n"]);
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("");
  });

  it("captures numeric retry and ignores invalid retry", () => {
    expect(collect(["retry: 3000\ndata: x\n\n"])[0].retry).toBe(3000);
    expect(collect(["retry: soon\ndata: x\n\n"])[0].retry).toBeUndefined();
  });

  it("flushes a trailing unterminated event at end of stream", () => {
    const parser = new SseParser();
    expect(parser.push('data: {"seq":1}\n\ndata: {"seq":2')).toHaveLength(1);

    const flushed = parser.flush();
    expect(flushed).toHaveLength(1);
    expect(flushed[0].data).toBe('{"seq":2');
    expect(flushed[0].parsed).toBeUndefined();
  });

  it("skips a UTF-8 BOM", () => {
    const events = collect(["\uFEFFdata: first\n\n"]);
    expect(events[0].data).toBe("first");
  });
});
