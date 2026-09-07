import { L as LocatedOperation, a as SendOptions, q as StreamEvent, l as RuntimeRunOptions, b as ExecuteContext, E as ExecResult, P as ProtocolAdapter, A as AdapterContext } from '../../protocol-C1fL6J7c.cjs';
export { s as locateOperation } from '../../protocol-C1fL6J7c.cjs';

interface BuiltCollection {
    collection: Record<string, any>;
    baseUrl: string;
    contentType?: string;
    isCustomMethod: boolean;
    /**
     * Non-fatal problems detected while building the request, such as a required
     * path value that had to be synthesized. Surfaced so callers can log them
     * instead of debugging a silently malformed URL.
     */
    warnings: string[];
}
declare function buildCollection(located: LocatedOperation, spec: any, options: SendOptions): BuiltCollection;

interface ResolverOptions {
    /** Maximum expansion depth. Defaults to 32. */
    maxDepth?: number;
    /** Maximum nodes produced by a single deepDeref call. Defaults to 200000. */
    maxNodes?: number;
}
interface Resolver {
    /** Resolve only the top-level $ref chain, keeping sibling keys. */
    deref<T = any>(node: any): T;
    /** Fully expand a subtree, collapsing cycles into a generic object schema. */
    deepDeref(node: any): any;
    /** Resolve a local JSON pointer against the document root. */
    byPointer(pointer: string): any;
}
/**
 * Resolver for local JSON pointers. External references are rejected explicitly
 * rather than silently producing an empty schema.
 *
 * Results handed back by `deepDeref` are always freshly owned by the caller, so
 * mutating them can never corrupt the resolver cache or the source document.
 */
declare function createResolver(root: any, options?: ResolverOptions): Resolver;

interface ResolveServerOptions {
    /** Index into the server list. Defaults to 0. */
    serverIndex?: number;
}
/**
 * Resolve the effective base URL, expanding OpenAPI server variables.
 *
 * A relative server URL (`/` or `/v1`) cannot be used to make a real request,
 * so it is rejected with an actionable error rather than producing a
 * protocol-relative URL that silently resolves to the wrong host.
 */
declare function resolveServerUrl(servers: any[], options: SendOptions & ResolveServerOptions): string;
interface BuildEnvironmentOptions {
    /** Mark values whose key looks like a credential as secret. Defaults to true. */
    maskSecrets?: boolean;
    /** Allow `variables.baseUrl` to override the resolved base URL. Defaults to false. */
    allowBaseUrlOverride?: boolean;
}
declare function buildEnvironment(name: string, baseUrl: string, variables?: Record<string, string>, options?: BuildEnvironmentOptions): Record<string, any>;

interface SseParserOptions {
    /**
     * Maximum characters buffered while waiting for an event boundary. A peer that
     * never terminates an event would otherwise grow the buffer without bound.
     * Defaults to 4 Mi characters.
     */
    maxBufferChars?: number;
    /** Maximum characters retained in a single event's `data`. Defaults to 1 Mi. */
    maxEventChars?: number;
    /**
     * Attach the last seen `id` to events that omit one. Defaults to true.
     *
     * The specification uses the last event id only for the `Last-Event-ID`
     * header on reconnect, not as a property of subsequent events. Inheriting it
     * is convenient when debugging, but it makes `id` look universally present to
     * schema inference. Set to false for a spec-faithful stream.
     */
    inheritEventId?: boolean;
}
/**
 * Incremental Server-Sent Events parser following the WHATWG event stream rules.
 * postman-runtime usually hands over complete events, but chunk boundaries are
 * not guaranteed, so buffering is still required.
 *
 * The parser is deliberately defensive about size: the peer controls how much
 * data arrives before a boundary appears, so both the pending buffer and any
 * single event are capped instead of growing until the process runs out of memory.
 */
declare class SseParser {
    private buffer;
    private readonly decoder;
    private lastEventId;
    private bomChecked;
    private overflowed;
    private sequence;
    private readonly maxBufferChars;
    private readonly maxEventChars;
    private readonly inheritEventId;
    /** Number of events or blocks discarded because a size cap was exceeded. */
    droppedEvents: number;
    constructor(options?: SseParserOptions);
    /** True once a size cap forced data to be discarded. */
    get truncated(): boolean;
    /** Number of events emitted so far. */
    get count(): number;
    /** Feed a chunk and return every complete event it produced. */
    push(chunk: Buffer | Uint8Array | string): StreamEvent[];
    /** Emit whatever remains once the stream has ended. */
    flush(): StreamEvent[];
    reset(): void;
    /** Consume every complete block currently in the buffer. */
    private drain;
    private parseBlock;
}

interface BuildRunOptionsInput {
    baseUrl: string;
    /** True when the operation is expected to stream, which relaxes the global timeout. */
    streaming: boolean;
}
/**
 * Compose the final postman-runtime options object.
 *
 * Precedence, lowest to highest:
 *   1. Library defaults
 *   2. Convenience fields on SendOptions (timeout, maxStreamMs, variables, ...)
 *   3. `options.runner` — every documented runtime option, passed straight through
 *
 * Variable scopes are only synthesized when the caller did not supply one.
 */
declare function buildRunOptions(options: SendOptions, input: BuildRunOptionsInput): RuntimeRunOptions;

/** Why sampling ended, surfaced on the result so callers can distinguish causes. */
type StopReason = "maxEvents" | "maxStreamMs" | "maxResponseSize" | "aborted" | "hardTimeout";
interface RunInput {
    collectionJson: any;
    baseUrl: string;
    /** Derived from the spec; the live content-type still has the final say. */
    streamingHint: boolean;
}
declare function runWithPostman(input: RunInput, options: SendOptions, ctx?: ExecuteContext): Promise<ExecResult>;

interface HttpPlan extends BuiltCollection {
    environment: Record<string, any>;
    streaming: boolean;
}
/**
 * Default adapter for HTTP and Server-Sent Events.
 * Both share a single postman-runtime execution path so that scripts,
 * variable scopes, cookies and auth helpers behave identically.
 */
declare class HttpAdapter implements ProtocolAdapter<HttpPlan> {
    readonly name = "http";
    /** Lowest priority: acts as the fallback when no other adapter claims the operation. */
    supports(ctx: AdapterContext): number;
    plan(ctx: AdapterContext): HttpPlan;
    execute(plan: HttpPlan, options: SendOptions, ctx?: ExecuteContext): Promise<ExecResult>;
}

export { HttpAdapter, type HttpPlan, type RunInput, SseParser, type StopReason, buildCollection, buildEnvironment, buildRunOptions, createResolver, resolveServerUrl, runWithPostman };
