import { L as LocatedOperation, a as SendOptions, l as StreamEvent, h as RuntimeRunOptions, E as ExecResult, P as ProtocolAdapter, A as AdapterContext } from '../../protocol-58EyJAsY.js';
export { m as locateOperation } from '../../protocol-58EyJAsY.js';

interface BuiltCollection {
    collection: Record<string, any>;
    baseUrl: string;
    contentType?: string;
    isCustomMethod: boolean;
}
declare function buildCollection(located: LocatedOperation, spec: any, options: SendOptions): BuiltCollection;

/**
 * Resolver for local JSON pointers. External references are rejected explicitly
 * rather than silently producing an empty schema.
 */
declare function createResolver(root: any): {
    deref: <T = any>(node: any) => T;
    deepDeref: (node: any) => any;
    byPointer: (pointer: string) => any;
};

/** Resolve the effective base URL, expanding server variables. */
declare function resolveServerUrl(servers: any[], options: SendOptions): string;
declare function buildEnvironment(name: string, baseUrl: string, variables?: Record<string, string>): Record<string, any>;

/**
 * Incremental Server-Sent Events parser following the WHATWG event stream rules.
 * postman-runtime usually hands over complete events, but chunk boundaries are
 * not guaranteed, so buffering is still required.
 */
declare class SseParser {
    private buffer;
    private readonly decoder;
    private lastEventId;
    private sequence;
    /** Feed a chunk and return every complete event it produced. */
    push(chunk: Buffer | Uint8Array | string): StreamEvent[];
    /** Emit whatever remains once the stream has ended. */
    flush(): StreamEvent[];
    reset(): void;
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
 *   2. Convenience fields on SendOptions (timeout, variables, globals, ...)
 *   3. `options.runner` — every documented runtime option, passed straight through
 *
 * Scopes are only synthesized when the caller did not supply their own.
 */
declare function buildRunOptions(options: SendOptions, input: BuildRunOptionsInput): RuntimeRunOptions;

interface RunInput {
    collectionJson: any;
    baseUrl: string;
    /** Derived from the spec; the live content-type still has the final say. */
    streamingHint: boolean;
}
declare function runWithPostman(input: RunInput, options: SendOptions): Promise<ExecResult>;

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
    execute(plan: HttpPlan, options: SendOptions): Promise<ExecResult>;
}

export { HttpAdapter, type HttpPlan, SseParser, buildCollection, buildEnvironment, buildRunOptions, createResolver, resolveServerUrl, runWithPostman };
