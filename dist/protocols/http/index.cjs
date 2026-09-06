"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/protocols/http/index.ts
var http_exports = {};
__export(http_exports, {
  HttpAdapter: () => HttpAdapter,
  SseParser: () => SseParser,
  buildCollection: () => buildCollection,
  buildEnvironment: () => buildEnvironment,
  buildRunOptions: () => buildRunOptions,
  createResolver: () => createResolver,
  locateOperation: () => locateOperation,
  resolveServerUrl: () => resolveServerUrl,
  runWithPostman: () => runWithPostman
});
module.exports = __toCommonJS(http_exports);

// src/openapi/sample.ts
function sampleFromSchema(schema, depth = 0) {
  if (!schema || typeof schema !== "object" || depth > 12) return null;
  if (schema.example !== void 0) return schema.example;
  if (schema.examples !== void 0) {
    if (Array.isArray(schema.examples) && schema.examples.length)
      return schema.examples[0];
    if (typeof schema.examples === "object") {
      const first = Object.values(schema.examples)[0];
      if (first !== void 0)
        return first && typeof first === "object" && "value" in first ? first.value : first;
    }
  }
  if (schema.default !== void 0) return schema.default;
  if (schema.const !== void 0) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (Array.isArray(schema.allOf) && schema.allOf.length) {
    return schema.allOf.reduce((acc, sub) => {
      const value = sampleFromSchema(sub, depth + 1);
      if (value && typeof value === "object" && !Array.isArray(value))
        return { ...acc, ...value };
      return value !== null && value !== void 0 ? value : acc;
    }, {});
  }
  for (const key of ["oneOf", "anyOf"]) {
    if (Array.isArray(schema[key]) && schema[key].length)
      return sampleFromSchema(schema[key][0], depth + 1);
  }
  const declared = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") ?? "null" : schema.type;
  const effective = declared ?? (schema.properties ? "object" : schema.items ? "array" : schema.format ? "string" : "string");
  switch (effective) {
    case "object": {
      const out = {};
      const required = Array.isArray(schema.required) ? schema.required : [];
      const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
      for (const [key, sub] of Object.entries(properties)) {
        if (sub && sub.readOnly === true) continue;
        if (depth > 2 && required.length && !required.includes(key)) continue;
        out[key] = sampleFromSchema(sub, depth + 1);
      }
      if (!Object.keys(out).length && schema.additionalProperties && typeof schema.additionalProperties === "object") {
        out.key = sampleFromSchema(schema.additionalProperties, depth + 1);
      }
      return out;
    }
    case "array": {
      const count = Math.max(1, Math.min(Number(schema.minItems) || 1, 2));
      return Array.from(
        { length: count },
        () => sampleFromSchema(schema.items, depth + 1)
      );
    }
    case "integer":
      return clampNumber(schema, Math.trunc(schema.minimum ?? 0));
    case "number":
      return clampNumber(schema, schema.minimum ?? 0);
    case "boolean":
      return false;
    case "null":
      return null;
    default:
      return sampleString(schema);
  }
}
function clampNumber(schema, base) {
  let value = base;
  if (typeof schema.minimum === "number" && value < schema.minimum)
    value = schema.minimum;
  if (typeof schema.maximum === "number" && value > schema.maximum)
    value = schema.maximum;
  return value;
}
function sampleString(schema) {
  switch (schema.format) {
    case "date-time":
      return (/* @__PURE__ */ new Date()).toISOString();
    case "date":
      return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    case "time":
      return (/* @__PURE__ */ new Date()).toISOString().slice(11, 19);
    case "uuid":
      return "00000000-0000-4000-8000-000000000000";
    case "email":
      return "user@example.com";
    case "hostname":
      return "example.com";
    case "ipv4":
      return "127.0.0.1";
    case "ipv6":
      return "::1";
    case "uri":
    case "url":
    case "uri-reference":
      return "https://example.com";
    case "byte":
      return "";
    case "binary":
      return "";
    case "password":
      return "password";
    default: {
      if (typeof schema.pattern === "string") return "";
      const min = Number(schema.minLength) || 0;
      const base = "string";
      return min > base.length ? base.padEnd(min, "x") : base;
    }
  }
}

// src/protocols/http/environment.ts
var SECRET_KEY_PATTERN = /(token|secret|password|passwd|apikey|api_key|credential|private)/i;
function resolveServerUrl(servers, options) {
  if (options.serverUrl) return stripTrailingSlash(options.serverUrl);
  const server = Array.isArray(servers) && servers.length ? servers[0] : { url: "/" };
  let url = typeof server?.url === "string" && server.url ? server.url : "/";
  const variables = server?.variables && typeof server.variables === "object" ? server.variables : {};
  for (const [name, definition] of Object.entries(variables)) {
    const override = options.serverVariables?.[name];
    const fallback = definition?.default ?? (Array.isArray(definition?.enum) && definition.enum.length ? definition.enum[0] : "");
    const value = override !== void 0 ? override : fallback;
    url = url.split(`{${name}}`).join(String(value ?? ""));
  }
  url = url.replace(/\{[^}]*\}/g, "");
  return stripTrailingSlash(url);
}
function stripTrailingSlash(url) {
  return url.replace(/\/+$/, "") || url;
}
function buildEnvironment(name, baseUrl, variables = {}) {
  const values = [
    { key: "baseUrl", value: baseUrl, type: "default", enabled: true },
    ...Object.entries(variables ?? {}).filter(([key]) => key !== "baseUrl").map(([key, value]) => ({
      key,
      value: value == null ? "" : String(value),
      type: SECRET_KEY_PATTERN.test(key) ? "secret" : "default",
      enabled: true
    }))
  ];
  return {
    id: `protokit-env-${Date.now().toString(36)}`,
    name,
    values,
    _postman_variable_scope: "environment",
    _postman_exported_at: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// src/protocols/http/detect.ts
var STREAM_MEDIA_TYPES = [
  "text/event-stream",
  "application/json-seq",
  "application/x-ndjson",
  "application/ndjson",
  "application/jsonl"
];
function isStreamingOperation(operation, values) {
  const accept = Object.entries(values?.header ?? {}).find(
    ([key]) => key.toLowerCase() === "accept"
  )?.[1];
  if (typeof accept === "string" && accept.toLowerCase().includes("text/event-stream"))
    return true;
  const responses = operation?.responses;
  if (!responses || typeof responses !== "object") return false;
  for (const response of Object.values(responses)) {
    const content = response?.content;
    if (!content || typeof content !== "object") continue;
    for (const [mediaType, media] of Object.entries(content)) {
      const lower = mediaType.toLowerCase();
      if (lower.startsWith("text/event-stream")) return true;
      if (media && typeof media.itemSchema === "object" && STREAM_MEDIA_TYPES.some((t) => lower.startsWith(t))) {
        return true;
      }
    }
  }
  return false;
}
function isSseContentType(contentType) {
  return !!contentType && /text\/event-stream/i.test(contentType);
}
function isStreamingContentType(contentType) {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  return STREAM_MEDIA_TYPES.some((type) => lower.includes(type));
}
function acceptHeaderFor(operation) {
  const types = /* @__PURE__ */ new Set();
  const responses = operation?.responses;
  if (!responses || typeof responses !== "object") return void 0;
  for (const response of Object.values(responses)) {
    for (const mediaType of Object.keys(response?.content ?? {})) {
      if (mediaType !== "*/*") types.add(mediaType);
    }
  }
  if (!types.size) return void 0;
  const list = Array.from(types);
  list.sort(
    (a, b) => Number(b.toLowerCase().startsWith("text/event-stream")) - Number(a.toLowerCase().startsWith("text/event-stream"))
  );
  return list.slice(0, 8).join(", ");
}

// src/protocols/http/scripts.ts
function normalizeSources(input) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  return list.filter(
    (entry) => !!entry && entry.exec != null
  );
}
function toExecLines(exec) {
  if (Array.isArray(exec)) return exec.map((line) => String(line));
  return String(exec).split(/\r?\n/);
}
function toEvents(listen, sources) {
  return sources.map((source, index) => ({
    listen,
    script: {
      id: source.id ?? `protokit-${listen}-${index}`,
      type: "text/javascript",
      exec: toExecLines(source.exec)
    }
  })).filter(
    (event) => event.script.exec.some((line) => line.trim().length > 0)
  );
}
function readSpecScripts(node) {
  const extension = node?.["x-postman-scripts"];
  if (!extension || typeof extension !== "object") return { pre: [], test: [] };
  const coerce = (value) => {
    if (value == null) return [];
    if (typeof value === "string") return [{ exec: value }];
    if (Array.isArray(value)) {
      if (!value.length) return [];
      if (typeof value[0] === "string") return [{ exec: value }];
      return value.filter(
        (entry) => entry && entry.exec != null
      );
    }
    if (typeof value === "object" && value.exec != null)
      return [value];
    return [];
  };
  return {
    pre: coerce(
      extension.preRequest ?? extension.prerequest ?? extension.collectionPreRequest
    ),
    test: coerce(extension.test ?? extension.tests ?? extension.collectionTest)
  };
}
function buildCollectionEvents(spec, config) {
  const fromSpec = config?.fromSpecExtensions === false ? { pre: [], test: [] } : readSpecScripts(spec);
  return [
    ...toEvents("prerequest", [
      ...fromSpec.pre,
      ...normalizeSources(config?.collectionPreRequest)
    ]),
    ...toEvents("test", [
      ...fromSpec.test,
      ...normalizeSources(config?.collectionTest)
    ])
  ];
}
function buildItemEvents(operation, config) {
  const fromSpec = config?.fromSpecExtensions === false ? { pre: [], test: [] } : readSpecScripts(operation);
  return [
    ...toEvents("prerequest", [
      ...fromSpec.pre,
      ...normalizeSources(config?.preRequest)
    ]),
    ...toEvents("test", [...fromSpec.test, ...normalizeSources(config?.test)])
  ];
}

// src/protocols/http/collection.ts
var STANDARD_METHODS = /* @__PURE__ */ new Set([
  "GET",
  "PUT",
  "POST",
  "DELETE",
  "OPTIONS",
  "HEAD",
  "PATCH",
  "TRACE"
]);
function pickContentType(operation, values) {
  if (values?.contentType) return values.contentType;
  const content = operation?.requestBody?.content;
  if (!content || typeof content !== "object") return void 0;
  const keys = Object.keys(content);
  if (!keys.length) return void 0;
  return keys.find((key) => key.includes("json")) ?? keys[0];
}
function serializeQueryParam(parameter, value) {
  const name = parameter.name;
  const style = parameter.style ?? "form";
  const explode = parameter.explode ?? style === "form";
  if (Array.isArray(value)) {
    if (explode)
      return value.map((entry) => ({ key: name, value: stringify(entry) }));
    const separator = style === "spaceDelimited" ? " " : style === "pipeDelimited" ? "|" : ",";
    return [{ key: name, value: value.map(stringify).join(separator) }];
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (style === "deepObject") {
      return entries.map(([key, entry]) => ({
        key: `${name}[${key}]`,
        value: stringify(entry)
      }));
    }
    if (explode)
      return entries.map(([key, entry]) => ({ key, value: stringify(entry) }));
    return [
      {
        key: name,
        value: entries.flatMap(([key, entry]) => [key, stringify(entry)]).join(",")
      }
    ];
  }
  return [{ key: name, value: stringify(value) }];
}
function stringify(value) {
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
function buildAuth(auth) {
  if (!auth || auth.type === "none") return void 0;
  switch (auth.type) {
    case "bearer":
      return {
        type: "bearer",
        bearer: [{ key: "token", value: auth.token ?? "", type: "string" }]
      };
    case "basic":
      return {
        type: "basic",
        basic: [
          { key: "username", value: auth.username ?? "", type: "string" },
          { key: "password", value: auth.password ?? "", type: "string" }
        ]
      };
    case "apikey":
      return {
        type: "apikey",
        apikey: [
          { key: "key", value: auth.key ?? "X-API-Key", type: "string" },
          { key: "value", value: auth.value ?? "", type: "string" },
          { key: "in", value: auth.in ?? "header", type: "string" }
        ]
      };
    default:
      return void 0;
  }
}
function buildCollection(located, spec, options) {
  const values = options.values ?? {};
  const baseUrl = resolveServerUrl(located.servers, options);
  const contentType = pickContentType(located.operation, values);
  const pathVariables = [];
  for (const parameter of located.parameters.filter((p) => p.in === "path")) {
    const provided = values.path?.[parameter.name];
    const value = provided !== void 0 ? provided : sampleFromSchema(parameter.schema ?? {});
    pathVariables.push({ key: parameter.name, value: stringify(value) });
  }
  const pathSegments = located.path.replace(/^\//, "").split("/").filter((segment) => segment.length > 0).map(
    (segment) => segment.replace(/\{([^}]+)\}/g, (_match, name) => `:${name}`)
  );
  const query = [];
  const declaredQueryNames = /* @__PURE__ */ new Set();
  for (const parameter of located.parameters.filter((p) => p.in === "query")) {
    declaredQueryNames.add(parameter.name);
    const hasValue = values.query != null && Object.prototype.hasOwnProperty.call(values.query, parameter.name);
    const value = hasValue ? values.query[parameter.name] : parameter.required ? sampleFromSchema(parameter.schema ?? {}) : void 0;
    if (value === void 0 || value === null) {
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
  const header = [];
  const seenHeaders = /* @__PURE__ */ new Set();
  const addHeader = (key, value) => {
    const lower = key.toLowerCase();
    if (seenHeaders.has(lower)) return;
    seenHeaders.add(lower);
    header.push({ key, value });
  };
  for (const [key, value] of Object.entries(values.header ?? {})) {
    if (value != null) addHeader(key, stringify(value));
  }
  for (const parameter of located.parameters.filter((p) => p.in === "header")) {
    if (/^(accept|content-type|authorization)$/i.test(parameter.name)) continue;
    const value = parameter.required ? sampleFromSchema(parameter.schema ?? {}) : void 0;
    if (value != null && value !== "")
      addHeader(parameter.name, stringify(value));
  }
  if (contentType) addHeader("Content-Type", contentType);
  const accept = acceptHeaderFor(located.operation);
  if (accept) addHeader("Accept", accept);
  const cookieParameters = located.parameters.filter((p) => p.in === "cookie");
  const cookiePairs = [];
  for (const parameter of cookieParameters) {
    const provided = values.cookie?.[parameter.name];
    const value = provided !== void 0 ? provided : parameter.required ? sampleFromSchema(parameter.schema ?? {}) : void 0;
    if (value != null)
      cookiePairs.push(
        `${parameter.name}=${encodeURIComponent(stringify(value))}`
      );
  }
  for (const [key, value] of Object.entries(values.cookie ?? {})) {
    if (cookieParameters.some((p) => p.name === key) || value == null) continue;
    cookiePairs.push(`${key}=${encodeURIComponent(stringify(value))}`);
  }
  if (cookiePairs.length) addHeader("Cookie", cookiePairs.join("; "));
  let body;
  const requestBody = located.operation.requestBody;
  if (requestBody && contentType) {
    const schema = requestBody.content?.[contentType]?.schema;
    const payload = values.body !== void 0 ? values.body : sampleFromSchema(schema ?? {});
    if (contentType.includes("json")) {
      body = {
        mode: "raw",
        raw: typeof payload === "string" ? payload : JSON.stringify(payload ?? {}, null, 2),
        options: { raw: { language: "json" } }
      };
    } else if (contentType.includes("x-www-form-urlencoded")) {
      body = {
        mode: "urlencoded",
        urlencoded: toFieldList(payload).map(([key, value]) => ({
          key,
          value: stringify(value),
          type: "text"
        }))
      };
    } else if (contentType.includes("multipart/form-data")) {
      body = {
        mode: "formdata",
        formdata: toFieldList(payload).map(
          ([key, value]) => value && typeof value === "object" && "__file" in value ? { key, type: "file", src: String(value.__file) } : { key, type: "text", value: stringify(value) }
        )
      };
    } else if (contentType.includes("xml") || contentType.startsWith("text/")) {
      body = {
        mode: "raw",
        raw: typeof payload === "string" ? payload : stringify(payload)
      };
    } else {
      body = { mode: "raw", raw: stringify(payload) };
    }
  }
  const activeQuery = query.filter((entry) => !entry.disabled);
  let raw = `{{baseUrl}}/${pathSegments.join("/")}`;
  const queryString = activeQuery.map(
    (entry) => `${encodeURIComponent(entry.key)}=${encodeURIComponent(entry.value)}`
  ).join("&");
  const extraQuery = values.querystring ? String(values.querystring).replace(/^\?/, "") : "";
  const combined = [queryString, extraQuery].filter(Boolean).join("&");
  if (combined) raw += `?${combined}`;
  const url = {
    raw,
    host: ["{{baseUrl}}"],
    path: pathSegments
  };
  if (query.length) url.query = query;
  if (pathVariables.length) url.variable = pathVariables;
  const methodUpper = located.method.toUpperCase();
  const request = {
    method: methodUpper,
    header,
    url,
    description: located.operation.description ?? located.operation.summary
  };
  if (body) request.body = body;
  const itemEvents = buildItemEvents(located.operation, options.scripts);
  const collectionEvents = buildCollectionEvents(spec, options.scripts);
  const auth = buildAuth(options.auth);
  const collection = {
    info: {
      _postman_id: `protokit-${Date.now().toString(36)}`,
      name: spec?.info?.title ?? "OpenAPI Debug Session",
      description: spec?.info?.description,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    item: [
      {
        name: located.operation.operationId ?? `${methodUpper} ${located.path}`,
        ...itemEvents.length ? { event: itemEvents } : {},
        request,
        response: []
      }
    ],
    variable: [{ key: "baseUrl", value: baseUrl }]
  };
  if (auth) collection.auth = auth;
  if (collectionEvents.length) collection.event = collectionEvents;
  return {
    collection,
    baseUrl,
    contentType,
    isCustomMethod: !STANDARD_METHODS.has(methodUpper)
  };
}
function toFieldList(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return [];
  return Object.entries(payload);
}

// src/protocols/http/runner.ts
var import_postman_runtime = __toESM(require("postman-runtime"), 1);
var import_postman_collection2 = __toESM(require("postman-collection"), 1);

// src/core/errors.ts
var ProtoKitError = class _ProtoKitError extends Error {
  code;
  details;
  constructor(message, code, details) {
    super(message);
    this.name = "ProtoKitError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, _ProtoKitError.prototype);
    if (Error.captureStackTrace) Error.captureStackTrace(this, _ProtoKitError);
  }
};
function err(code, message, details) {
  return new ProtoKitError(message, code, details);
}
function toErrorInfo(e) {
  if (e instanceof ProtoKitError)
    return { message: e.message, code: e.code, name: e.name };
  if (e instanceof Error)
    return { message: e.message, code: e.code, name: e.name };
  if (typeof e === "string") return { message: e };
  try {
    return { message: JSON.stringify(e) };
  } catch {
    return { message: String(e) };
  }
}

// src/core/utils.ts
function jsonClone(value) {
  const seen = /* @__PURE__ */ new WeakSet();
  return JSON.parse(
    JSON.stringify(value, (_key, val) => {
      if (val && typeof val === "object") {
        if (seen.has(val)) return void 0;
        seen.add(val);
      }
      return val;
    })
  );
}
function deepMerge(base, override) {
  if (!override) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === void 0) continue;
    const prev = out[key];
    if (isPlainObject(prev) && isPlainObject(value)) {
      out[key] = deepMerge(prev, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function createLatch() {
  let settled = false;
  let resolveFn;
  let rejectFn;
  const promise = new Promise((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  return {
    promise,
    get settled() {
      return settled;
    },
    resolve(value) {
      if (settled) return;
      settled = true;
      resolveFn(value);
    },
    reject(reason) {
      if (settled) return;
      settled = true;
      rejectFn(reason);
    }
  };
}
function safeClearTimeout(timer) {
  if (timer) {
    try {
      clearTimeout(timer);
    } catch {
    }
  }
  return null;
}

// src/protocols/http/sse-parser.ts
var SENTINELS = /* @__PURE__ */ new Set(["[DONE]", "DONE"]);
var SseParser = class {
  buffer = "";
  decoder = new TextDecoder("utf-8");
  lastEventId;
  sequence = 0;
  /** Feed a chunk and return every complete event it produced. */
  push(chunk) {
    if (chunk == null) return [];
    if (typeof chunk === "string") {
      this.buffer += chunk;
    } else {
      const view = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      this.buffer += this.decoder.decode(view, { stream: true });
    }
    if (this.sequence === 0 && this.buffer.charCodeAt(0) === 65279) {
      this.buffer = this.buffer.slice(1);
    }
    const events = [];
    const boundary = /\r\n\r\n|\n\n|\r\r/;
    for (; ; ) {
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
  flush() {
    try {
      this.buffer += this.decoder.decode();
    } catch {
    }
    const remainder = this.buffer;
    this.buffer = "";
    if (!remainder.trim()) return [];
    const event = this.parseBlock(remainder);
    return event ? [event] : [];
  }
  reset() {
    this.buffer = "";
    this.lastEventId = void 0;
    this.sequence = 0;
  }
  parseBlock(block) {
    const lines = block.split(/\r\n|\n|\r/);
    const dataLines = [];
    const event = {
      data: "",
      receivedAt: Date.now(),
      direction: "in"
    };
    let sawField = false;
    for (const line of lines) {
      if (line === "") continue;
      if (line.startsWith(":")) continue;
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
          if (!value.includes("\0")) {
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
          break;
      }
    }
    if (!sawField) return null;
    event.data = dataLines.join("\n");
    if (event.id === void 0 && this.lastEventId !== void 0)
      event.id = this.lastEventId;
    const trimmed = event.data.trim();
    if (trimmed && !SENTINELS.has(trimmed)) {
      try {
        event.parsed = JSON.parse(event.data);
      } catch {
      }
    }
    this.sequence += 1;
    return event;
  }
};

// src/protocols/http/runner-options.ts
var import_postman_collection = __toESM(require("postman-collection"), 1);
function toVariableScope(values, seed = []) {
  const entries = [
    ...seed,
    ...Object.entries(values ?? {}).map(([key, value]) => ({
      key,
      value: value == null ? "" : String(value)
    }))
  ];
  const deduped = /* @__PURE__ */ new Map();
  for (const entry of entries) deduped.set(entry.key, entry);
  return new import_postman_collection.default.VariableScope({ values: Array.from(deduped.values()) });
}
function buildRunOptions(options, input) {
  const requestTimeout = options.runner?.timeout?.request ?? options.timeout ?? 3e4;
  const streamBudget = input.streaming ? options.maxStreamMs ?? 3e4 : 0;
  const defaultRequester = {
    strictSSL: true,
    followRedirects: true,
    followOriginalHttpMethod: false,
    maxRedirects: 10,
    useWhatWGUrlParser: true,
    removeRefererHeaderOnRedirect: false,
    insecureHTTPParser: false,
    // Timings and verbose history power the firstByteMs metric and replay list.
    timings: true,
    verbose: true,
    implicitCacheControl: true,
    implicitTraceHeader: true,
    disableCookies: false,
    protocolVersion: "http1",
    maxInvokableNestedRequests: 5
  };
  const defaults = {
    iterationCount: 1,
    // Halt gracefully so item and iteration callbacks still fire on failure.
    stopOnError: false,
    abortOnError: false,
    stopOnFailure: false,
    abortOnFailure: false,
    timeout: {
      request: requestTimeout,
      script: 15e3,
      // The global budget must outlast the request plus the streaming window.
      global: requestTimeout + streamBudget + 15e3
    },
    delay: { item: 0, iteration: 0 },
    script: { serializeLogs: false },
    ignoreProxyEnvironmentVariables: false,
    requester: defaultRequester
  };
  const merged = deepMerge(defaults, {});
  const final = deepMerge(merged, options.runner ?? {});
  if (!final.environment) {
    final.environment = toVariableScope(options.variables, [
      { key: "baseUrl", value: input.baseUrl }
    ]);
  }
  if (!final.globals && options.globals) {
    final.globals = toVariableScope(options.globals);
  }
  if (!final.localVariables && options.localVariables) {
    final.localVariables = toVariableScope(options.localVariables);
  }
  if (Array.isArray(final.data) && final.data.length && options.runner?.iterationCount === void 0) {
    final.iterationCount = final.data.length;
  }
  return final;
}

// src/protocols/http/runner.ts
function headersOf(headerList) {
  const out = {};
  const all = typeof headerList?.all === "function" ? headerList.all() : [];
  for (const entry of all ?? []) {
    if (!entry || entry.disabled) continue;
    const key = String(entry.key ?? "");
    if (!key) continue;
    out[key] = out[key] ? `${out[key]}, ${String(entry.value ?? "")}` : String(entry.value ?? "");
  }
  return out;
}
function scopeToObject(scope) {
  if (!scope) return void 0;
  try {
    const source = scope.values ?? scope;
    const list = typeof source.toJSON === "function" ? source.toJSON() : source;
    if (!Array.isArray(list)) return void 0;
    const out = {};
    for (const entry of list) {
      if (!entry || entry.enabled === false || entry.key == null) continue;
      out[String(entry.key)] = entry.value == null ? "" : String(entry.value);
    }
    return out;
  } catch {
    return void 0;
  }
}
function tryParseJson(text, contentType) {
  if (!text) return void 0;
  if (contentType && !/json/i.test(contentType)) return void 0;
  const trimmed = text.trim();
  if (!trimmed) return void 0;
  if (!/^[[{"\-\d]|^(true|false|null)$/.test(trimmed)) return void 0;
  try {
    return JSON.parse(trimmed);
  } catch {
    return void 0;
  }
}
function extractRequestBody(request) {
  const body = request?.body;
  if (!body) return void 0;
  try {
    if (body.mode === "raw") return body.raw;
    if (typeof body.toString === "function") {
      const text = body.toString();
      return text || void 0;
    }
    return jsonClone(body);
  } catch {
    return void 0;
  }
}
function runWithPostman(input, options) {
  const latch = createLatch();
  const startedAt = Date.now();
  let firstByteAt;
  let streaming = input.streamingHint;
  let stopRequested = false;
  let truncated = false;
  const parser = new SseParser();
  const events = [];
  const bodyChunks = [];
  let receivedBytes = 0;
  const report = {
    prerequest: [],
    test: [],
    assertions: [],
    console: [],
    passed: true,
    skipped: false
  };
  const replays = [];
  let captured = null;
  let runHandle = null;
  let streamTimer = null;
  let hardTimer = null;
  const maxEvents = options.maxEvents ?? 100;
  const maxStreamMs = options.maxStreamMs ?? 3e4;
  const requestTimeout = options.runner?.timeout?.request ?? options.timeout ?? 3e4;
  const stopStream = (reason) => {
    if (stopRequested) return;
    stopRequested = true;
    truncated = true;
    report.console.push({
      level: "debug",
      messages: [`[protokit] stream sampling stopped: ${reason}`],
      at: Date.now()
    });
    try {
      runHandle?.abort?.();
    } catch {
    }
  };
  const toScriptOutcome = (entry, target) => ({
    target,
    scriptId: entry?.script?.id ?? entry?.event?.script?.id,
    error: entry?.error ? { name: entry.error.name, message: entry.error.message } : void 0,
    environment: scopeToObject(entry?.result?.environment),
    globals: scopeToObject(entry?.result?.globals),
    return: entry?.result?.return
  });
  const finalize = () => {
    streamTimer = safeClearTimeout(streamTimer);
    hardTimer = safeClearTimeout(hardTimer);
    if (streaming) {
      for (const event of parser.flush()) {
        if (events.length < maxEvents) {
          events.push(event);
          safeInvoke(() => options.onEvent?.(event));
        }
      }
    }
    if (!captured) {
      const endedAt = Date.now();
      captured = {
        protocol: streaming ? "sse" : "http",
        request: { method: "", url: "", headers: {} },
        response: {
          status: stopRequested && events.length ? 200 : 0,
          statusText: stopRequested ? "Stream sampling stopped" : "No response received",
          headers: {},
          contentType: streaming ? "text/event-stream" : void 0,
          ...streaming ? { events } : {},
          timings: {
            startedAt,
            endedAt,
            durationMs: endedAt - startedAt,
            firstByteMs: firstByteAt ? firstByteAt - startedAt : void 0
          },
          sizeBytes: receivedBytes,
          ...truncated ? { truncated: true } : {}
        },
        ...stopRequested && events.length ? {} : { error: { message: "Runner finished without a response" } }
      };
    } else if (streaming) {
      captured.response.events = events;
      if (truncated) captured.response.truncated = true;
    }
    captured.scripts = report;
    latch.resolve(captured);
  };
  hardTimer = setTimeout(
    () => {
      if (latch.settled) return;
      report.console.push({
        level: "error",
        messages: ["[protokit] hard timeout reached, forcing completion"],
        at: Date.now()
      });
      try {
        runHandle?.abort?.();
      } catch {
      }
      truncated = true;
      finalize();
    },
    requestTimeout + maxStreamMs + 3e4
  );
  if (typeof hardTimer === "object" && typeof hardTimer.unref === "function") {
    hardTimer.unref();
  }
  let collection;
  try {
    collection = new import_postman_collection2.default.Collection(jsonClone(input.collectionJson));
  } catch (e) {
    hardTimer = safeClearTimeout(hardTimer);
    return Promise.reject(
      err(
        "BAD_COLLECTION",
        `Failed to construct collection: ${toErrorInfo(e).message}`,
        e
      )
    );
  }
  let runOptions;
  try {
    runOptions = buildRunOptions(options, {
      baseUrl: input.baseUrl,
      streaming: input.streamingHint
    });
  } catch (e) {
    hardTimer = safeClearTimeout(hardTimer);
    return Promise.reject(
      err(
        "BAD_RUN_OPTIONS",
        `Failed to build runtime options: ${toErrorInfo(e).message}`,
        e
      )
    );
  }
  let runner;
  try {
    runner = new import_postman_runtime.default.Runner();
  } catch (e) {
    hardTimer = safeClearTimeout(hardTimer);
    return Promise.reject(
      err(
        "RUNTIME_INIT",
        `Failed to create runner: ${toErrorInfo(e).message}`,
        e
      )
    );
  }
  runner.run(collection, runOptions, (initError, run) => {
    if (initError) {
      hardTimer = safeClearTimeout(hardTimer);
      latch.reject(
        err(
          "RUNTIME_INIT",
          initError.message ?? "Runner initialization failed",
          initError
        )
      );
      return;
    }
    runHandle = run;
    run.start({
      console(_cursor, level, ...logs) {
        const log = {
          level: typeof level === "string" ? level : "log",
          messages: logs,
          at: Date.now()
        };
        report.console.push(log);
        safeInvoke(() => options.onConsole?.(log));
      },
      assertion(_cursor, assertions) {
        for (const raw of assertions ?? []) {
          const assertion = {
            name: raw?.name ?? "assertion",
            passed: !raw?.error && !raw?.skipped,
            skipped: !!raw?.skipped,
            index: typeof raw?.index === "number" ? raw.index : 0,
            error: raw?.error ? {
              name: raw.error.name,
              message: raw.error.message ?? String(raw.error),
              stack: raw.error.stack
            } : void 0
          };
          if (!assertion.passed && !assertion.skipped) report.passed = false;
          report.assertions.push(assertion);
          safeInvoke(() => options.onAssertion?.(assertion));
        }
      },
      prerequest(_error, _cursor, results) {
        for (const entry of results ?? [])
          report.prerequest.push(toScriptOutcome(entry, "prerequest"));
      },
      test(_error, _cursor, results) {
        for (const entry of results ?? [])
          report.test.push(toScriptOutcome(entry, "test"));
      },
      item(_error, _cursor, _item, _visualizer, result) {
        if (result?.isSkipped) report.skipped = true;
      },
      // Fires as soon as headers arrive, before the body is complete.
      responseStart(_error, _cursor, response) {
        firstByteAt = Date.now();
        const contentType = safeGetHeader(response, "content-type");
        if (isSseContentType(contentType) || isStreamingContentType(contentType))
          streaming = true;
        safeInvoke(
          () => options.onResponseStart?.({
            status: response?.code ?? 0,
            headers: headersOf(response?.headers),
            contentType
          })
        );
        if (streaming && !streamTimer) {
          streamTimer = setTimeout(
            () => stopStream("maxStreamMs reached"),
            maxStreamMs
          );
          if (typeof streamTimer === "object" && typeof streamTimer.unref === "function") {
            streamTimer.unref();
          }
        }
      },
      // Fires for every complete server-sent event, or for each body chunk.
      responseData(_cursor, data) {
        if (stopRequested || data == null) return;
        let chunk;
        try {
          chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
        } catch {
          return;
        }
        receivedBytes += chunk.length;
        if (!streaming) {
          bodyChunks.push(chunk);
          return;
        }
        for (const event of parser.push(chunk)) {
          if (events.length >= maxEvents) {
            stopStream("maxEvents reached");
            return;
          }
          events.push(event);
          safeInvoke(() => options.onEvent?.(event));
          if (events.length >= maxEvents) {
            stopStream("maxEvents reached");
            return;
          }
        }
      },
      // Fires once the request completes, including any replays.
      request(requestError, _cursor, response, request, _item, cookies) {
        const endedAt = Date.now();
        const requestInfo = {
          method: request?.method ?? "",
          url: safeUrlString(request),
          headers: headersOf(request?.headers),
          body: extractRequestBody(request)
        };
        if (requestError) {
          captured = {
            protocol: streaming ? "sse" : "http",
            request: requestInfo,
            response: {
              status: 0,
              statusText: "Request failed",
              headers: {},
              timings: { startedAt, endedAt, durationMs: endedAt - startedAt },
              sizeBytes: receivedBytes
            },
            error: toErrorInfo(requestError),
            replays
          };
          return;
        }
        const contentType = safeGetHeader(response, "content-type");
        if (isSseContentType(contentType) || isStreamingContentType(contentType))
          streaming = true;
        let text;
        let body;
        if (!streaming) {
          const buffer = bodyChunks.length ? Buffer.concat(bodyChunks) : response?.stream ? Buffer.from(response.stream) : Buffer.alloc(0);
          text = looksBinary(buffer) ? void 0 : buffer.toString("utf8");
          body = tryParseJson(text, contentType);
        }
        captured = {
          protocol: streaming ? "sse" : "http",
          request: requestInfo,
          response: {
            status: typeof response?.code === "number" ? response.code : 0,
            statusText: safeReason(response),
            headers: headersOf(response?.headers),
            contentType,
            ...streaming ? { events } : { body, text },
            timings: {
              startedAt,
              endedAt,
              durationMs: typeof response?.responseTime === "number" ? response.responseTime : endedAt - startedAt,
              firstByteMs: firstByteAt ? firstByteAt - startedAt : void 0
            },
            sizeBytes: receivedBytes || response?.responseSize || 0,
            ...truncated ? { truncated: true } : {}
          },
          cookies: Array.isArray(cookies) ? cookies.map((cookie) => ({
            name: String(cookie?.name ?? ""),
            value: String(cookie?.value ?? ""),
            domain: cookie?.domain,
            path: cookie?.path
          })) : [],
          replays
        };
      },
      // Captures auxiliary traffic such as OAuth token refreshes and redirects.
      io(_error, _cursor, trace, response, request) {
        if (trace?.type !== "http") return;
        if (!trace.source || trace.source === "collection") return;
        replays.push({
          url: safeUrlString(request),
          method: request?.method ?? "",
          status: typeof response?.code === "number" ? response.code : 0,
          reason: String(trace.source)
        });
      },
      exception(_cursor, exception) {
        report.console.push({
          level: "error",
          messages: [`[exception] ${toErrorInfo(exception).message}`],
          at: Date.now()
        });
      },
      done(doneError) {
        if (doneError && !captured && !stopRequested) {
          streamTimer = safeClearTimeout(streamTimer);
          hardTimer = safeClearTimeout(hardTimer);
          latch.reject(
            err("RUNTIME_RUN", doneError.message ?? "Run failed", doneError)
          );
          return;
        }
        finalize();
      }
    });
  });
  return latch.promise;
}
function safeInvoke(fn) {
  try {
    fn();
  } catch {
  }
}
function safeGetHeader(response, name) {
  try {
    const value = response?.headers?.get?.(name);
    return value == null ? void 0 : String(value);
  } catch {
    return void 0;
  }
}
function safeReason(response) {
  try {
    return typeof response?.reason === "function" ? String(response.reason() ?? "") : String(response?.status ?? "");
  } catch {
    return "";
  }
}
function safeUrlString(request) {
  try {
    return typeof request?.url?.toString === "function" ? request.url.toString() : "";
  } catch {
    return "";
  }
}
function looksBinary(buffer) {
  const window = Math.min(buffer.length, 1024);
  for (let i = 0; i < window; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

// src/openapi/deref.ts
var CYCLE_MARKER = "__protokit_cycle__";
function createResolver(root) {
  const deepCache = /* @__PURE__ */ new Map();
  function byPointer(pointer) {
    if (typeof pointer !== "string" || !pointer.startsWith("#/")) {
      throw err(
        "EXTERNAL_REF",
        `Only local $ref pointers are supported, got: ${pointer}`
      );
    }
    let current = root;
    const segments = pointer.slice(2).split("/");
    for (const raw of segments) {
      if (current == null || typeof current !== "object") {
        throw err("BAD_REF", `Cannot resolve pointer "${pointer}"`);
      }
      const key = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
      current = current[key];
    }
    if (current === void 0)
      throw err("BAD_REF", `Pointer "${pointer}" resolves to undefined`);
    return current;
  }
  function deref(node) {
    let current = node;
    const visited = /* @__PURE__ */ new Set();
    let hops = 0;
    while (current && typeof current === "object" && typeof current.$ref === "string") {
      if (visited.has(current.$ref) || ++hops > 100) {
        return { type: "object", [CYCLE_MARKER]: true };
      }
      visited.add(current.$ref);
      current = byPointer(current.$ref);
    }
    return current;
  }
  function deepDeref(node, depth = 0, stack = /* @__PURE__ */ new Set()) {
    if (node == null || typeof node !== "object") return node;
    if (depth > 32) return { type: "object" };
    const resolved = deref(node);
    if (resolved == null || typeof resolved !== "object") return resolved;
    if (resolved[CYCLE_MARKER]) return { type: "object" };
    if (stack.has(resolved)) return { type: "object" };
    const nextStack = new Set(stack);
    nextStack.add(resolved);
    if (Array.isArray(resolved)) {
      return resolved.map((entry) => deepDeref(entry, depth + 1, nextStack));
    }
    const out = {};
    for (const [key, value] of Object.entries(resolved)) {
      if (key === CYCLE_MARKER) continue;
      out[key] = deepDeref(value, depth + 1, nextStack);
    }
    return out;
  }
  function deepDerefCached(node) {
    const key = node && typeof node === "object" ? node.$ref : void 0;
    if (typeof key === "string" && deepCache.has(key))
      return deepCache.get(key);
    const value = deepDeref(node);
    if (typeof key === "string") deepCache.set(key, value);
    return value;
  }
  return { deref, deepDeref: deepDerefCached, byPointer };
}

// src/openapi/locate.ts
var FIXED_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
  "query"
];
function locateOperation(spec, target) {
  if (!spec || typeof spec !== "object")
    throw err("BAD_SPEC", "spec must be an object");
  if (typeof spec.openapi !== "string")
    throw err("BAD_SPEC", "spec.openapi version string is required");
  if (!target || typeof target !== "object")
    throw err("BAD_TARGET", "target is required");
  const resolver = createResolver(spec);
  const paths = spec.paths;
  if (!paths || typeof paths !== "object")
    throw err("BAD_SPEC", "spec.paths is missing or invalid");
  const candidates = [];
  for (const [pathKey, rawPathItem] of Object.entries(paths)) {
    let pathItem2;
    try {
      pathItem2 = resolver.deref(rawPathItem);
    } catch {
      continue;
    }
    if (!pathItem2 || typeof pathItem2 !== "object") continue;
    for (const method of FIXED_METHODS) {
      if (pathItem2[method] && typeof pathItem2[method] === "object") {
        candidates.push({
          path: pathKey,
          method,
          rawOperation: pathItem2[method],
          pathItem: pathItem2,
          isCustomMethod: false
        });
      }
    }
    const additional = pathItem2.additionalOperations;
    if (additional && typeof additional === "object") {
      for (const [method, operation2] of Object.entries(additional)) {
        if (!operation2 || typeof operation2 !== "object") continue;
        candidates.push({
          path: pathKey,
          method: method.toLowerCase(),
          rawOperation: operation2,
          pathItem: pathItem2,
          isCustomMethod: true
        });
      }
    }
  }
  if (!candidates.length)
    throw err("EMPTY_SPEC", "The document does not declare any operation");
  let hit;
  if (target.operationId) {
    hit = candidates.find((c) => {
      try {
        return resolver.deref(c.rawOperation)?.operationId === target.operationId;
      } catch {
        return false;
      }
    });
    if (!hit)
      throw err(
        "OP_NOT_FOUND",
        `operationId "${target.operationId}" was not found`
      );
  } else {
    if (!target.path || !target.method) {
      throw err(
        "BAD_TARGET",
        "Provide either operationId, or both path and method"
      );
    }
    const method = String(target.method).toLowerCase();
    hit = candidates.find((c) => c.path === target.path && c.method === method);
    if (!hit) {
      throw err(
        "OP_NOT_FOUND",
        `Operation "${String(target.method).toUpperCase()} ${target.path}" was not found`
      );
    }
  }
  const operation = resolver.deepDeref(hit.rawOperation) ?? {};
  const pathItem = resolver.deref(hit.pathItem) ?? {};
  const merged = /* @__PURE__ */ new Map();
  const collect = (list) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      let resolved;
      try {
        resolved = resolver.deepDeref(entry);
      } catch {
        continue;
      }
      if (resolved && typeof resolved.name === "string" && typeof resolved.in === "string") {
        merged.set(`${resolved.in}:${resolved.name}`, resolved);
      }
    }
  };
  collect(pathItem.parameters);
  collect(hit.rawOperation.parameters);
  const servers = Array.isArray(operation.servers) && operation.servers.length && operation.servers || Array.isArray(pathItem.servers) && pathItem.servers.length && pathItem.servers || Array.isArray(spec.servers) && spec.servers.length && spec.servers || [
    { url: "/" }
  ];
  return {
    path: hit.path,
    method: hit.method,
    isCustomMethod: hit.isCustomMethod,
    operation,
    pathItem,
    parameters: Array.from(merged.values()),
    servers,
    security: operation.security ?? spec.security
  };
}

// src/protocols/http/index.ts
var HttpAdapter = class {
  name = "http";
  /** Lowest priority: acts as the fallback when no other adapter claims the operation. */
  supports(ctx) {
    const declared = ctx.located.operation?.["x-protocol"];
    if (typeof declared === "string" && declared !== "http" && declared !== "sse")
      return 0;
    return 1;
  }
  plan(ctx) {
    const built = buildCollection(ctx.located, ctx.spec, ctx.options);
    return {
      ...built,
      environment: buildEnvironment(
        `${ctx.spec?.info?.title ?? "API"} Environment`,
        built.baseUrl,
        ctx.options.variables
      ),
      streaming: isStreamingOperation(
        ctx.located.operation,
        ctx.options.values
      )
    };
  }
  execute(plan, options) {
    return runWithPostman(
      {
        collectionJson: plan.collection,
        baseUrl: plan.baseUrl,
        streamingHint: plan.streaming
      },
      options
    );
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HttpAdapter,
  SseParser,
  buildCollection,
  buildEnvironment,
  buildRunOptions,
  createResolver,
  locateOperation,
  resolveServerUrl,
  runWithPostman
});
//# sourceMappingURL=index.cjs.map