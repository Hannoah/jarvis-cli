/**
 * Enterprise CLI wrappers (kubectl, sas-viya, az, pac) + the Viya status-page deploy.
 *
 * SECURITY: the Python version ran `kubectl <args>` through a shell (`shell=True`), so `get pods & <anything>` executed
 * arbitrary commands outside every policy, and the tools were advertised read-only (no approval prompt). Here the arguments
 * are split into argv and the program is spawned without a shell, and the tools are advertised as mutating.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { enrichEnv, splitArgs, which } from "../system/cliEnv.js";
import { json, mutating } from "./common.js";
const isWin = process.platform === "win32";
export function catalog(home) {
    const viyaDirs = process.env.VIYA_CLI_DIR ? [process.env.VIYA_CLI_DIR] : []; // sas-viya has no standard install folder: set VIYA_CLI_DIR or put it on PATH
    const gitBins = isWin
        ? [path.join(home, "AppData/Local/Programs/Git/usr/bin"), path.join(home, "AppData/Local/Programs/Git/bin"), "C:/Program Files/Git/usr/bin", "C:/Program Files/Git/bin"]
        : ["/usr/bin", "/bin"];
    const winOrBrew = (win, brew) => (isWin ? `winget install -e --id ${win}` : `brew install ${brew}`);
    return {
        kubectl: {
            display: "Kubernetes CLI (kubectl)",
            binaries: isWin ? ["kubectl.exe"] : ["kubectl"],
            dirs: [path.join(home, "AppData/Local/Microsoft/WinGet/Links"), "C:/Program Files/Docker/Docker/resources/bin", path.join(home, ".azure-kubectl"), "/opt/homebrew/bin", "/usr/local/bin"],
            install: winOrBrew("Kubernetes.kubectl", "kubectl"),
            url: "https://kubernetes.io/docs/tasks/tools/",
        },
        az: {
            display: "Azure CLI (az)",
            binaries: isWin ? ["az.cmd", "az.exe"] : ["az"],
            dirs: ["C:/Program Files/Microsoft SDKs/Azure/CLI2/wbin", "C:/Program Files (x86)/Microsoft SDKs/Azure/CLI2/wbin", "/opt/homebrew/bin", "/usr/local/bin"],
            install: winOrBrew("Microsoft.AzureCLI", "azure-cli"),
            url: "https://learn.microsoft.com/cli/azure/install-azure-cli",
        },
        pac: {
            display: "Microsoft Power Platform CLI (pac)",
            binaries: isWin ? ["pac.exe", "pac.cmd"] : ["pac"],
            dirs: [path.join(home, "AppData/Local/Microsoft/PowerAppsCLI"), path.join(home, ".dotnet/tools")],
            install: isWin ? "winget install -e --id Microsoft.PowerAppsCLI" : "dotnet tool install --global Microsoft.PowerApps.CLI.Tool",
            url: "https://learn.microsoft.com/power-platform/developer/cli/introduction",
        },
        "sas-viya": {
            display: "SAS Viya Platform CLI (sas-viya)",
            binaries: isWin ? ["sas-viya.exe", "sas-viya.cmd"] : ["sas-viya"],
            dirs: viyaDirs,
            install: "Download sas-viya from SAS Viya Operations Center, then add it to PATH or set VIYA_CLI_DIR",
            url: "https://go.documentation.sas.com/doc/en/sasadmincdc/default/calcli/titlepage.htm",
        },
        git: {
            display: "Git",
            binaries: isWin ? ["git.exe"] : ["git"],
            dirs: isWin ? [path.join(home, "AppData/Local/Programs/Git/cmd"), "C:/Program Files/Git/cmd"] : ["/usr/bin", "/opt/homebrew/bin", "/usr/local/bin"],
            install: winOrBrew("Git.Git", "git"),
            url: "https://git-scm.com/downloads",
        },
        devtunnel: {
            display: "Microsoft Dev Tunnel (devtunnel)",
            binaries: isWin ? ["devtunnel.exe"] : ["devtunnel"],
            dirs: [path.join(home, "AppData/Local/Microsoft/WinGet/Links"), path.join(home, "bin")],
            install: isWin ? "winget install -e --id Microsoft.devtunnel" : "Run: curl -sL https://aka.ms/DevTunnelCliInstall | bash",
            url: "https://aka.ms/devtunnels/cli",
        },
        pangpcli: {
            display: "GlobalProtect CLI (pangpcli)",
            binaries: isWin ? ["pangpcli.exe"] : ["globalprotect"],
            dirs: ["C:/Program Files/Palo Alto Networks/GlobalProtect", "/usr/local/bin"],
            install: "Comes with your organisation's GlobalProtect deployment; ask IT for a build that includes the command-line launcher",
            url: "https://docs.paloaltonetworks.com/globalprotect",
        },
        sh: {
            display: isWin ? "POSIX Shell (Git Bash sh.exe)" : "POSIX Shell (sh)",
            binaries: isWin ? ["sh.exe", "bash.exe"] : ["sh", "bash"],
            dirs: gitBins,
            install: isWin ? "winget install -e --id Git.Git" : "(sh is part of the OS)",
            url: "https://git-scm.com/downloads",
        },
    };
}
/** cmd.exe metacharacters that survive double quotes: percent expansion and line breaks. */
const CMD_UNSAFE = /[%\r\n"]/;
function quoteForCmd(s) {
    return `"${s.replace(/\\+$/, (m) => m + m)}"`; // trailing backslashes would escape the closing quote
}
function execFileSafe(exe, args, env, cwd, timeoutSec) {
    return new Promise((resolve) => {
        let child;
        try {
            if (isWin && /\.(cmd|bat)$/i.test(exe)) {
                // Node refuses to spawn .cmd without a shell. Use cmd.exe, but with every argument quoted and the
                // characters that stay active inside quotes (% and ") rejected, so nothing can break out.
                const bad = args.find((a) => CMD_UNSAFE.test(a));
                if (bad !== undefined)
                    return resolve({ success: false, installed: true, error: `Argument not allowed for ${path.basename(exe)}: contains %, a double quote or a line break.` });
                const line = [exe, ...args].map(quoteForCmd).join(" ");
                child = spawn("cmd.exe", ["/d", "/s", "/c", `"${line}"`], { env, cwd, windowsHide: true, windowsVerbatimArguments: true });
            }
            else {
                child = spawn(exe, args, { env, cwd, windowsHide: true, detached: !isWin });
            }
        }
        catch (e) {
            return resolve({ success: false, installed: true, error: e.message });
        }
        const out = [];
        const err = [];
        child.stdout?.on("data", (c) => out.push(c));
        child.stderr?.on("data", (c) => err.push(c));
        let done = false;
        const finish = (r) => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            resolve(r);
        };
        const timer = setTimeout(() => {
            try {
                if (isWin)
                    spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { windowsHide: true, timeout: 5000 });
                else
                    process.kill(-child.pid, "SIGKILL");
            }
            catch {
                child.kill();
            }
            finish({ success: false, installed: true, error: `Command timed out after ${timeoutSec} seconds.` });
        }, timeoutSec * 1000);
        child.on("error", (e) => finish({ success: false, installed: true, error: e.message }));
        child.on("close", (code) => finish({ success: code === 0, installed: true, returncode: code, stdout: Buffer.concat(out).toString("utf8").trim(), stderr: Buffer.concat(err).toString("utf8").trim() }));
    });
}
export function registerEnterpriseTools(mcp, ctx) {
    const { cfg, audit } = ctx;
    const MUT = mutating(cfg);
    const cat = catalog(cfg.home);
    const env = () => enrichEnv(process.env, cfg.home);
    const resolveCli = (key) => {
        const spec = cat[key];
        if (!spec)
            return null;
        return which(spec.binaries, env(), spec.dirs.filter((d) => fs.existsSync(d)));
    };
    const missing = (key, attempted) => {
        const spec = cat[key];
        const canWinget = spec.install.startsWith("winget ");
        return {
            success: false,
            installed: false,
            cli: key,
            display_name: spec.display,
            command: attempted,
            error: `'${spec.display}' is not installed on this PC, so the command cannot run.`,
            install_command: spec.install,
            install_url: spec.url,
            can_auto_install_via_terminal: canWinget,
            ai_guidance: `Tell the user that ${spec.display} is not installed on this PC. ` +
                (canWinget ? `If they want, install it right away by running \`${spec.install}\` with the \`run_terminal\` tool.` : `How to install: ${spec.install} (${spec.url})`),
        };
    };
    const checkAll = () => {
        const clis = {};
        for (const [key, spec] of Object.entries(cat)) {
            const p = resolveCli(key);
            clis[key] = { display_name: spec.display, installed: !!p, path: p, install_command: spec.install };
        }
        return { success: true, kubeconfig: env().KUBECONFIG ?? null, clis };
    };
    /** Run an installed CLI with user-supplied argument text, audited, no shell. */
    async function runCli(tool, key, rawArgs, prefix = [], timeout = 60) {
        let argv;
        try {
            argv = [...prefix, ...splitArgs(rawArgs)];
        }
        catch (e) {
            return { success: false, error: e.message };
        }
        const shown = `${key} ${argv.join(" ")}`.trim();
        const exe = resolveCli(key);
        if (!exe)
            return missing(key, shown);
        audit(tool, "ALLOW", shown);
        const res = await execFileSafe(exe, argv, env(), key === "sas-viya" ? path.dirname(exe) : undefined, timeout);
        return { ...res, command: shown, ...(key === "kubectl" ? { kubeconfig: env().KUBECONFIG ?? null } : {}) };
    }
    const argsShape = { args: z.string().describe("Command-line arguments (quotes group words; shell operators like & | ; are NOT interpreted).") };
    mcp.registerTool("run_kubectl", {
        description: "Execute a kubectl command against the configured Kubernetes cluster. If `args` is '--check' or 'status', returns CLI availability and KUBECONFIG status. " +
            "If kubectl is not installed on this PC, returns structured installation guidance.",
        inputSchema: { ...argsShape, namespace: z.string().default("").describe("Optional Kubernetes namespace (-n).") },
        annotations: MUT,
    }, async ({ args, namespace }) => {
        if (["--check", "check-cli", "status"].includes(args.trim().toLowerCase()))
            return json(checkAll());
        if (namespace && !/^[A-Za-z0-9._-]+$/.test(namespace))
            return json({ success: false, error: "Invalid namespace." });
        return json(await runCli("run_kubectl", "kubectl", args, namespace ? ["-n", namespace] : []));
    });
    mcp.registerTool("run_viya_cli", {
        description: "Execute SAS Viya CLI (sas-viya). If it is not installed on this PC, returns structured installation guidance without crashing.",
        inputSchema: argsShape,
        annotations: MUT,
    }, async ({ args }) => json(await runCli("run_viya_cli", "sas-viya", args)));
    mcp.registerTool("run_azure_cli", {
        description: "Execute Azure CLI (az) command. If Azure CLI is not installed on this PC, returns structured installation guidance.",
        inputSchema: argsShape,
        annotations: MUT,
    }, async ({ args }) => json(await runCli("run_azure_cli", "az", args)));
    mcp.registerTool("run_pac_cli", {
        description: "Execute Microsoft Power Platform CLI (pac) command. If it is not installed on this PC, returns structured installation guidance.",
        inputSchema: argsShape,
        annotations: MUT,
    }, async ({ args }) => json(await runCli("run_pac_cli", "pac", args)));
    mcp.registerTool("deploy_viya_status_page", {
        description: "Deploy or update the SAS Viya MCP status page on the Kubernetes cluster.",
        inputSchema: { dry_run: z.boolean().default(false) },
        annotations: MUT,
    }, async ({ dry_run }) => {
        const kubectl = resolveCli("kubectl");
        if (!kubectl)
            return json(missing("kubectl", "deploy_viya_status_page"));
        const sh = resolveCli("sh");
        if (!sh)
            return json(missing("sh", "sh deploy.sh"));
        const dir = process.env.JARVIS_STATUS_DEPLOY_DIR ?? "";
        if (!dir || !fs.existsSync(dir)) {
            return json({
                success: false,
                installed: false,
                error: dir ? `Deploy project folder not found: ${dir}` : "JARVIS_STATUS_DEPLOY_DIR is not set.",
                ai_guidance: "Set JARVIS_STATUS_DEPLOY_DIR to the folder that contains deploy.sh (clone the project first if needed).",
            });
        }
        audit("deploy_viya_status_page", "ALLOW", `${dry_run ? "dry-run" : "deploy"} in ${dir}`);
        const res = { ...(await execFileSafe(sh, ["deploy.sh", ...(dry_run ? ["--dry-run=server"] : [])], env(), dir, 90)) };
        res.action = dry_run ? "dry-run verification" : "actual deployment";
        if (!dry_run && res.success) {
            const rollout = await execFileSafe(kubectl, ["-n", "sas-mcp", "rollout", "status", "deploy/sas-mcp-status", "--timeout=60s"], env(), undefined, 90);
            res.rollout_status = rollout.stdout;
        }
        return json(res);
    });
}
