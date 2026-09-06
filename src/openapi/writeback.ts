import type { ExecResult, Json, StreamEvent } from "../core/types";
import { inferSchema } from "./infer";
import { mergeSchema } from "./merge";
import { deepClone } from "../core/utils";
import { err } from "../core/errors";

/** Headers that describe the transport rather than the API contract. */
const TRANSIENT_HEADERS = new Set([
  "date",
  "content-length",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "server",
  "set-cookie",
  "age",
  "via",
  "alt-svc",
  "report-to",
  "nel",
  "x-request-id",
  "x-trace-id",
  "x-amzn-requestid",
  "x-amz-cf-id",
  "cf-ray",
  "cf-cache-status",
  "x-served-by",
  "x-timer",
  "x-cache",
]);

/** Payloads that mark end-of-stream and carry no schema information. */
const SENTINEL_PAYLOADS = new Set(["[DONE]", "DONE", "[done]"]);

function isSentinel(event: StreamEvent): boolean {
  if (SENTINEL_PAYLOADS.has(event.data.trim())) return true;
  const name = (event.event ?? "").toLowerCase();
  return name === "done" || name === "end" || name === "complete";
}

function headersToOpenApi(
  headers: Record<string, string>,
): Record<string, any> | undefined {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    const lower = key.toLowerCase();
    if (lower === "content-type" || TRANSIENT_HEADERS.has(lower)) continue;
    out[key] = { schema: { type: "string", examples: [String(value)] } };
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeMediaType(contentType?: string): string {
  if (!contentType) return "application/octet-stream";
  const base = contentType.split(";")[0].trim().toLowerCase();
  return base || "application/octet-stream";
}

export interface ToResponseOptions {
  /** Cap on the size of captured example payloads, in characters. */
  maxExampleChars?: number;
  /** Include a captured example under `content[mediaType].examples`. Defaults to true. */
  includeExamples?: boolean;
}

/** Convert a single execution result into an OpenAPI 3.2 Response Object. */
export function toResponseObject(
  result: ExecResult,
  options: ToResponseOptions = {},
): { statusCode: string; response: any } {
  const { response } = result;
  const statusCode = response.status > 0 ? String(response.status) : "default";
  const mediaType = normalizeMediaType(response.contentType);
  const includeExamples = options.includeExamples !== false;
  const maxChars = options.maxExampleChars ?? 4000;

  const target: Record<string, any> = {
    description: response.statusText || describeStatus(response.status),
  };

  const headers = headersToOpenApi(response.headers);
  if (headers) target.headers = headers;

  // ---- Streaming protocols: describe one item, not the whole body. ----
  if (
    (result.protocol === "sse" || result.protocol === "websocket") &&
    Array.isArray(response.events)
  ) {
    const meaningful = response.events.filter((event) => !isSentinel(event));
    if (!meaningful.length) return { statusCode, response: target };

    let dataSchema: any = null;
    let allJson = true;
    for (const event of meaningful) {
      if (event.parsed !== undefined) {
        dataSchema = mergeSchema(
          dataSchema,
          inferSchema(event.parsed as Json),
          0,
        );
      } else {
        allJson = false;
        const text =
          event.data.length > 200
            ? `${event.data.slice(0, 200)}...`
            : event.data;
        dataSchema = mergeSchema(
          dataSchema,
          { type: "string", examples: [text] },
          0,
        );
      }
    }

    const eventNames = Array.from(
      new Set(
        meaningful
          .map((event) => event.event)
          .filter((name): name is string => !!name),
      ),
    );

    const itemSchema: Record<string, any> = {
      type: "object",
      properties: {
        id: { type: "string" },
        event: eventNames.length
          ? { type: "string", enum: eventNames }
          : { type: "string" },
        data: allJson
          ? (dataSchema ?? { type: "object" })
          : (dataSchema ?? { type: "string" }),
        retry: { type: "integer" },
      },
      required: ["data"],
    };

    const streamMediaType =
      result.protocol === "sse" ? "text/event-stream" : mediaType;
    target.content = {
      [streamMediaType]: {
        // OpenAPI 3.2 uses itemSchema to describe each element of a stream.
        itemSchema,
        "x-protokit-sample-count": meaningful.length,
        ...(response.truncated ? { "x-protokit-truncated": true } : {}),
      },
    };
    return { statusCode, response: target };
  }

  // ---- Regular responses ----
  if (response.body !== undefined && response.body !== null) {
    const media: Record<string, any> = {
      schema: inferSchema(response.body as Json),
    };
    if (includeExamples) {
      media.examples = {
        capturedSample: {
          summary: "Captured from a live call",
          value: truncateValue(response.body, maxChars),
        },
      };
    }
    target.content = { [mediaType]: media };
  } else if (typeof response.text === "string" && response.text.length) {
    const media: Record<string, any> = { schema: { type: "string" } };
    if (includeExamples) {
      media.examples = {
        capturedSample: { value: response.text.slice(0, maxChars) },
      };
    }
    target.content = { [mediaType]: media };
  } else if (response.status !== 204 && response.sizeBytes > 0) {
    // A body existed but could not be decoded (binary payload).
    target.content = {
      [mediaType]: { schema: { type: "string", format: "binary" } },
    };
  }

  return { statusCode, response: target };
}

function truncateValue(value: unknown, maxChars: number): unknown {
  try {
    const text = JSON.stringify(value);
    if (text && text.length <= maxChars) return value;
    return {
      "x-protokit-truncated": true,
      preview: String(text).slice(0, maxChars),
    };
  } catch {
    return String(value).slice(0, maxChars);
  }
}

function describeStatus(status: number): string {
  if (status >= 500) return "Server error";
  if (status >= 400) return "Client error";
  if (status >= 300) return "Redirection";
  if (status >= 200) return "Successful response";
  return "Response";
}

export interface WriteBackOptions {
  /** 'merge' unions the new observation into the existing schema. Defaults to 'merge'. */
  strategy?: "merge" | "replace";
  /** Preserve a hand-written description instead of the HTTP reason phrase. Defaults to true. */
  keepExistingDescription?: boolean;
  /** Skip write-back when any assertion failed. Defaults to true. */
  requirePassingTests?: boolean;
  /** Only write back these status codes. Empty means all. */
  allowedStatusCodes?: string[];
  /** Refuse to touch responses whose schema is a $ref to a shared component. Defaults to true. */
  protectComponentRefs?: boolean;
}

/**
 * Merge a response fragment into a copy of the spec.
 * The input document is never mutated.
 */
export function writeBackResponse(
  spec: any,
  path: string,
  method: string,
  fragment: { statusCode: string; response: any },
  options: WriteBackOptions = {},
): any {
  if (!spec || typeof spec !== "object")
    throw err("BAD_SPEC", "spec must be an object");

  const next = deepClone(spec);
  const pathItem = next.paths?.[path];
  if (!pathItem)
    throw err(
      "PATH_NOT_FOUND",
      `Path "${path}" is not present in the document`,
    );

  const lower = String(method).toLowerCase();
  const operation =
    pathItem[lower] ??
    pathItem.additionalOperations?.[method.toUpperCase()] ??
    pathItem.additionalOperations?.[method];
  if (!operation || typeof operation !== "object") {
    throw err(
      "OP_NOT_FOUND",
      `Operation "${method.toUpperCase()} ${path}" is not present in the document`,
    );
  }

  const statusCode = fragment.statusCode;
  if (
    options.allowedStatusCodes?.length &&
    !options.allowedStatusCodes.includes(statusCode)
  ) {
    return next;
  }

  if (!operation.responses || typeof operation.responses !== "object")
    operation.responses = {};
  const incoming = deepClone(fragment.response);

  if (options.strategy === "replace" || !operation.responses[statusCode]) {
    operation.responses[statusCode] = incoming;
    return next;
  }

  const existing = operation.responses[statusCode];

  // A $ref'd response object points at a shared component; leave it alone.
  if (typeof existing.$ref === "string") return next;

  if (options.keepExistingDescription === false || !existing.description) {
    existing.description = incoming.description ?? existing.description;
  }

  if (incoming.headers) {
    existing.headers = { ...(existing.headers ?? {}), ...incoming.headers };
  }

  if (incoming.content) {
    if (!existing.content || typeof existing.content !== "object")
      existing.content = {};
    for (const [mediaType, media] of Object.entries<any>(incoming.content)) {
      const previous = existing.content[mediaType];
      if (!previous) {
        existing.content[mediaType] = media;
        continue;
      }
      const protectRefs = options.protectComponentRefs !== false;

      if (media.itemSchema) {
        previous.itemSchema =
          protectRefs && typeof previous.itemSchema?.$ref === "string"
            ? previous.itemSchema
            : mergeSchema(previous.itemSchema, media.itemSchema, 0);
      }
      if (media.schema) {
        previous.schema =
          protectRefs && typeof previous.schema?.$ref === "string"
            ? previous.schema
            : mergeSchema(previous.schema, media.schema, 0);
      }
      if (media.examples) {
        previous.examples = { ...(previous.examples ?? {}), ...media.examples };
      }
      for (const key of Object.keys(media)) {
        if (key.startsWith("x-")) previous[key] = media[key];
      }
    }
  }

  return next;
}
