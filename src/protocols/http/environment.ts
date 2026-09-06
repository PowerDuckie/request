import type { SendOptions } from "../../core/types";

const SECRET_KEY_PATTERN =
  /(token|secret|password|passwd|apikey|api_key|credential|private)/i;

/** Resolve the effective base URL, expanding server variables. */
export function resolveServerUrl(servers: any[], options: SendOptions): string {
  if (options.serverUrl) return stripTrailingSlash(options.serverUrl);

  const server =
    Array.isArray(servers) && servers.length ? servers[0] : { url: "/" };
  let url = typeof server?.url === "string" && server.url ? server.url : "/";

  const variables =
    server?.variables && typeof server.variables === "object"
      ? server.variables
      : {};
  for (const [name, definition] of Object.entries<any>(variables)) {
    const override = options.serverVariables?.[name];
    const fallback =
      definition?.default ??
      (Array.isArray(definition?.enum) && definition.enum.length
        ? definition.enum[0]
        : "");
    const value = override !== undefined ? override : fallback;
    url = url.split(`{${name}}`).join(String(value ?? ""));
  }

  // Leftover placeholders would break URL parsing later on.
  url = url.replace(/\{[^}]*\}/g, "");
  return stripTrailingSlash(url);
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "") || url;
}

export function buildEnvironment(
  name: string,
  baseUrl: string,
  variables: Record<string, string> = {},
): Record<string, any> {
  const values = [
    { key: "baseUrl", value: baseUrl, type: "default", enabled: true },
    ...Object.entries(variables ?? {})
      .filter(([key]) => key !== "baseUrl")
      .map(([key, value]) => ({
        key,
        value: value == null ? "" : String(value),
        type: SECRET_KEY_PATTERN.test(key) ? "secret" : "default",
        enabled: true,
      })),
  ];

  return {
    id: `protokit-env-${Date.now().toString(36)}`,
    name,
    values,
    _postman_variable_scope: "environment",
    _postman_exported_at: new Date().toISOString(),
  };
}
