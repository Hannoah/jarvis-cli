import fs from "node:fs";

export type Audit = (tool: string, status: string, detail: string) => void;

const pad = (n: number) => String(n).padStart(2, "0");

export function timestamp(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export interface AuditLimits {
  maxBytes?: number;
  backups?: number;
}

/** audit.log -> audit.log.1 -> ... -> audit.log.N (oldest dropped). Never throws: a locked file just keeps growing. */
function rotate(file: string, keep: number): void {
  try {
    fs.rmSync(`${file}.${keep}`, { force: true });
    for (let i = keep - 1; i >= 1; i--) if (fs.existsSync(`${file}.${i}`)) fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    fs.renameSync(file, `${file}.1`);
  } catch {
    /* try again on the next write */
  }
}

/** Same line format as the Python server so existing tooling/dashboards keep working. Rotates at 10 MB, keeps 5. */
export function createAudit(file: string, { maxBytes = 10 * 1024 * 1024, backups = 5 }: AuditLimits = {}): Audit {
  let size = -1; // unknown until the first stat; afterwards tracked per write (this is the only writer)
  let sinceResync = 0;
  return (tool, status, detail) => {
    try {
      if (size < 0 || ++sinceResync >= 64) {
        sinceResync = 0;
        try {
          size = fs.statSync(file).size;
        } catch {
          size = 0; // no file yet (or otherwise unreadable: the append below decides)
        }
      }
      if (size >= maxBytes) {
        rotate(file, backups);
        try {
          size = fs.statSync(file).size; // gone after a rename; unchanged if the rotate failed and must be retried
        } catch {
          size = 0;
        }
      }
      const line = `[${timestamp()}] [${status}] [${tool}] ${detail}\n`;
      fs.appendFileSync(file, line, "utf8");
      size += Buffer.byteLength(line);
    } catch {
      // auditing must never take the server down
    }
  };
}
