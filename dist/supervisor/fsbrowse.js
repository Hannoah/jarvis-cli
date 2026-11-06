/**
 * Folder browsing for the dashboard's "add folder" picker. Browsers never reveal absolute paths of chosen folders, so
 * the page asks Jarvis (which runs on the same PC) to list sub-folders. Only folder names are returned, never files or contents,
 * and only through the authenticated, loopback-only dashboard.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
export class BrowseError extends Error {
}
export const PC = "@pc";
const MAX_ENTRIES = 1000;
const isWin = process.platform === "win32";
let driveCache = null;
/** Probing A:..Z: with existsSync can hang for seconds on disconnected network drives, so ask Windows instead. */
function drives() {
    if (driveCache && Date.now() - driveCache.at < 30000)
        return driveCache.v;
    const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "(Get-PSDrive -PSProvider FileSystem).Root"], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    const v = (r.stdout ?? "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => /^[A-Za-z]:\\$/.test(l))
        .map((l) => ({ name: `${l[0].toUpperCase()}: 드라이브`, path: l }));
    if (v.length) {
        driveCache = { at: Date.now(), v };
        return v;
    }
    // PowerShell timed out or failed (a busy PC): show the system drive for now, do not remember the failure, ask again next time
    driveCache = null;
    const sys = (process.env.SystemDrive || "C:").slice(0, 2).toUpperCase();
    return [{ name: `${sys[0]}: 드라이브`, path: `${sys}\\` }];
}
function placesOf(home) {
    const out = [{ name: "홈", path: home }];
    for (const [dir, label] of [["Desktop", "바탕 화면"], ["Documents", "문서"], ["Downloads", "다운로드"], ["Work", "Work"]]) {
        const p = path.join(home, dir);
        try {
            if (fs.statSync(p).isDirectory())
                out.push({ name: label, path: p });
        }
        catch {
            /* not on this machine */
        }
    }
    if (isWin)
        out.push({ name: "내 PC", path: PC });
    return out;
}
const hidden = (name) => name.startsWith(".") || name.startsWith("$") || name === "System Volume Information";
/** List the sub-folders of `raw` (absolute path; "" = home; "@pc" = drives on Windows). */
export function browse(raw, home) {
    const want = raw.trim();
    if (want.length > 1024 || want.includes("\0"))
        throw new BrowseError("올바르지 않은 경로입니다.");
    const places = placesOf(home);
    if (want === PC && isWin)
        return { path: PC, parent: null, is_root: true, entries: drives(), places, truncated: false };
    if (want && want !== PC && !path.isAbsolute(want))
        throw new BrowseError("전체 경로를 입력하세요. 예: " + (isWin ? "D:\\Projects" : "/home/me/projects"));
    const target = path.resolve(want === PC ? path.parse(home).root : want || home);
    let st;
    try {
        st = fs.statSync(target);
    }
    catch {
        throw new BrowseError(`폴더가 없습니다: ${target}`);
    }
    if (!st.isDirectory())
        throw new BrowseError(`폴더가 아닙니다: ${target}`);
    let dirents;
    try {
        dirents = fs.readdirSync(target, { withFileTypes: true });
    }
    catch {
        throw new BrowseError(`이 폴더를 열 수 없습니다(권한 없음): ${target}`);
    }
    const entries = [];
    const realTarget = fs.realpathSync.native(target);
    for (const d of dirents) {
        if (hidden(d.name))
            continue;
        const full = path.join(target, d.name);
        let isDir = d.isDirectory();
        if (!isDir && d.isSymbolicLink()) {
            // Links/junctions: list those that lead to a real folder elsewhere. A link that points back inside the folder being
            // shown is only an alias of something listed anyway; Windows keeps a dozen of them in the home folder
            // ("Application Data", "시작 메뉴", "Cookies", ...) and they would bury the real folders.
            try {
                isDir = fs.statSync(full).isDirectory();
                if (isDir) {
                    const rel = path.relative(realTarget, fs.realpathSync.native(full));
                    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel))
                        isDir = false;
                }
            }
            catch {
                isDir = false;
            }
        }
        if (isDir)
            entries.push({ name: d.name, path: full });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, "ko", { sensitivity: "base", numeric: true }));
    const truncated = entries.length > MAX_ENTRIES;
    const up = path.dirname(target);
    const isRoot = up === target;
    return { path: target, parent: isRoot ? (isWin ? PC : null) : up, is_root: isRoot, entries: entries.slice(0, MAX_ENTRIES), places, truncated };
}
