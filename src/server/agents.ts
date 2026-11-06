/**
 * Who is using the MCP server. Every `initialize` and `tools/call` that reaches /mcp becomes one audit line
 * `[AGENT] [mcp] agent="Claude Code" ver="2.1" ua="..." via=tunnel ip="..." rpc=tools/call tool="read_file"`,
 * which `jarvis agents` and `jarvis audit` read back.
 *
 * The transport is stateless, so only `initialize` carries the client's name; later calls are matched to it by user-agent + address.
 */
export interface Rpc {
  method: string;
  tool?: string;
  client?: { name: string; version: string };
}

export function rpcsOf(body: unknown): Rpc[] {
  const out: Rpc[] = [];
  for (const m of Array.isArray(body) ? body : [body]) {
    if (!m || typeof m !== "object") continue;
    const { method, params } = m as { method?: unknown; params?: { name?: unknown; clientInfo?: { name?: unknown; version?: unknown } } };
    if (typeof method !== "string") continue;
    const r: Rpc = { method };
    if (method === "tools/call" && typeof params?.name === "string") r.tool = params.name;
    const ci = params?.clientInfo;
    if (method === "initialize" && typeof ci?.name === "string") r.client = { name: ci.name, version: typeof ci.version === "string" ? ci.version : "" };
    out.push(r);
  }
  return out;
}

/** user-agent + address -> the client name from its last `initialize` (bounded). */
const known = new Map<string, { name: string; version: string }>();

// Free text from the client goes through JSON.stringify so it can never break the one-line log format.
const q = (s: string) => JSON.stringify(s.slice(0, 120));

export function agentDetails(rpcs: Rpc[], who: { ua: string; ip: string; via: "local" | "tunnel" | "remote" }): string[] {
  const key = `${who.ua}|${who.ip}`;
  const out: string[] = [];
  for (const r of rpcs) {
    if (r.client) {
      known.set(key, r.client);
      if (known.size > 200) known.delete(known.keys().next().value as string);
    }
    if (r.method !== "initialize" && r.method !== "tools/call") continue;
    const c = known.get(key);
    out.push(
      `${c ? `agent=${q(c.name)} ver=${q(c.version)} ` : ""}ua=${q(who.ua)} via=${who.via} ip=${q(who.ip)} rpc=${r.method}${r.tool ? ` tool=${q(r.tool)}` : ""}`,
    );
  }
  return out;
}
