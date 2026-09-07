import { L as LocatedOperation, a as SendOptions, b as ExecuteContext, E as ExecResult, P as ProtocolAdapter, A as AdapterContext } from '../../protocol-CIkq_Kwt.cjs';

interface ResolvedMcpConfig {
    endpoint: string;
    method: string;
    /** Fully-formed JSON-RPC `params` for `method`. */
    params: Record<string, unknown>;
    headers: Record<string, string>;
    sessionId?: string;
    clientInfo: {
        name: string;
        version: string;
    };
}
/**
 * Resolve the effective MCP call.
 *
 * Precedence: `options.mcp.*` (per-call override) > `operation['x-mcp'].*`
 * (the document's declared capability, normally produced by
 * {@link writeMcpOperations}).
 */
declare function resolveMcpConfig(located: LocatedOperation, spec: any, options: SendOptions): ResolvedMcpConfig;

/**
 * Run one MCP call.
 *
 * Every call is preceded by its own `initialize` handshake unless the caller
 * supplies a `sessionId` to reuse — MCP sessions are stateful, but this
 * toolkit models one `send()` as one self-contained sample, the same way the
 * gRPC adapter dials fresh per plan and the WebSocket adapter opens and
 * closes one socket per call. The handshake is recorded under `replays` so
 * it stays visible without being mistaken for the operation itself.
 */
declare function runMcp(config: ResolvedMcpConfig, options: SendOptions, ctx?: ExecuteContext): Promise<ExecResult>;

declare const MCP_PROTOCOL_VERSION = "2025-06-18";
interface McpTool {
    kind: "tool";
    name: string;
    description?: string;
    inputSchema: any;
}
interface McpResource {
    kind: "resource";
    /** Resource templates use `uriTemplate`; concrete resources use `uri`. */
    uri?: string;
    uriTemplate?: string;
    name: string;
    description?: string;
    mimeType?: string;
}
interface McpPrompt {
    kind: "prompt";
    name: string;
    description?: string;
    arguments?: Array<{
        name: string;
        description?: string;
        required?: boolean;
    }>;
}
type McpCapability = McpTool | McpResource | McpPrompt;
interface McpDiscoveryResult {
    serverInfo?: {
        name: string;
        version: string;
    };
    protocolVersion?: string;
    sessionId?: string;
    capabilities: McpCapability[];
    warnings: string[];
}
/**
 * Handshake with an MCP server and establish a session.
 * Every MCP interaction begins here: `initialize` negotiates the protocol
 * version and capabilities, and the client must follow up with the
 * `notifications/initialized` notification before issuing any other call.
 */
declare function initializeSession(endpoint: string, init?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    clientInfo?: {
        name: string;
        version: string;
    };
}): Promise<{
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
declare function discoverMcpCapabilities(endpoint: string, options?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    clientInfo?: {
        name: string;
        version: string;
    };
}): Promise<McpDiscoveryResult>;

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

interface McpPlan {
    config: ResolvedMcpConfig;
    environment: Record<string, any>;
}
/**
 * MCP (Model Context Protocol) adapter, using the Streamable HTTP transport.
 *
 * An operation is claimed when it declares `x-protocol: mcp`, carries an
 * `x-mcp` extension (normally produced by {@link writeMcpOperations}), or the
 * caller passes `options.mcp`. Like GraphQL, MCP is one JSON-RPC call over
 * plain HTTP rather than a Postman-shaped request/response, so it gets its
 * own adapter instead of routing through the HTTP one.
 */
declare class McpAdapter implements ProtocolAdapter<McpPlan> {
    readonly name = "mcp";
    supports(ctx: AdapterContext): number;
    plan(ctx: AdapterContext): McpPlan;
    execute(plan: McpPlan, options: SendOptions, ctx?: ExecuteContext): Promise<ExecResult>;
}

export { type DiscoverAndWriteMcpResult, type GeneratedMcpCall, MCP_PROTOCOL_VERSION, McpAdapter, type McpCapability, type McpDiscoveryResult, type McpPlan, type McpPrompt, type McpResource, type McpTool, type WriteMcpOptions, discoverAndWriteMcpCapabilities, discoverMcpCapabilities, generateAllMcpCalls, generateMcpCall, initializeSession, resolveMcpConfig, runMcp, writeMcpOperations };
