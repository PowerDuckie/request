import type { SendOptions, ExecResult } from "./types";
import type { LocatedOperation } from "../openapi/locate";

export interface AdapterContext {
  spec: any;
  options: SendOptions;
  located: LocatedOperation;
}

/**
 * Every protocol implements this contract. `plan()` must be pure and
 * synchronous so callers can inspect or export the plan without side effects.
 */
export interface ProtocolAdapter<TPlan = unknown> {
  readonly name: string;
  /** Return 0 when unsupported; higher numbers win the resolution race. */
  supports(ctx: AdapterContext): number;
  plan(ctx: AdapterContext): TPlan;
  execute(plan: TPlan, options: SendOptions): Promise<ExecResult>;
}
