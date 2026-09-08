import { O as OperationTarget, a as SendOptions, E as ExecResult } from './types-C9ifzKqk.js';

interface LocatedOperation {
    path: string;
    /** Lower-cased method name; custom verbs come from `additionalOperations`. */
    method: string;
    /** True when the method came from `additionalOperations`. */
    isCustomMethod: boolean;
    /** The key used inside `additionalOperations`, preserving its original case. */
    customMethodKey?: string;
    /** Fully dereferenced Operation Object. */
    operation: any;
    pathItem: any;
    /** Path-level and operation-level parameters merged, operation wins. */
    parameters: any[];
    /** Effective servers, honoring operation > pathItem > document precedence. */
    servers: any[];
    security?: any[];
}
declare function locateOperation(spec: any, target: OperationTarget): LocatedOperation;

interface AdapterContext {
    spec: any;
    options: SendOptions;
    located: LocatedOperation;
}
/**
 * Extra runtime facilities handed to `execute()`.
 * Optional so existing adapters keep compiling, but new adapters should honor
 * `signal` so long-lived streams can be cancelled deterministically.
 */
interface ExecuteContext {
    /**
     * Aborted when the caller wants execution to stop. Adapters must tear down
     * sockets and settle their promise promptly, resolving with whatever has been
     * collected so far rather than rejecting.
     */
    signal?: AbortSignal;
}
/**
 * Every protocol implements this contract. `plan()` must be pure and
 * synchronous so callers can inspect or export the plan without side effects.
 */
interface ProtocolAdapter<TPlan = unknown> {
    readonly name: string;
    /**
     * Return 0 (or any non-positive / non-finite value) when unsupported;
     * higher finite numbers win the resolution race. Must not throw — a throwing
     * adapter is treated as "unsupported".
     */
    supports(ctx: AdapterContext): number;
    plan(ctx: AdapterContext): TPlan;
    /**
     * Perform the call. Must always resolve for protocol-level failures and
     * report them via `ExecResult.error`; reject only for programming errors.
     */
    execute(plan: TPlan, options: SendOptions, ctx?: ExecuteContext): Promise<ExecResult>;
    /** Optional cleanup for adapters holding process-wide resources. */
    dispose?(): void | Promise<void>;
}

export { type AdapterContext as A, type ExecuteContext as E, type LocatedOperation as L, type ProtocolAdapter as P, locateOperation as l };
