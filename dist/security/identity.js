/**
 * One PC, one set of connection values.
 *
 * The API key, the Dev Tunnel id and the public URL are what every connected client has been given, so they must not depend on
 * which settings folder, version or program (jarvis-cli, jarvis-ts) happens to run. They are kept in <home>/.jarvis/identity.json,
 * a fixed place per OS user, and every settings folder's .env is made to agree with it:
 *
 *  - the first value ever seen is recorded (adopted from the .env that has it, or generated);
 *  - after that nothing replaces it automatically: a different value in a .env is overwritten with the PC's, and a tunnel that
 *    reports another id is ignored;
 *  - it changes only when the user asks: `mcp rotate`, the dashboard's key / tunnel id controls, `identity import`.
 *    (The public URL is the one exception: it is whatever the tunnel reports for the PC's tunnel id, so it is recorded as observed.)
 */
import fs from "node:fs";
import path from "node:path";
import { identityFile, readEnvFile } from "../core/config.js";
import { updateEnvFile } from "../core/envfile.js";
import { writeFileAtomic } from "../files/fsutil.js";
export const FIELDS = { apiKey: "PC_MCP_API_KEY", tunnelId: "PC_MCP_DEVTUNNEL_ID", publicUrl: "PC_MCP_PUBLIC_URL" };
export function readIdentity(home) {
    try {
        const j = JSON.parse(fs.readFileSync(identityFile(home), "utf8"));
        const out = {};
        for (const f of Object.keys(FIELDS))
            if (typeof j[f] === "string" && j[f])
                out[f] = j[f];
        return out;
    }
    catch {
        return {};
    }
}
function writeIdentity(home, id) {
    const file = identityFile(home);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileAtomic(file, JSON.stringify(id, null, 2) + "\n"); // owner-only: it holds the API key
}
/**
 * Make `envFile` agree with the PC's identity. A value the identity does not have yet is adopted from the .env;
 * a different value in the .env is replaced by the PC's. Returns the .env keys that were put back.
 */
export function syncIdentity(envFile, home) {
    const id = readIdentity(home);
    const env = readEnvFile(envFile);
    const restore = {};
    let adopted = false;
    for (const f of Object.keys(FIELDS)) {
        const have = id[f] ?? "";
        const cur = (env[FIELDS[f]] ?? "").trim();
        if (have) {
            if (cur !== have)
                restore[FIELDS[f]] = have;
        }
        else if (cur) {
            id[f] = cur;
            adopted = true;
        }
    }
    if (adopted)
        writeIdentity(home, id);
    if (Object.keys(restore).length)
        updateEnvFile(envFile, restore);
    return Object.keys(restore);
}
/**
 * The only way to change the PC's values: callers are the user's own actions (rotate, dashboard settings, identity import)
 * or the first creation of a value. An empty string removes the value. The identity file is written first, so a running server
 * that notices the .env change already finds the new value there and does not undo it.
 */
export function setIdentity(envFile, home, patch) {
    const id = readIdentity(home);
    const env = {};
    for (const f of Object.keys(patch)) {
        const v = (patch[f] ?? "").trim();
        if (v)
            id[f] = v;
        else
            delete id[f];
        env[FIELDS[f]] = v;
    }
    writeIdentity(home, id);
    updateEnvFile(envFile, env);
}
