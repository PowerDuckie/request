import { L as LocatedOperation, E as ExecuteContext, P as ProtocolAdapter, A as AdapterContext } from './protocol-D7sEx8IP.js';
import { a as SendOptions, ak as ResolvedMcpConfig, E as ExecResult, W as InitializeSessionInit, a2 as McpDiscoveryResult, a1 as McpCapability, Z as JsonRpcOutcome, ad as McpTerminateOutcome, a5 as McpManualSessionOptions, a4 as McpManualSession, ac as McpStdioSessionOptions } from './types-C9ifzKqk.js';

/**
 * Resolve the effective MCP call.
 *
 * Precedence: `options.mcp.*` (per-call override) > `operation['x-mcp'].*`
 * (the document's declared capability, normally produced by
 * {@link writeMcpOperations}).
 */
declare function resolveMcpConfig(located: LocatedOperation, spec: any, options: SendOptions): ResolvedMcpConfig;

declare function runMcp(config: ResolvedMcpConfig, options: SendOptions, ctx?: ExecuteContext): Promise<ExecResult>;

declare const MCP_PROTOCOL_VERSION = "2025-06-18";
/**
 * Handshake with an MCP server and establish a session.
 * Every MCP interaction begins here: `initialize` negotiates the protocol
 * version and capabilities, and the client must follow up with the
 * `notifications/initialized` notification before issuing any other call.
 */
declare function initializeSession(endpoint: string, init?: InitializeSessionInit): Promise<{
    sessionId?: string;
    serverInfo?: {
        name: string;
        version: string;
    };
    protocolVersion?: string;
}>;
/**
 * Auto-fetch everything an MCP server exposes: tools, resources, resource
 * templates and prompts. This is the MCP analogue of gRPC's reflection
 * `discover()` and GraphQL's schema introspection — one call that hands back
 * every operation the endpoint can perform.
 */
declare function discoverMcpCapabilities(endpoint: string, options?: InitializeSessionInit): Promise<McpDiscoveryResult>;

interface GeneratedMcpCall {
    capability: McpCapability;
    /** JSON-RPC method for this capability. */
    method: "tools/call" | "resources/read" | "prompts/get";
    /** Sampled params, ready to send as-is or edit. */
    params: Record<string, unknown>;
    /** JSON Schema describing the editable portion of `params`. */
    argumentsSchema: any;
    notes: string[];
}
/**
 * Turn one discovered capability into a runnable call, sampling its
 * argument schema the same way the HTTP adapter samples request bodies.
 * This is the MCP counterpart of the gRPC adapter's `buildMessageTemplate`.
 */
declare function generateMcpCall(capability: McpCapability): GeneratedMcpCall;
declare function generateAllMcpCalls(capabilities: McpCapability[]): GeneratedMcpCall[];

interface WriteMcpOptions {
    /** Overwrite an existing path for the same capability. Defaults to true. */
    overwrite?: boolean;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    clientInfo?: {
        name: string;
        version: string;
    };
}
/**
 * "Upload" step: merge generated MCP calls into `spec.paths` as synthetic
 * POST operations carrying an `x-mcp` extension, each independently
 * addressable via `locateOperation({ operationId })` — the MCP counterpart of
 * {@link writeGraphQLOperations}.
 */
declare function writeMcpOperations(spec: any, endpoint: string, calls: GeneratedMcpCall[], options?: WriteMcpOptions): any;
interface DiscoverAndWriteMcpResult {
    spec: any;
    capabilities: McpCapability[];
    warnings: string[];
}
/**
 * One-shot "auto-fetch + upload" for MCP: handshake, list every tool,
 * resource and prompt the server exposes, sample arguments for each, and
 * merge the results into the document.
 */
declare function discoverAndWriteMcpCapabilities(spec: any, endpoint: string, options?: WriteMcpOptions): Promise<DiscoverAndWriteMcpResult>;

interface McpStdioOptions {
    command: string;
    args?: string[];
    cwd?: string;
    /** Undefined values explicitly remove inherited environment variables. */
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
    maxBufferBytes?: number;
}
interface McpStdioConnection {
    readonly pid: number | undefined;
    request<T = unknown>(method: string, params?: unknown, signal?: AbortSignal): Promise<T>;
    notify(method: string, params?: unknown, signal?: AbortSignal): Promise<void>;
    close(): Promise<void>;
}
declare function createMcpStdioConnection(options: McpStdioOptions): McpStdioConnection;

/**
 * MCP transport abstraction.
 *
 * A manual MCP session is transport-agnostic: it drives initialize, JSON-RPC
 * calls, notifications and termination through a small adapter, so the same
 * session logic serves both Streamable HTTP and stdio. New transports plug in
 * by implementing this interface; the session core never branches on the wire.
 */

interface McpTransportOpenInit {
    clientInfo?: {
        name: string;
        version: string;
    };
    /** Client capabilities advertised at initialize. Default: {}. */
    capabilities?: Record<string, unknown>;
    /** Client protocol version to negotiate. Default: latest supported. */
    protocolVersion?: string;
    signal?: AbortSignal;
}
interface McpTransportCallInit {
    signal?: AbortSignal;
    timeoutMs?: number;
    /** Started timestamp used for first-byte timings. */
    startedAt: number;
    /** Negotiated protocol version, when the transport needs it. */
    protocolVersion?: string;
    /** Session id from the handshake, when the transport needs it. */
    sessionId?: string;
    headers?: Record<string, string>;
}
interface McpTransport {
    readonly transport: "streamable-http" | "stdio";
    /** Perform the MCP handshake (initialize + notifications/initialized). */
    open(init: McpTransportOpenInit): Promise<{
        sessionId?: string;
        serverInfo?: {
            name: string;
            version: string;
        };
        protocolVersion?: string;
    }>;
    /** One JSON-RPC request/response exchange. Never throws on JSON-RPC errors. */
    call(body: Record<string, unknown>, init: McpTransportCallInit): Promise<JsonRpcOutcome>;
    /** One JSON-RPC notification. No response is expected. */
    notify(body: Record<string, unknown>, init: McpTransportCallInit): Promise<JsonRpcOutcome>;
    /** Best-effort session termination (HTTP DELETE / stdio no-op). */
    terminate(init: {
        sessionId?: string;
        protocolVersion?: string;
        signal?: AbortSignal;
        headers?: Record<string, string>;
    }): Promise<{
        status?: number;
        outcome: McpTerminateOutcome;
        reason?: string;
    }>;
    /** Release transport resources (e.g. kill the stdio child). Idempotent. */
    dispose(): Promise<void>;
}
declare function createHttpMcpTransport(options: {
    endpoint: string;
    headers?: Record<string, string>;
}): McpTransport;
declare function createStdioMcpTransport(options: McpStdioOptions): McpTransport;

/**
 * Long-lived, stateful MCP manual sessions.
 *
 * One session core drives both supported transports (Streamable HTTP and
 * stdio) through the `McpTransport` adapter in "./transport". The session
 * mirrors `createWsManualSession` / `createGrpcManualSession`: open, drive
 * list/call methods by hand, then close.
 */

/**
 * Build a manual session over any transport. All state, event recording,
 * pagination and close orchestration live here; only the wire differs.
 */
declare function createMcpSessionCore(transport: McpTransport, options: McpManualSessionOptions): McpManualSession;
/**
 * Create a manual MCP session over either transport.
 *
 * - `{ transport: "streamable-http", endpoint }` (default)
 * - `{ transport: "stdio", command, args?, cwd?, env? }`
 */
declare function createMcpManualSession(options: McpManualSessionOptions): McpManualSession;
/** stdio-only convenience factory. */
declare function createMcpStdioSession(options: McpStdioSessionOptions): McpManualSession;
/** @deprecated Use {@link createMcpManualSession}. */
declare const runMcpManualSession: typeof createMcpManualSession;

interface McpPlan {
    config: ResolvedMcpConfig;
    environment: Record<string, any>;
}
/**
 * MCP (Model Context Protocol) adapter, covering the Streamable HTTP and
 * stdio transports.
 *
 * An operation is claimed when it declares `x-protocol: mcp`, carries an
 * `x-mcp` extension (normally produced by {@link writeMcpOperations}), or the
 * caller passes `options.mcp`. Like GraphQL, MCP is one JSON-RPC call rather
 * than a Postman-shaped request/response, so it gets its own adapter instead
 * of routing through the HTTP one.
 */
declare class McpAdapter implements ProtocolAdapter<McpPlan> {
    readonly name = "mcp";
    supports(ctx: AdapterContext): number;
    plan(ctx: AdapterContext): McpPlan;
    execute(plan: McpPlan, options: SendOptions, ctx?: ExecuteContext): Promise<ExecResult>;
}

export { type DiscoverAndWriteMcpResult as D, type GeneratedMcpCall as G, MCP_PROTOCOL_VERSION as M, type WriteMcpOptions as W, McpAdapter as a, createMcpManualSession as b, createHttpMcpTransport as c, createMcpStdioSession as d, createStdioMcpTransport as e, discoverAndWriteMcpCapabilities as f, discoverMcpCapabilities as g, generateAllMcpCalls as h, generateMcpCall as i, initializeSession as j, runMcpManualSession as k, type McpPlan as l, type McpStdioConnection as m, type McpStdioOptions as n, type McpTransport as o, createMcpSessionCore as p, createMcpStdioConnection as q, resolveMcpConfig as r, runMcp as s, writeMcpOperations as w };
