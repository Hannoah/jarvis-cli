import { spawnSync } from "node:child_process";
import net from "node:net";
/** Kill a child and everything it started. Windows: taskkill /T. POSIX: the child must have been spawned `detached`. */
export function killTree(child, signal = "SIGKILL") {
    if (!child.pid)
        return;
    try {
        if (process.platform === "win32")
            spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { timeout: 5000, windowsHide: true });
        else
            process.kill(-child.pid, signal);
    }
    catch {
        child.kill(signal);
    }
}
export function portOpen(port, host = "127.0.0.1", timeoutMs = 800) {
    return new Promise((resolve) => {
        const s = net.connect({ port, host });
        const done = (ok) => {
            s.destroy();
            resolve(ok);
        };
        s.setTimeout(timeoutMs, () => done(false));
        s.once("connect", () => done(true));
        s.once("error", () => done(false));
    });
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** PID listening on a local TCP port, or null. Windows: netstat; elsewhere: lsof. */
export function portOwnerPid(port) {
    if (process.platform === "win32") {
        const r = spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
        for (const line of (r.stdout ?? "").split(/\r?\n/)) {
            const m = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i.exec(line);
            if (m && Number(m[1]) === port)
                return Number(m[2]);
        }
        return null;
    }
    const r = spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8", timeout: 10000 });
    const pid = Number((r.stdout ?? "").split(/\s+/)[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
}
/** Kill every process whose command line contains `needle` (never our own pid). Used for orphaned tunnel hosts. */
export function killByCommandLine(processName, needle) {
    if (!/^[\w.-]+$/.test(processName) || !/^[\w.@: /-]+$/.test(needle))
        return; // both are interpolated: refuse anything unusual
    if (process.platform === "win32") {
        spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `Get-CimInstance Win32_Process -Filter "Name='${processName}.exe'" | Where-Object { $_.CommandLine -like '*${needle}*' -and $_.ProcessId -ne ${process.pid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { windowsHide: true, timeout: 20000 });
    }
    else {
        spawnSync("pkill", ["-f", `${processName} .*${needle}`], { timeout: 5000 });
    }
}
