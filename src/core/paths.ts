/**
 * Where things live.
 *   appDir  - the installed program (code). Replaced on upgrade, so nothing is written here.
 *   dataDir - everything Jarvis writes: .env, audit log, wiki, backups. Default ~/.jarvis, or JARVIS_HOME.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privatizeDataDir } from "../security/permissions.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** src/core/ (tsx) and dist/core/ (built) are both two levels below the package folder. */
export const appDir = path.resolve(here, "..", "..");

export function dataDirOf(env: NodeJS.ProcessEnv = process.env): string {
  return env.JARVIS_HOME ? path.resolve(env.JARVIS_HOME) : path.join(os.homedir(), ".jarvis");
}

export function prepareDataDir(env: NodeJS.ProcessEnv = process.env): { dataDir: string } {
  const dataDir = dataDirOf(env);
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  privatizeDataDir(dataDir); // best effort
  return { dataDir };
}
