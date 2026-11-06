import fs from "node:fs";
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const RETRY = new Set(["EPERM", "EBUSY", "EACCES"]);
/**
 * Write via a temp file + rename so a crash never leaves a half-written file, retrying the rename with backoff:
 * on Windows an antivirus scanner or indexer briefly holding the file makes rename fail with EPERM/EBUSY.
 * Owner-only (0600) on POSIX: every caller writes server state (.env with the API key, token store, backup history).
 */
export function writeFileAtomic(target, content, retries = 5) {
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, content, { mode: 0o600 });
    for (let i = 0;; i++) {
        try {
            fs.renameSync(tmp, target);
            return;
        }
        catch (e) {
            if (i >= retries || !RETRY.has(e.code ?? "")) {
                fs.rmSync(tmp, { force: true });
                throw e;
            }
            sleepSync(50 * 2 ** i);
        }
    }
}
