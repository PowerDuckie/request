/**
 * Unified error type for the whole toolkit.
 * `code` is a stable machine-readable identifier; `message` is human-facing.
 */
export class ProtoKitError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = "ProtoKitError";
    this.code = code;
    this.details = details;
    // Restore prototype chain when compiled down to ES5.
    Object.setPrototypeOf(this, ProtoKitError.prototype);
    if (Error.captureStackTrace) Error.captureStackTrace(this, ProtoKitError);
  }
}

export function err(
  code: string,
  message: string,
  details?: unknown,
): ProtoKitError {
  return new ProtoKitError(message, code, details);
}

/** Normalize any thrown value into a plain, serializable shape. */
export function toErrorInfo(e: unknown): {
  message: string;
  code?: string;
  name?: string;
} {
  if (e instanceof ProtoKitError)
    return { message: e.message, code: e.code, name: e.name };
  if (e instanceof Error)
    return { message: e.message, code: (e as any).code, name: e.name };
  if (typeof e === "string") return { message: e };
  try {
    return { message: JSON.stringify(e) };
  } catch {
    return { message: String(e) };
  }
}
