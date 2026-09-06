import type { ProtocolAdapter, AdapterContext } from "./protocol";
import { err } from "./errors";

export class AdapterRegistry {
  private readonly adapters: ProtocolAdapter<any>[] = [];

  register(adapter: ProtocolAdapter<any>): this {
    if (!adapter || typeof adapter.supports !== "function") {
      throw err(
        "BAD_ADAPTER",
        "Adapter must implement the ProtocolAdapter interface",
      );
    }
    // Re-registering the same name replaces the previous implementation.
    const existing = this.adapters.findIndex((a) => a.name === adapter.name);
    if (existing >= 0) this.adapters.splice(existing, 1);
    this.adapters.push(adapter);
    return this;
  }

  list(): string[] {
    return this.adapters.map((a) => a.name);
  }

  resolve(ctx: AdapterContext): ProtocolAdapter<any> {
    const ranked = this.adapters
      .map((adapter) => {
        let score = 0;
        try {
          score = adapter.supports(ctx) || 0;
        } catch {
          score = 0; // A throwing adapter simply opts out.
        }
        return { adapter, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    if (!ranked.length) {
      throw err(
        "NO_ADAPTER",
        `No protocol adapter matched operation "${ctx.located.method.toUpperCase()} ${ctx.located.path}"`,
      );
    }
    return ranked[0].adapter;
  }
}
