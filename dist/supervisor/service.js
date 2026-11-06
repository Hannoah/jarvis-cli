/**
 * A supervised child process: starts it, waits until it is really ready, restarts it when it dies or stops answering,
 * and gives up after a crash loop instead of spinning forever.
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { killTree, sleep } from "../system/proc.js";
export class Service extends EventEmitter {
    /** Every live child of every Service, so a dying supervisor can take them with it. */
    static live = new Set();
    static killAll() {
        for (const c of Service.live)
            killTree(c);
        Service.live.clear();
    }
    state = "stopped";
    message = "";
    child = null;
    desired = false;
    startedAt = null;
    stamps = [];
    total = 0;
    lastExit = null;
    generation = 0; // invalidates timers/loops of previous runs
    o;
    constructor(opts) {
        super();
        this.o = { maxRestarts: 5, windowMs: 10 * 60_000, backoffMs: [500, 2000, 5000], readyTimeoutMs: 30_000, healthIntervalMs: 5000, healthFailures: 3, ...opts };
    }
    set(state, message = "") {
        this.state = state;
        this.message = message;
        this.emit("change", this.status());
    }
    log(m) {
        this.o.log?.(`[${this.o.name}] ${m}`);
    }
    status() {
        const now = Date.now();
        return {
            name: this.o.name,
            state: this.state,
            pid: this.child?.pid ?? null,
            started_at: this.startedAt,
            restarts_in_window: this.stamps.filter((t) => now - t < this.o.windowMs).length,
            total_restarts: this.total,
            last_exit: this.lastExit,
            message: this.message,
        };
    }
    /** Begin (or resume) running. Resolves when the first launch attempt has been made, not when it is ready. */
    async start() {
        if (this.desired && this.state !== "failed" && this.state !== "stopped")
            return;
        this.desired = true;
        this.stamps = [];
        await this.launch();
    }
    async stop() {
        this.desired = false;
        this.generation++;
        const c = this.child;
        this.child = null;
        if (c && c.exitCode === null) {
            const exited = new Promise((r) => c.once("exit", () => r()));
            killTree(c);
            await Promise.race([exited, sleep(5000)]);
        }
        this.startedAt = null;
        this.set("stopped");
    }
    async restart() {
        await this.stop();
        await this.start();
    }
    async launch() {
        const gen = ++this.generation;
        this.set(this.stamps.length ? "restarting" : "starting");
        let spec;
        try {
            spec = await this.o.spawnSpec();
        }
        catch (e) {
            this.log(`cannot start: ${e.message}`);
            this.desired = false;
            this.set("failed", e.message);
            return;
        }
        if (gen !== this.generation)
            return;
        const out = this.o.logOut ? fs.openSync(this.o.logOut, "a") : "ignore";
        const err = this.o.logErr ? fs.openSync(this.o.logErr, "a") : "ignore";
        let child;
        try {
            child = spawn(spec.cmd, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ["ignore", out, err], windowsHide: true, detached: process.platform !== "win32" });
        }
        catch (e) {
            this.log(`spawn failed: ${e.message}`);
            this.desired = false;
            this.set("failed", e.message);
            return;
        }
        finally {
            for (const fd of [out, err])
                if (typeof fd === "number")
                    fs.closeSync(fd);
        }
        this.child = child;
        Service.live.add(child);
        child.once("exit", () => Service.live.delete(child));
        this.startedAt = Date.now();
        this.log(`started pid ${child.pid}`);
        const gone = (code, signal) => {
            if (this.child !== child)
                return; // already replaced or stopped on purpose
            this.child = null;
            this.lastExit = { code, signal, at: Date.now() };
            this.log(`exited (code ${code}, signal ${signal})`);
            void this.onUnexpectedExit(code, signal);
        };
        child.once("exit", gone);
        // A command that cannot be spawned (missing file, bad permissions) emits "error" and never "exit".
        child.once("error", (e) => {
            this.log(`process error: ${e.message}`);
            if (child.pid === undefined)
                gone(null, "spawn-error");
        });
        void this.watch(gen, child);
    }
    /** Wait for readiness, then keep checking; restart the child if it stops answering. */
    async watch(gen, child) {
        const deadline = Date.now() + this.o.readyTimeoutMs;
        while (gen === this.generation && this.child === child && Date.now() < deadline) {
            if (await this.o.ready().catch(() => false)) {
                if (gen !== this.generation || this.child !== child)
                    return;
                this.set("running");
                break;
            }
            await sleep(250);
        }
        if (gen !== this.generation || this.child !== child)
            return;
        if (this.state !== "running") {
            this.log(`not ready after ${this.o.readyTimeoutMs} ms, restarting`);
            killTree(child);
            return; // the exit handler schedules the restart
        }
        let fails = 0;
        while (gen === this.generation && this.child === child) {
            await sleep(this.o.healthIntervalMs);
            if (gen !== this.generation || this.child !== child)
                return;
            fails = (await this.o.ready().catch(() => false)) ? 0 : fails + 1;
            if (fails >= this.o.healthFailures) {
                this.log(`health check failed ${fails} times, restarting`);
                killTree(child);
                return;
            }
        }
    }
    async onUnexpectedExit(code, signal) {
        if (!this.desired)
            return;
        const now = Date.now();
        this.stamps = this.stamps.filter((t) => now - t < this.o.windowMs);
        this.stamps.push(now);
        this.total++;
        if (this.stamps.length > this.o.maxRestarts) {
            if (this.o.crashLoopCooldownMs && this.o.crashLoopCooldownMs > 0) {
                const coolSec = Math.round(this.o.crashLoopCooldownMs / 1000);
                this.log(`giving up temporarily: more than ${this.o.maxRestarts} restarts in ${Math.round(this.o.windowMs / 60000)} min. Auto-recovering in ${coolSec}s`);
                this.set("failed", `crash loop (last exit: code ${code}, signal ${signal}); auto-recovering in ${coolSec}s`);
                const gen = this.generation;
                await sleep(this.o.crashLoopCooldownMs);
                if (this.desired && gen === this.generation) {
                    this.log(`cooldown elapsed, attempting auto-recovery`);
                    this.stamps = [];
                    await this.launch();
                }
                return;
            }
            this.desired = false;
            this.log(`giving up: more than ${this.o.maxRestarts} restarts in ${Math.round(this.o.windowMs / 60000)} min`);
            this.set("failed", `crash loop (last exit: code ${code}, signal ${signal})`);
            return;
        }
        const delay = this.o.backoffMs[Math.min(this.stamps.length - 1, this.o.backoffMs.length - 1)];
        this.set("restarting", `restart ${this.stamps.length}/${this.o.maxRestarts} in ${delay} ms`);
        const gen = this.generation;
        await sleep(delay);
        if (this.desired && gen === this.generation)
            await this.launch();
    }
}
