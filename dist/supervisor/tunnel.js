/**
 * Microsoft Dev Tunnel: install -> login -> create a persistent tunnel -> host it -> read the public HTTPS URL.
 * Same flow the PowerShell launcher used (verified there against the real CLI), but the host process runs under
 * `Service`, so a dropped connection or an expired ~24h login is repaired automatically.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { killByCommandLine, portOpen } from "../system/proc.js";
import { Service } from "./service.js";
export class Tunnel {
    o;
    state = "off";
    message = "";
    url = "";
    id = "";
    svc = null;
    busy = false;
    constructor(o) {
        this.o = o;
    }
    set(state, message = "") {
        this.state = state;
        this.message = message;
    }
    /** Find the CLI: explicit override, PATH, winget links, winget packages. */
    findCli() {
        if (this.o.cli)
            return this.o.cli;
        const exe = process.platform === "win32" ? "devtunnel.exe" : "devtunnel";
        for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
            const f = path.join(dir, exe);
            if (fs.existsSync(f))
                return [f];
        }
        const links = path.join(this.o.home, "AppData/Local/Microsoft/WinGet/Links/devtunnel.exe");
        if (process.platform === "win32" && fs.existsSync(links))
            return [links];
        const pkgRoot = path.join(this.o.home, "AppData/Local/Microsoft/WinGet/Packages");
        if (process.platform === "win32" && fs.existsSync(pkgRoot)) {
            for (const d of fs.readdirSync(pkgRoot)) {
                const f = path.join(pkgRoot, d, "devtunnel.exe");
                if (fs.existsSync(f))
                    return [f];
            }
        }
        return null;
    }
    run(cli, args, timeoutMs = 60_000) {
        return new Promise((resolve) => {
            execFile(cli[0], [...cli.slice(1), ...args], { timeout: timeoutMs, windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
                resolve({ ok: !err, out: String(stdout).trim(), err: String(stderr || err?.message || "").trim() });
            });
        });
    }
    async loggedIn(cli) {
        const r = await this.run(cli, ["user", "show"], 20_000);
        return r.ok && !/expired|not logged in/i.test(r.out + r.err);
    }
    /** Windows integrated auth first (no UI), then the interactive browser flow. */
    async login(cli) {
        this.o.log("[tunnel] logging in (integrated auth)");
        if ((await this.run(cli, ["user", "login", "-w"], 90_000)).ok)
            return true;
        this.o.log("[tunnel] integrated login failed, trying browser login");
        return (await this.run(cli, ["user", "login"], 5 * 60_000)).ok;
    }
    /** Public URL of our port, or "" while the host is not connected (portUri only exists once hosted). */
    async lookupUrl(cli, id) {
        const r = await this.run(cli, ["show", id, "--json"], 20_000);
        if (!r.ok)
            return "";
        try {
            const j = JSON.parse(r.out);
            const uri = j.tunnel?.ports?.find((p) => p.portNumber === this.o.port)?.portUri;
            return uri ? `${uri.replace(/\/$/, "")}/mcp` : "";
        }
        catch {
            return "";
        }
    }
    /** Install/login/create as needed, then host. Safe to call repeatedly. */
    async ensure() {
        if (this.busy)
            return;
        this.busy = true;
        try {
            this.set("preparing", "Dev Tunnel CLI 확인 중");
            let cli = this.findCli();
            if (!cli && process.platform === "win32" && this.o.autoInstall !== false) {
                this.set("preparing", "winget으로 Dev Tunnel CLI 설치 중");
                this.o.log("[tunnel] installing Microsoft.devtunnel via winget");
                await new Promise((r) => execFile("winget", ["install", "Microsoft.devtunnel", "--accept-source-agreements", "--accept-package-agreements"], { windowsHide: true, timeout: 5 * 60_000 }, () => r()));
                cli = this.findCli();
            }
            if (!cli) {
                const hint = process.platform === "win32" ? "`winget install Microsoft.devtunnel`" : "https://aka.ms/devtunnels/cli 에서 설치";
                return this.set("error", `devtunnel CLI가 없습니다. ${hint}`);
            }
            if (!(await this.loggedIn(cli))) {
                this.set("preparing", "Dev Tunnel 로그인 중 (창이 열릴 수 있습니다)");
                if (!(await this.login(cli)))
                    return this.set("error", "Dev Tunnel 로그인 실패 — `devtunnel user login`을 직접 실행해 주세요.");
            }
            let id = this.o.getTunnelId().trim();
            if (!id) {
                this.set("preparing", "고정 터널 생성 중");
                const c = await this.run(cli, ["create", "--allow-anonymous"]);
                const m = /Tunnel ID\s*:\s*(\S+)/.exec(c.out);
                if (!m)
                    return this.set("error", `터널 생성 실패: ${(c.err || c.out).slice(0, 200)}`);
                id = m[1];
                await this.run(cli, ["port", "create", id, "-p", String(this.o.port), "--protocol", "http"]);
                this.o.onUpdate({ id, url: "" });
            }
            this.id = id;
            this.svc?.removeAllListeners();
            await this.svc?.stop();
            const cliFinal = cli;
            this.svc = new Service({
                name: "tunnel",
                // re-check the login before every (re)start: the ~24h token expires while the PC keeps running
                spawnSpec: async () => {
                    killByCommandLine(path.basename(cliFinal[0]).replace(/.exe$/i, ""), `host ${id}`); // orphan from a force-killed supervisor
                    if (!(await this.loggedIn(cliFinal)))
                        await this.login(cliFinal);
                    return { cmd: cliFinal[0], args: [...cliFinal.slice(1), "host", id] };
                },
                ready: async () => {
                    const url = await this.lookupUrl(cliFinal, id);
                    if (url && url !== this.url) {
                        this.url = url;
                        this.o.onUpdate({ id, url });
                    }
                    return !!url;
                },
                logOut: this.o.logFile,
                logErr: this.o.logFile,
                log: this.o.log,
                readyTimeoutMs: 60_000,
                healthIntervalMs: 15_000,
                healthFailures: 2,
            });
            this.svc.on("change", (s) => {
                if (s.state === "running")
                    this.set("online", "");
                else if (s.state === "failed")
                    this.set("error", s.message);
                else if (s.state === "stopped")
                    this.set("off");
                else
                    this.set(s.state === "starting" ? "connecting" : "offline", s.message);
            });
            this.set("connecting", "터널 연결 중");
            await this.svc.start();
        }
        finally {
            this.busy = false;
        }
    }
    async stop() {
        await this.svc?.stop();
        this.set("off");
    }
    snapshot() {
        return { state: this.state, message: this.message, id: this.id || this.o.getTunnelId(), url: this.url, service: this.svc?.status() ?? null };
    }
}
export { portOpen };
