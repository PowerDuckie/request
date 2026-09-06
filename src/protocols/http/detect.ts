const STREAM_MEDIA_TYPES = [
  "text/event-stream",
  "application/json-seq",
  "application/x-ndjson",
  "application/ndjson",
  "application/jsonl",
];

/** Decide, from the spec alone, whether the operation is expected to stream. */
export function isStreamingOperation(
  operation: any,
  values?: { header?: Record<string, unknown> },
): boolean {
  const accept = Object.entries(values?.header ?? {}).find(
    ([key]) => key.toLowerCase() === "accept",
  )?.[1];
  if (
    typeof accept === "string" &&
    accept.toLowerCase().includes("text/event-stream")
  )
    return true;

  const responses = operation?.responses;
  if (!responses || typeof responses !== "object") return false;

  for (const response of Object.values<any>(responses)) {
    const content = response?.content;
    if (!content || typeof content !== "object") continue;
    for (const [mediaType, media] of Object.entries<any>(content)) {
      const lower = mediaType.toLowerCase();
      if (lower.startsWith("text/event-stream")) return true;
      // In OpenAPI 3.2, itemSchema on a sequence media type marks a stream.
      if (
        media &&
        typeof media.itemSchema === "object" &&
        STREAM_MEDIA_TYPES.some((t) => lower.startsWith(t))
      ) {
        return true;
      }
    }
  }
  return false;
}

export function isSseContentType(contentType?: string): boolean {
  return !!contentType && /text\/event-stream/i.test(contentType);
}

export function isStreamingContentType(contentType?: string): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  return STREAM_MEDIA_TYPES.some((type) => lower.includes(type));
}

/** Build an Accept header from the declared response media types. */
export function acceptHeaderFor(operation: any): string | undefined {
  const types = new Set<string>();
  const responses = operation?.responses;
  if (!responses || typeof responses !== "object") return undefined;

  for (const response of Object.values<any>(responses)) {
    for (const mediaType of Object.keys(response?.content ?? {})) {
      // Wildcards add no negotiation value and confuse some servers.
      if (mediaType !== "*/*") types.add(mediaType);
    }
  }
  if (!types.size) return undefined;

  const list = Array.from(types);
  // Put event-stream first so the server negotiates the streaming variant.
  list.sort(
    (a, b) =>
      Number(b.toLowerCase().startsWith("text/event-stream")) -
      Number(a.toLowerCase().startsWith("text/event-stream")),
  );
  return list.slice(0, 8).join(", ");
}
