// Update check: once a day ask GitHub for the latest release; the interactive prompt offers to install it.
// Also owns the messages shown when an install or update has just finished.
import { spawn } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { c } from "./cliutil.js";
import { select, withSpinner } from "./tui.js";
const REPO = "Hannoah/jarvis-cli";
const DAY = 86_400_000;
export const releaseUrl = (v) => `https://github.com/${REPO}/releases/tag/v${v}`;
const tarball = (v) => `https://github.com/${REPO}/archive/refs/tags/v${v}.tar.gz`;
const stateFile = (dir) => path.join(dir, ".update_check.json");
export function readState(dir) {
    try {
        return JSON.parse(fs.readFileSync(stateFile(dir), "utf8"));
    }
    catch {
        return {};
    }
}
export function saveState(dir, patch) {
    try {
        fs.writeFileSync(stateFile(dir), JSON.stringify({ ...readState(dir), ...patch }));
    }
    catch {
        /* best effort: the worst case is asking again */
    }
}
const parseTag = (t) => (typeof t === "string" && /^v?\d+\.\d+\.\d+$/.test(t) ? t.replace(/^v/, "") : null);
/** a is a newer x.y.z than b. */
export function isNewer(a, b) {
    const [x, y] = [a, b].map((v) => v.split(".").map(Number));
    for (let i = 0; i < 3; i++)
        if ((x[i] ?? 0) !== (y[i] ?? 0))
            return (x[i] ?? 0) > (y[i] ?? 0);
    return false;
}
/** Latest release version from GitHub, or null (offline, rate limited, ...). node:https with agent:false so no socket outlives us (a lingering fetch connection can crash process.exit on Windows). */
export function fetchLatest(timeoutMs = 2500) {
    return new Promise((resolve) => {
        const req = https.get(`https://api.github.com/repos/${REPO}/releases/latest`, { agent: false, timeout: timeoutMs, headers: { "user-agent": "jarvis-cli", accept: "application/vnd.github+json", connection: "close" } }, (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (d) => (body += d));
            res.on("end", () => {
                try {
                    resolve(parseTag(JSON.parse(body).tag_name));
                }
                catch {
                    resolve(null);
                }
            });
            res.on("error", () => resolve(null));
        });
        req.on("timeout", () => (req.destroy(), resolve(null)));
        req.on("error", () => resolve(null));
    });
}
/** The newer version worth offering right now, or null. Hits the network at most once a day; Skip and Later are remembered. */
export async function checkForUpdate(dir, current, now = Date.now(), fetcher = fetchLatest) {
    let s = readState(dir);
    if (!s.checkedAt || now - s.checkedAt > DAY) {
        const latest = await fetcher();
        saveState(dir, { checkedAt: now, ...(latest ? { latest } : {}) }); // a failed check also waits a day, so being offline costs nothing
        s = readState(dir);
    }
    if (!s.latest || !isNewer(s.latest, current))
        return null;
    if (s.skipped === s.latest || (s.snoozeUntil ?? 0) > now)
        return null;
    return s.latest;
}
/** npm install -g of the release tarball (the only install form that works, see the README). The version is validated, so the shell line is safe. */
function installUpdate(version) {
    return new Promise((resolve) => {
        if (!parseTag(version))
            return resolve(1);
        const child = spawn(`npm install -g ${tarball(version)}`, { stdio: "inherit", shell: true });
        child.on("error", () => resolve(1));
        child.on("close", (code) => resolve(code ?? 1));
    });
}
/** Install `latest` and say what happened. true = updated (the caller should exit: the files under this process just changed). */
async function runUpdate(dir, current, latest, serverUp) {
    console.log(c.dim(`Installing Jarvis ${latest}…`));
    const code = await installUpdate(latest);
    if (code) {
        console.error(c.red(`✖ The update failed (npm exited with ${code}). Install it by hand:`));
        console.error(`  npm install -g ${tarball(latest)}`);
        return false;
    }
    saveState(dir, { seenVersion: latest }); // this message replaces the what's-new notice of the next start
    console.log(`${c.green("✔")} Updated Jarvis ${current} → ${c.bold(latest)}`);
    console.log(c.gray(`  what's new   ${releaseUrl(latest)}`));
    if (await serverUp())
        console.log(c.yellow("  The MCP server is still running the old version:  jarvis stop  then  jarvis start -d"));
    console.log(c.gray("  Run jarvis again to use the new version."));
    return true;
}
/** At the start of the interactive prompt: check, ask, and install on "Update now". Exits the process after a successful update. */
export async function offerUpdate(dir, current, serverUp) {
    const latest = await withSpinner("checking for updates", checkForUpdate(dir, current));
    if (!latest)
        return;
    const pick = await select(`Jarvis ${latest} is available (you have ${current}). Update now?`, [
        { label: "Update now", hint: "installs it, then you start jarvis again", value: "now" },
        { label: "Later", hint: "ask again tomorrow", value: "later" },
        { label: `Skip ${latest}`, hint: "do not ask about this version", value: "skip" },
    ]);
    if (pick === "now") {
        if (await runUpdate(dir, current, latest, serverUp))
            process.exit(0);
    }
    else if (pick === "skip")
        saveState(dir, { skipped: latest });
    else
        saveState(dir, { snoozeUntil: Date.now() + DAY });
}
/** `jarvis update`: ignores the daily limit and Skip/Later. Returns an exit code. */
export async function updateCommand(dir, current, serverUp) {
    const latest = await fetchLatest(5000);
    if (!latest)
        return console.error(c.red("✖ Could not reach GitHub to look for a newer release.")), 1;
    saveState(dir, { checkedAt: Date.now(), latest });
    if (!isNewer(latest, current))
        return console.log(`${c.green("✔")} Jarvis ${current} is up to date.`), 0;
    return (await runUpdate(dir, current, latest, serverUp)) ? 0 : 1;
}
/** What Jarvis is, in five lines: shown after an install and by `jarvis about`. */
export function introBody(tools) {
    return [
        c.gray(`  ${tools ?? "Dozens of"} tools for files, terminal, git, web and wiki on this PC, limited to the folders you approve.`),
        c.gray("  Use them here        jarvis read_file notes.txt   ·   jarvis (interactive prompt)   ·   jarvis list"),
        c.gray("  or as an MCP server  jarvis start -d, then jarvis mcp for the URL and key (Copilot Studio, Claude, Cursor)"),
        c.gray("  Stays safe           approved folders only · terminal allowlist · every call is audited (jarvis audit, jarvis agents)"),
        c.gray("  For AI agents        jarvis list --json shows every tool with its parameters; add --format json to get one JSON line back"),
    ];
}
/** `jarvis about`. */
export function aboutLines(version, tools, settingsDir) {
    return [
        `${c.bold(`Jarvis ${version}`)} ${c.gray("· your PC's tools for you and your AI agents")}`,
        ...introBody(tools),
        c.gray(`  Settings             ${settingsDir}`),
        c.gray(`  Docs and releases    https://github.com/${REPO}`),
    ];
}
/**
 * Shown once after Jarvis was installed or updated (including updates done with a plain `npm install -g`): the first start of a
 * new version. null when this version was already announced.
 */
export function launchNotice(dir, current, o) {
    const seen = readState(dir).seenVersion;
    if (seen === current)
        return null;
    saveState(dir, { seenVersion: current });
    if (!seen && !o.hadSettings) {
        return [
            `${c.green("✔")} ${c.bold(`Jarvis ${current} is installed.`)}`,
            ...introBody(o.tools),
            c.gray(`  Settings             ${o.settingsDir}  (approved folders, API key and logs live here)`),
            c.gray("  Next                 /help for the basics · /permissions to choose folders and access"),
        ];
    }
    return [
        `${c.green("✔")} ${c.bold(seen ? `Jarvis was updated ${seen} → ${current}.` : `Jarvis ${current} is ready.`)}`,
        c.gray(`  what's new   ${releaseUrl(current)}`),
        ...(o.serverUp ? [c.yellow("  The MCP server is still running the old version:  /stop  then  /start")] : []),
    ];
}
