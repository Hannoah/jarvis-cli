export function rpcsOf(body) {
    const out = [];
    for (const m of Array.isArray(body) ? body : [body]) {
        if (!m || typeof m !== "object")
            continue;
        const { method, params } = m;
        if (typeof method !== "string")
            continue;
        const r = { method };
        if (method === "tools/call" && typeof params?.name === "string")
            r.tool = params.name;
        const ci = params?.clientInfo;
        if (method === "initialize" && typeof ci?.name === "string")
            r.client = { name: ci.name, version: typeof ci.version === "string" ? ci.version : "" };
        out.push(r);
    }
    return out;
}
/** user-agent + address -> the client name from its last `initialize` (bounded). */
const known = new Map();
// Free text from the client goes through JSON.stringify so it can never break the one-line log format.
const q = (s) => JSON.stringify(s.slice(0, 120));
export function agentDetails(rpcs, who) {
    const key = `${who.ua}|${who.ip}`;
    const out = [];
    for (const r of rpcs) {
        if (r.client) {
            known.set(key, r.client);
            if (known.size > 200)
                known.delete(known.keys().next().value);
        }
        if (r.method !== "initialize" && r.method !== "tools/call")
            continue;
        const c = known.get(key);
        out.push(`${c ? `agent=${q(c.name)} ver=${q(c.version)} ` : ""}ua=${q(who.ua)} via=${who.via} ip=${q(who.ip)} rpc=${r.method}${r.tool ? ` tool=${q(r.tool)}` : ""}`);
    }
    return out;
}
