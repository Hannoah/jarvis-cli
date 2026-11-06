/** PATH enrichment, executable lookup and shell-free argument splitting for the enterprise CLI tools. */
import fs from "node:fs";
import path from "node:path";

const isWin = process.platform === "win32";

/** Settings the enterprise tools read. They may be set in the settings file (.env) as well as in the real environment. */
export const TOOL_SETTINGS = ["KUBECONFIG", "JARVIS_DEFAULT_KUBECONFIG", "VIYA_CLI_DIR", "JARVIS_STATUS_DEPLOY_DIR"] as const;

/** Directories where the CLIs this server wraps (Git, Azure, Power Platform, kubectl, ...) usually live. */
function extraDirs(home: string, viyaDir = ""): string[] {
  const d = viyaDir; // fs.existsSync("") is false, so an unset variable adds nothing
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

/**
 * Prepend existing CLI dirs to PATH and bind KUBECONFIG, on a copy of `env`.
 * `dotenv` is the parsed settings file: only TOOL_SETTINGS are taken from it (it also holds the API key, which must not
 * reach the commands run_terminal starts), and they win over the real environment like every other setting.
 */
export function enrichEnv(env: NodeJS.ProcessEnv, home: string, dotenv: Record<string, string> = {}): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const k of TOOL_SETTINGS) if (dotenv[k]?.trim()) out[k] = dotenv[k]!.trim();
  const key = Object.keys(out).find((k) => k.toLowerCase() === "path") ?? "PATH";
  let cur = out[key] ?? "";
  for (const p of extraDirs(home, out.VIYA_CLI_DIR)) {
    if (fs.existsSync(p) && !cur.toLowerCase().includes(path.normalize(p).toLowerCase())) cur = `${p}${path.delimiter}${cur}`;
  }
  out[key] = cur;
  if (!out.KUBECONFIG) {
    const cands = [
      out.JARVIS_DEFAULT_KUBECONFIG,
      path.join(home, ".kube/config"),
    ].filter(Boolean) as string[];
    const found = cands.find((c) => fs.existsSync(c));
    if (found) out.KUBECONFIG = found;
  }
  return out;
}

/** Find an executable by name in PATH (honours PATHEXT on Windows). */
export function which(names: string[], env: NodeJS.ProcessEnv, extraDirList: string[] = []): string | null {
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  const dirs = [...extraDirList, ...(env[pathKey] ?? "").split(path.delimiter)].filter(Boolean);
  const exts = isWin ? ["", ...(env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((e) => e.toLowerCase())] : [""];
  for (const dir of dirs) {
    for (const n of names) {
      for (const ext of exts) {
        const f = path.join(dir, n + (n.toLowerCase().endsWith(ext) ? "" : ext));
        try {
          if (fs.statSync(f).isFile()) return f;
        } catch {
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
export function splitArgs(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let has = false;
  for (const c of input) {
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else cur += c;
  }
  if (quote) throw new Error("Unterminated quote in arguments.");
  if (has || cur) out.push(cur);
  return out;
}
