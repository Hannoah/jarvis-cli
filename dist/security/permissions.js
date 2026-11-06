/**
 * Keep the data folder (and everything Jarvis writes into it: .env with the API key, token
 * stores, logs, backups) readable only by the current user.
 *
 * POSIX files are created 0600, but the data *directory* itself used to inherit the umask
 * (usually 755), and on Windows every new file inherits the parent folder ACL, so any local
 * user could read the secrets. One call at startup fixes both, including files written by older
 * versions. Best effort: unusual filesystems (FAT32, some network shares) cannot carry ACLs, and
 * Jarvis must still start there.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
export function privatizeDataDir(dir) {
    try {
        if (!fs.existsSync(dir))
            return false;
        if (process.platform === "win32") {
            const user = process.env.USERNAME;
            if (!user)
                return false;
            // /inheritance:r detaches from the parent, /grant:r keeps only this user, /T repairs
            // files an older version already wrote. Administrators can still take ownership.
            const r = spawnSync("icacls", [dir, "/inheritance:r", "/grant:r", `${user}:F`, "/T"], {
                timeout: 30_000,
                windowsHide: true,
            });
            return r.status === 0;
        }
        fs.chmodSync(dir, 0o700);
        return true;
    }
    catch {
        return false;
    }
}
