import type { StreamEvent } from "../../core/types";

/** Payloads that mark end-of-stream and should stay unparsed. */
const SENTINELS = new Set(["[DONE]", "DONE"]);

/**
 * Incremental Server-Sent Events parser following the WHATWG event stream rules.
 * postman-runtime usually hands over complete events, but chunk boundaries are
 * not guaranteed, so buffering is still required.
 */
export class SseParser {
  private buffer = "";
  private readonly decoder = new TextDecoder("utf-8");
  private lastEventId: string | undefined;
  private sequence = 0;

  /** Feed a chunk and return every complete event it produced. */
  push(chunk: Buffer | Uint8Array | string): StreamEvent[] {
    if (chunk == null) return [];

    if (typeof chunk === "string") {
      this.buffer += chunk;
    } else {
      const view =
        chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as any);
      this.buffer += this.decoder.decode(view, { stream: true });
    }

    // A leading BOM is stripped once, per the specification.
    if (this.sequence === 0 && this.buffer.charCodeAt(0) === 0xfeff) {
      this.buffer = this.buffer.slice(1);
    }

    const events: StreamEvent[] = [];
    const boundary = /\r\n\r\n|\n\n|\r\r/;
    for (;;) {
      const match = boundary.exec(this.buffer);
      if (!match) break;
      const block = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const event = this.parseBlock(block);
      if (event) events.push(event);
    }
    return events;
  }

  /** Emit whatever remains once the stream has ended. */
  flush(): StreamEvent[] {
    try {
      this.buffer += this.decoder.decode();
    } catch {
      /* Decoder already flushed. */
    }
    const remainder = this.buffer;
    this.buffer = "";
    if (!remainder.trim()) return [];
    const event = this.parseBlock(remainder);
    return event ? [event] : [];
  }

  reset(): void {
    this.buffer = "";
    this.lastEventId = undefined;
    this.sequence = 0;
  }

  private parseBlock(block: string): StreamEvent | null {
    const lines = block.split(/\r\n|\n|\r/);
    const dataLines: string[] = [];
    const event: StreamEvent = {
      data: "",
      receivedAt: Date.now(),
      direction: "in",
    };
    let sawField = false;

    for (const line of lines) {
      if (line === "") continue;
      if (line.startsWith(":")) continue; // Comment or keep-alive heartbeat.

      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);

      switch (field) {
        case "data":
          dataLines.push(value);
          sawField = true;
          break;
        case "event":
          event.event = value;
          sawField = true;
          break;
        case "id":
          // The specification requires ignoring ids containing a NULL character.
          if (!value.includes("\u0000")) {
            event.id = value;
            this.lastEventId = value;
          }
          sawField = true;
          break;
        case "retry": {
          const retry = Number(value);
          if (Number.isInteger(retry) && retry >= 0) event.retry = retry;
          sawField = true;
          break;
        }
        default:
          break; // Unknown fields are ignored.
      }
    }

    if (!sawField) return null;

    event.data = dataLines.join("\n");
    if (event.id === undefined && this.lastEventId !== undefined)
      event.id = this.lastEventId;

    const trimmed = event.data.trim();
    if (trimmed && !SENTINELS.has(trimmed)) {
      try {
        event.parsed = JSON.parse(event.data);
      } catch {
        /* Plain-text payload, keep `data` only. */
      }
    }

    this.sequence += 1;
    return event;
  }
}
