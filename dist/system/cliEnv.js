/** PATH enrichment, executable lookup and shell-free argument splitting for the enterprise CLI tools. */
import fs from "node:fs";
import path from "node:path";
const isWin = process.platform === "win32";
/** Directories where the CLIs this server wraps (Git, Azure, Power Platform, kubectl, ...) usually live. */
function extraDirs(home) {
    const d = process.env.VIYA_CLI_DIR ?? path.join(home, "Work/02_SAS_Demos/SAS-Viya-Platform-Administration/tools");
    if (isWin) {
        return [
            d,
            path.join(home, "AppData/Local/Programs/Git/usr/bin"),
            path.join(home, "AppData/Local/Programs/Git/bin"),
            path.join(home, "AppData/Local/Microsoft/PowerAppsCLI"),
            path.join(home, "AppData/Local/Microsoft/WinGet/Links"),
            "C:/Program Files/Git/usr/bin",
            "C:/Program Files/Git/bin",
            "C:/Program Files/Microsoft SDKs/Azure/CLI2/wbin",
            "C:/Program Files (x86)/Microsoft SDKs/Azure/CLI2/wbin",
            "C:/Program Files/Docker/Docker/resources/bin",
        ];
    }
    return [d, "/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".dotnet/tools"), path.join(home, ".local/bin")];
}
/** Prepend existing CLI dirs to PATH and bind KUBECONFIG, on a copy of `env`. */
export function enrichEnv(env, home) {
    const out = { ...env };
    const key = Object.keys(out).find((k) => k.toLowerCase() === "path") ?? "PATH";
    let cur = out[key] ?? "";
    for (const p of extraDirs(home)) {
        if (fs.existsSync(p) && !cur.toLowerCase().includes(path.normalize(p).toLowerCase()))
            cur = `${p}${path.delimiter}${cur}`;
    }
    out[key] = cur;
    if (!out.KUBECONFIG) {
        const cands = [
            process.env.JARVIS_DEFAULT_KUBECONFIG,
            path.join(home, "Work/07_Operations/01_System_Automation/SAS Viya Engage KubeConfig/sas-demos/sas-demos-kubeConfig"),
            path.join(home, ".kube/config"),
        ].filter(Boolean);
        const found = cands.find((c) => fs.existsSync(c));
        if (found)
            out.KUBECONFIG = found;
    }
    return out;
}
/** Find an executable by name in PATH (honours PATHEXT on Windows). */
export function which(names, env, extraDirList = []) {
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
    const dirs = [...extraDirList, ...(env[pathKey] ?? "").split(path.delimiter)].filter(Boolean);
    const exts = isWin ? ["", ...(env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((e) => e.toLowerCase())] : [""];
    for (const dir of dirs) {
        for (const n of names) {
            for (const ext of exts) {
                const f = path.join(dir, n + (n.toLowerCase().endsWith(ext) ? "" : ext));
                try {
                    if (fs.statSync(f).isFile())
                        return f;
                }
                catch {
                    /* not here */
                }
            }
        }
    }
    return null;
}
/**
 * Split a command-line string into argv with quotes only. Shell operators (& | ; > $()) are NOT interpreted:
 * they end up as literal arguments, which is exactly what we want when the process is spawned without a shell.
 */
export function splitArgs(input) {
    const out = [];
    let cur = "";
    let quote = null;
    let has = false;
    for (const c of input) {
        if (quote) {
            if (c === quote)
                quote = null;
            else
                cur += c;
        }
        else if (c === '"' || c === "'") {
            quote = c;
            has = true;
        }
        else if (/\s/.test(c)) {
            if (has || cur)
                out.push(cur);
            cur = "";
            has = false;
        }
        else
            cur += c;
    }
    if (quote)
        throw new Error("Unterminated quote in arguments.");
    if (has || cur)
        out.push(cur);
    return out;
}
