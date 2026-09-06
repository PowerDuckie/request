import type { SendOptions, RequestValues, AuthConfig } from "../../core/types";
import type { LocatedOperation } from "../../openapi/locate";
import { sampleFromSchema } from "../../openapi/sample";
import { resolveServerUrl } from "./environment";
import { acceptHeaderFor } from "./detect";
import { buildCollectionEvents, buildItemEvents } from "./scripts";

const STANDARD_METHODS = new Set([
  "GET",
  "PUT",
  "POST",
  "DELETE",
  "OPTIONS",
  "HEAD",
  "PATCH",
  "TRACE",
]);

function pickContentType(
  operation: any,
  values?: RequestValues,
): string | undefined {
  if (values?.contentType) return values.contentType;
  const content = operation?.requestBody?.content;
  if (!content || typeof content !== "object") return undefined;
  const keys = Object.keys(content);
  if (!keys.length) return undefined;
  return keys.find((key) => key.includes("json")) ?? keys[0];
}

/** Serialize a parameter value according to its style and explode settings. */
function serializeQueryParam(
  parameter: any,
  value: unknown,
): Array<{ key: string; value: string }> {
  const name = parameter.name;
  const style = parameter.style ?? "form";
  const explode = parameter.explode ?? style === "form";

  if (Array.isArray(value)) {
    if (explode)
      return value.map((entry) => ({ key: name, value: stringify(entry) }));
    const separator =
      style === "spaceDelimited" ? " " : style === "pipeDelimited" ? "|" : ",";
    return [{ key: name, value: value.map(stringify).join(separator) }];
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (style === "deepObject") {
      return entries.map(([key, entry]) => ({
        key: `${name}[${key}]`,
        value: stringify(entry),
      }));
    }
    if (explode)
      return entries.map(([key, entry]) => ({ key, value: stringify(entry) }));
    return [
      {
        key: name,
        value: entries
          .flatMap(([key, entry]) => [key, stringify(entry)])
          .join(","),
      },
    ];
  }

  return [{ key: name, value: stringify(value) }];
}

function stringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function buildAuth(auth?: AuthConfig): Record<string, any> | undefined {
  if (!auth || auth.type === "none") return undefined;
  switch (auth.type) {
    case "bearer":
      return {
        type: "bearer",
        bearer: [{ key: "token", value: auth.token ?? "", type: "string" }],
      };
    case "basic":
      return {
        type: "basic",
        basic: [
          { key: "username", value: auth.username ?? "", type: "string" },
          { key: "password", value: auth.password ?? "", type: "string" },
        ],
      };
    case "apikey":
      return {
        type: "apikey",
        apikey: [
          { key: "key", value: auth.key ?? "X-API-Key", type: "string" },
          { key: "value", value: auth.value ?? "", type: "string" },
          { key: "in", value: auth.in ?? "header", type: "string" },
        ],
      };
    default:
      return undefined;
  }
}

export interface BuiltCollection {
  collection: Record<string, any>;
  baseUrl: string;
  contentType?: string;
  isCustomMethod: boolean;
}

export function buildCollection(
  located: LocatedOperation,
  spec: any,
  options: SendOptions,
): BuiltCollection {
  const values = options.values ?? {};
  const baseUrl = resolveServerUrl(located.servers, options);
  const contentType = pickContentType(located.operation, values);

  // ---- Path parameters ----
  const pathVariables: Array<{ key: string; value: string }> = [];
  for (const parameter of located.parameters.filter((p) => p.in === "path")) {
    const provided = values.path?.[parameter.name];
    const value =
      provided !== undefined
        ? provided
        : sampleFromSchema(parameter.schema ?? {});
    pathVariables.push({ key: parameter.name, value: stringify(value) });
  }
  const pathSegments = located.path
    .replace(/^\//, "")
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) =>
      segment.replace(/\{([^}]+)\}/g, (_match, name: string) => `:${name}`),
    );

  // ---- Query parameters ----
  const query: Array<{ key: string; value: string; disabled?: boolean }> = [];
  const declaredQueryNames = new Set<string>();
  for (const parameter of located.parameters.filter((p) => p.in === "query")) {
    declaredQueryNames.add(parameter.name);
    const hasValue =
      values.query != null &&
      Object.prototype.hasOwnProperty.call(values.query, parameter.name);
    const value = hasValue
      ? values.query![parameter.name]
      : parameter.required
        ? sampleFromSchema(parameter.schema ?? {})
        : undefined;

    if (value === undefined || value === null) {
      // Keep optional parameters visible but disabled for discoverability.
      if (!parameter.required)
        query.push({ key: parameter.name, value: "", disabled: true });
      continue;
    }
    query.push(...serializeQueryParam(parameter, value));
  }
  for (const [key, value] of Object.entries(values.query ?? {})) {
    if (declaredQueryNames.has(key) || value == null) continue;
    query.push({ key, value: stringify(value) });
  }

  // ---- Headers ----
  const header: Array<{ key: string; value: string }> = [];
  const seenHeaders = new Set<string>();
  const addHeader = (key: string, value: string) => {
    const lower = key.toLowerCase();
    if (seenHeaders.has(lower)) return;
    seenHeaders.add(lower);
    header.push({ key, value });
  };

  // Caller-supplied headers take precedence over anything derived from the spec.
  for (const [key, value] of Object.entries(values.header ?? {})) {
    if (value != null) addHeader(key, stringify(value));
  }
  for (const parameter of located.parameters.filter((p) => p.in === "header")) {
    // These three are controlled by the request body, negotiation and auth helper.
    if (/^(accept|content-type|authorization)$/i.test(parameter.name)) continue;
    const value = parameter.required
      ? sampleFromSchema(parameter.schema ?? {})
      : undefined;
    if (value != null && value !== "")
      addHeader(parameter.name, stringify(value));
  }
  if (contentType) addHeader("Content-Type", contentType);
  const accept = acceptHeaderFor(located.operation);
  if (accept) addHeader("Accept", accept);

  // ---- Cookies ----
  const cookieParameters = located.parameters.filter((p) => p.in === "cookie");
  const cookiePairs: string[] = [];
  for (const parameter of cookieParameters) {
    const provided = values.cookie?.[parameter.name];
    const value =
      provided !== undefined
        ? provided
        : parameter.required
          ? sampleFromSchema(parameter.schema ?? {})
          : undefined;
    if (value != null)
      cookiePairs.push(
        `${parameter.name}=${encodeURIComponent(stringify(value))}`,
      );
  }
  for (const [key, value] of Object.entries(values.cookie ?? {})) {
    if (cookieParameters.some((p) => p.name === key) || value == null) continue;
    cookiePairs.push(`${key}=${encodeURIComponent(stringify(value))}`);
  }
  if (cookiePairs.length) addHeader("Cookie", cookiePairs.join("; "));

  // ---- Body ----
  let body: Record<string, any> | undefined;
  const requestBody = located.operation.requestBody;
  if (requestBody && contentType) {
    const schema = requestBody.content?.[contentType]?.schema;
    const payload =
      values.body !== undefined ? values.body : sampleFromSchema(schema ?? {});

    if (contentType.includes("json")) {
      body = {
        mode: "raw",
        raw:
          typeof payload === "string"
            ? payload
            : JSON.stringify(payload ?? {}, null, 2),
        options: { raw: { language: "json" } },
      };
    } else if (contentType.includes("x-www-form-urlencoded")) {
      body = {
        mode: "urlencoded",
        urlencoded: toFieldList(payload).map(([key, value]) => ({
          key,
          value: stringify(value),
          type: "text",
        })),
      };
    } else if (contentType.includes("multipart/form-data")) {
      body = {
        mode: "formdata",
        formdata: toFieldList(payload).map(([key, value]) =>
          value && typeof value === "object" && "__file" in (value as any)
            ? { key, type: "file", src: String((value as any).__file) }
            : { key, type: "text", value: stringify(value) },
        ),
      };
    } else if (contentType.includes("xml") || contentType.startsWith("text/")) {
      body = {
        mode: "raw",
        raw: typeof payload === "string" ? payload : stringify(payload),
      };
    } else {
      body = { mode: "raw", raw: stringify(payload) };
    }
  }

  // ---- URL assembly ----
  const activeQuery = query.filter((entry) => !entry.disabled);
  let raw = `{{baseUrl}}/${pathSegments.join("/")}`;
  const queryString = activeQuery
    .map(
      (entry) =>
        `${encodeURIComponent(entry.key)}=${encodeURIComponent(entry.value)}`,
    )
    .join("&");
  const extraQuery = values.querystring
    ? String(values.querystring).replace(/^\?/, "")
    : "";
  const combined = [queryString, extraQuery].filter(Boolean).join("&");
  if (combined) raw += `?${combined}`;

  const url: Record<string, any> = {
    raw,
    host: ["{{baseUrl}}"],
    path: pathSegments,
  };
  if (query.length) url.query = query;
  if (pathVariables.length) url.variable = pathVariables;

  const methodUpper = located.method.toUpperCase();
  const request: Record<string, any> = {
    method: methodUpper,
    header,
    url,
    description: located.operation.description ?? located.operation.summary,
  };
  if (body) request.body = body;

  const itemEvents = buildItemEvents(located.operation, options.scripts);
  const collectionEvents = buildCollectionEvents(spec, options.scripts);
  const auth = buildAuth(options.auth);

  const collection: Record<string, any> = {
    info: {
      _postman_id: `protokit-${Date.now().toString(36)}`,
      name: spec?.info?.title ?? "OpenAPI Debug Session",
      description: spec?.info?.description,
      schema:
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: [
      {
        name: located.operation.operationId ?? `${methodUpper} ${located.path}`,
        ...(itemEvents.length ? { event: itemEvents } : {}),
        request,
        response: [],
      },
    ],
    variable: [{ key: "baseUrl", value: baseUrl }],
  };
  if (auth) collection.auth = auth;
  if (collectionEvents.length) collection.event = collectionEvents;

  return {
    collection,
    baseUrl,
    contentType,
    isCustomMethod: !STANDARD_METHODS.has(methodUpper),
  };
}

function toFieldList(payload: unknown): Array<[string, unknown]> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return [];
  return Object.entries(payload as Record<string, unknown>);
}
