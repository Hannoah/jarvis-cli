// `jarvis cli`: which helper CLIs (git, devtunnel, kubectl, az, pac, sas-viya, GlobalProtect's pangpcli, ...) are installed, and install the missing ones.
// The list is the enterprise tools' own catalog, so what is checked here is what the tools use.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { c } from "./cliutil.js";
import { enrichEnv, splitArgs, which } from "./system/cliEnv.js";
import { catalog } from "./tools/enterprise.js";
import { select } from "./tui.js";
/** How to install automatically: only package-manager one-liners (winget / brew). Anything else is a human instruction. */
export function installPlan(spec) {
    if (!/^(winget|brew) install /.test(spec.install))
        return null;
    const [file, ...args] = splitArgs(spec.install);
    return { file: file, args: file === "winget" ? [...args, "--accept-source-agreements", "--accept-package-agreements"] : args };
}
export function cliStates(home, env = enrichEnv(process.env, home)) {
    return Object.entries(catalog(home)).map(([key, s]) => ({
        key,
        display: s.display,
        path: which(s.binaries, env, s.dirs.filter((d) => fs.existsSync(d))),
        installable: !!installPlan(s),
        install: s.install,
        url: s.url,
    }));
}
/** Can this program be started? (winget is an app-execution alias that a PATH search cannot see, so ask the program itself.) */
const available = (file) => !spawnSync(file, ["--version"], { stdio: "ignore", timeout: 20_000 }).error;
const run = (file, args) => new Promise((resolve) => {
    const child = spawn(file, args, { stdio: "inherit" });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
});
export async function cliCommand(cfg, args) {
    const flags = new Set(args.filter((a) => a.startsWith("--")));
    const [sub = "check", ...names] = args.filter((a) => !a.startsWith("--"));
    let states = cliStates(cfg.home);
    if (sub === "check" || sub === "list") {
        if (flags.has("--json"))
            return console.log(JSON.stringify(states.map((s) => ({ key: s.key, display: s.display, installed: !!s.path, path: s.path, installable: s.installable, install: s.install, url: s.url })))), 0;
        const w = Math.max(...states.map((s) => s.display.length));
        console.log(c.bold("Helper CLIs Jarvis uses"));
        for (const s of states) {
            const how = s.installable ? `jarvis cli install ${s.key}` : "cannot be installed from here";
            console.log(`  ${s.path ? c.green("✔") : c.dim("–")} ${s.display.padEnd(w)}  ${s.path ? c.dim(s.path) : c.dim(`not installed · ${how}`)}`);
        }
        const missing = states.filter((s) => !s.path);
        if (missing.some((s) => s.installable))
            console.log(c.dim("\n  Install the missing ones: jarvis cli install [name...] --yes"));
        for (const s of missing.filter((m) => !m.installable))
            console.log(c.dim(`  ${s.display}: ${s.install} (${s.url})`));
        return 0;
    }
    if (sub !== "install") {
        console.error(c.red("✖ Usage: jarvis cli [check|install [name...] --yes] [--json]"));
        return 2;
    }
    const unknown = names.filter((n) => !states.some((s) => s.key === n));
    if (unknown.length)
        return console.error(c.red(`✖ Unknown: ${unknown.join(", ")}. Choose from: ${states.map((s) => s.key).join(", ")}`)), 2;
    const wanted = names.length ? states.filter((s) => names.includes(s.key)) : states.filter((s) => !s.path && s.installable);
    if (!wanted.length)
        return console.log(c.green("✔ Nothing to install: every CLI that can be installed from here is already there.")), 0;
    let failed = 0;
    for (const s of wanted) {
        if (s.path) {
            console.log(`${c.green("✔")} ${s.display} is already installed ${c.dim(s.path)}`);
            continue;
        }
        const plan = installPlan(catalog(cfg.home)[s.key]);
        if (!plan) {
            failed++;
            console.log(`${c.yellow("!")} ${s.display} cannot be installed from here: ${s.install} ${c.dim(`(${s.url})`)}`);
            continue;
        }
        const shown = `${plan.file} ${plan.args.join(" ")}`;
        if (!available(plan.file)) {
            failed++;
            console.error(c.red(`✖ ${plan.file} is not available on this PC, so ${s.display} cannot be installed automatically.`) + c.dim(`  Install it by hand: ${s.url}`));
            continue;
        }
        if (!flags.has("--yes")) {
            if (!process.stdin.isTTY)
                return console.error(c.red(`✖ This installs software (${shown}). Repeat with --yes to confirm.`)), 2;
            if ((await select(`Install ${s.display}?  ${shown}`, [{ label: "No", value: false }, { label: "Yes", value: true }])) !== true) {
                console.log(c.dim(`skipped ${s.display}`));
                continue;
            }
        }
        console.log(c.dim(`Installing ${s.display}…  ${shown}`));
        if ((await run(plan.file, plan.args)) !== 0) {
            failed++;
            console.error(c.red(`✖ ${s.display}: ${plan.file} reported a failure (a Windows permission prompt may have been declined).`));
            continue;
        }
        states = cliStates(cfg.home);
        const now = states.find((x) => x.key === s.key);
        console.log(now.path ? `${c.green("✔")} ${s.display} installed ${c.dim(now.path)}` : `${c.yellow("!")} ${s.display} was installed, but is not on the search path yet: open a new terminal, then run: jarvis cli`);
    }
    return failed ? 1 : 0;
}
