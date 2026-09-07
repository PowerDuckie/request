import { L as LocatedOperation, a as SendOptions, b as ExecuteContext, E as ExecResult, P as ProtocolAdapter, A as AdapterContext } from '../../protocol-BBjdeNfE.cjs';

interface ResolvedGraphQLConfig {
    endpoint: string;
    query: string;
    operationName?: string;
    variables: Record<string, unknown>;
    headers: Record<string, string>;
    useGet: boolean;
}
/**
 * Resolve the effective GraphQL call.
 *
 * Precedence for each field: `options.graphql.*` (explicit per-call override)
 * > `operation['x-graphql'].*` (the document's declared operation, normally
 * produced by {@link writeGraphQLOperations}) > a bare `POST {server}/graphql`
 * fallback with no query, which is rejected below.
 */
declare function resolveGraphQLConfig(located: LocatedOperation, spec: any, options: SendOptions): ResolvedGraphQLConfig;

/**
 * Run one GraphQL operation over HTTP.
 *
 * A GraphQL error is not a transport failure: the server still answers 200
 * with a `data`/`errors` envelope, so `ExecResult.error` is only set when the
 * call never produced a usable envelope at all (network failure, non-JSON
 * body, or `errors` with no `data`). Partial success (`data` alongside
 * `errors`) is left in `response.body` for the caller to inspect, exactly as
 * a real GraphQL client would surface it.
 */
declare function runGraphQL(config: ResolvedGraphQLConfig, options: SendOptions, ctx?: ExecuteContext): Promise<ExecResult>;

/** Standard GraphQL introspection query (spec-October2021), trimmed of directive locations we don't use. */
declare const INTROSPECTION_QUERY: string;
interface GraphQLTypeRef {
    kind: string;
    name?: string | null;
    ofType?: GraphQLTypeRef | null;
}
interface GraphQLArg {
    name: string;
    description?: string | null;
    type: GraphQLTypeRef;
    defaultValue?: string | null;
}
interface GraphQLFieldInfo {
    name: string;
    description?: string | null;
    args: GraphQLArg[];
    type: GraphQLTypeRef;
    isDeprecated?: boolean;
}
interface GraphQLNamedType {
    kind: string;
    name: string;
    description?: string | null;
    fields?: GraphQLFieldInfo[];
    inputFields?: GraphQLArg[];
    enumValues?: Array<{
        name: string;
    }>;
}
interface IntrospectedSchema {
    queryType?: string;
    mutationType?: string;
    subscriptionType?: string;
    /** Every named type, keyed by name, for resolving arg/field types during generation. */
    types: Map<string, GraphQLNamedType>;
}
interface IntrospectionResult {
    schema: IntrospectedSchema;
    /** Raw `__schema` payload, kept for callers that want more than this module parses. */
    raw: any;
}
/**
 * Auto-fetch a GraphQL server's schema via the standard introspection query.
 * This is the GraphQL analogue of the gRPC reflection handshake: one round
 * trip yields every operation the endpoint exposes.
 */
declare function introspectSchema(endpoint: string, init?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
}): Promise<IntrospectionResult>;

interface GeneratedOperation {
    operationType: "query" | "mutation" | "subscription";
    fieldName: string;
    operationName: string;
    /** Complete, ready-to-send document. */
    query: string;
    /** JSON Schema describing the `variables` object, for sampling and for documentation. */
    variablesSchema: {
        type: "object";
        properties: Record<string, any>;
        required: string[];
    };
    notes: string[];
}
/**
 * Generate a complete, runnable operation document plus a variables schema
 * for one root field (a query, mutation or subscription).
 *
 * This is the GraphQL analogue of the gRPC adapter's `buildMessageTemplate`:
 * a schema was just fetched, and this turns it into something a caller can
 * send immediately without hand-writing GraphQL.
 */
declare function generateOperation(operationType: "query" | "mutation" | "subscription", field: {
    name: string;
    args: GraphQLArg[];
    type: GraphQLTypeRef;
}, schema: IntrospectedSchema): GeneratedOperation;
/** Enumerate every generatable operation across Query/Mutation/Subscription. */
declare function generateAllOperations(schema: IntrospectedSchema): GeneratedOperation[];

interface WriteGraphQLOptions {
    /** Overwrite an existing path for the same operation. Defaults to true. */
    overwrite?: boolean;
    /** Extra headers to send with the introspection request (auth, etc.). */
    headers?: Record<string, string>;
    signal?: AbortSignal;
}
/**
 * "Upload" step: merge generated GraphQL operations into `spec.paths` as
 * synthetic POST operations carrying an `x-graphql` extension. Each becomes
 * independently addressable via `locateOperation({ operationId })`, exactly
 * like any hand-authored REST operation — this is what lets `send()` resolve
 * to the GraphQL adapter afterward.
 */
declare function writeGraphQLOperations(spec: any, endpoint: string, operations: GeneratedOperation[], options?: WriteGraphQLOptions): any;
interface DiscoverAndWriteResult {
    spec: any;
    operations: GeneratedOperation[];
    warnings: string[];
}
/**
 * One-shot "auto-fetch query + upload": introspect the live schema, generate
 * a runnable document for every query/mutation/subscription field, and merge
 * the results into the document. This is the GraphQL counterpart of the gRPC
 * adapter's `discover()` + `buildMessageTemplate()` pair, collapsed into a
 * single call because GraphQL introspection already returns the whole schema
 * in one round trip.
 */
declare function discoverAndWriteGraphQLSchema(spec: any, endpoint: string, options?: WriteGraphQLOptions): Promise<DiscoverAndWriteResult>;

interface GraphQLPlan {
    config: ResolvedGraphQLConfig;
    environment: Record<string, any>;
}
/**
 * GraphQL adapter.
 *
 * An operation is claimed when it declares `x-protocol: graphql`, carries an
 * `x-graphql` extension (normally produced by
 * {@link writeGraphQLOperations}), or the caller passes `options.graphql`.
 * GraphQL is transported over plain HTTP, but the request/response shape
 * (a single query document plus a data/errors envelope) does not fit the
 * Postman-collection pipeline the HTTP adapter is built around, so it gets
 * its own adapter — the same reasoning that gives WebSocket its own.
 */
declare class GraphQLAdapter implements ProtocolAdapter<GraphQLPlan> {
    readonly name = "graphql";
    supports(ctx: AdapterContext): number;
    plan(ctx: AdapterContext): GraphQLPlan;
    execute(plan: GraphQLPlan, options: SendOptions, ctx?: ExecuteContext): Promise<ExecResult>;
}

export { type DiscoverAndWriteResult, type GeneratedOperation, GraphQLAdapter, type GraphQLArg, type GraphQLFieldInfo, type GraphQLNamedType, type GraphQLPlan, type GraphQLTypeRef, INTROSPECTION_QUERY, type IntrospectedSchema, type IntrospectionResult, type WriteGraphQLOptions, discoverAndWriteGraphQLSchema, generateAllOperations, generateOperation, introspectSchema, resolveGraphQLConfig, runGraphQL, writeGraphQLOperations };
