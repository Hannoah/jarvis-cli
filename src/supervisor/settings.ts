import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expandPath, loadConfig, readEnvFile, realResolve, type Config } from "../core/config.js";
import { updateEnvFile } from "../core/envfile.js";
import { setIdentity, type Identity } from "../security/identity.js";

export { updateEnvFile } from "../core/envfile.js";

export interface SettingsView {
  allowed_dirs: string[];
  default_workdir: string;
  enable_read: boolean;
  enable_write: boolean;
  enable_terminal: boolean;
  auto_approve: boolean;
  terminal_mode: string;
  extra_allowed_commands: string;
  devtunnel_id: string;
  public_url: string;
  port: number;
  api_key_masked: string;
}

export function viewSettings(projectDir: string, cfg: Config = loadConfig({ projectDir })): SettingsView {
  const env = readEnvFile(cfg.envFile);
  const key = (env.PC_MCP_API_KEY ?? "").trim();
  return {
    allowed_dirs: cfg.allowedDirs,
    default_workdir: cfg.defaultWorkdir,
    enable_read: cfg.enableRead,
    enable_write: cfg.enableWrite,
    enable_terminal: cfg.enableTerminal,
    auto_approve: cfg.autoApprove,
    terminal_mode: cfg.terminalMode,
    extra_allowed_commands: [...cfg.extraAllowedCommands].join(";"),
    devtunnel_id: (env.PC_MCP_DEVTUNNEL_ID ?? "").trim(),
    public_url: cfg.publicUrl,
    port: cfg.port,
    api_key_masked: key ? `${key.slice(0, 6)}…(${key.length}자)` : "(없음)",
  };
}

export class SettingsError extends Error {}

const BOOLS: Record<string, string> = { enable_read: "PC_MCP_ENABLE_READ", enable_write: "PC_MCP_ENABLE_WRITE", enable_terminal: "PC_MCP_ENABLE_TERMINAL", auto_approve: "PC_MCP_AUTO_APPROVE" };

/** Validate and persist a settings patch. Returns the keys that changed (the server must restart to apply them). */
export function applySettings(projectDir: string, patch: Record<string, unknown>, cfg: Config = loadConfig({ projectDir })): string[] {
  const updates: Record<string, string> = {};
  let tunnel: Identity | undefined;

  if (patch.allowed_dirs !== undefined) {
    if (!Array.isArray(patch.allowed_dirs) || patch.allowed_dirs.length > 20) throw new SettingsError("allowed_dirs must be a list of at most 20 folders.");
    const dirs: string[] = [];
    for (const raw of patch.allowed_dirs) {
      if (typeof raw !== "string" || !raw.trim()) throw new SettingsError("Empty folder path.");
      const p = realResolve(expandPath(raw, cfg.home, process.env));
      if (path.parse(p).root === p) throw new SettingsError(`'${p}' is a drive/filesystem root; allowing it would disable the sandbox. Pick a folder.`);
      if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new SettingsError(`Folder does not exist: ${p}`);
      if (p.includes(";")) throw new SettingsError(`Folder names containing ';' are not supported: ${p}`);
      dirs.push(p);
    }
    updates.PC_MCP_ALLOWED_DIRS = [...new Set(dirs)].join(";");
  }
  for (const [field, envKey] of Object.entries(BOOLS)) {
    if (patch[field] !== undefined) {
      if (typeof patch[field] !== "boolean") throw new SettingsError(`${field} must be true or false.`);
      updates[envKey] = patch[field] ? "true" : "false";
    }
  }
  if (patch.terminal_mode !== undefined) {
    if (patch.terminal_mode !== "allowlist" && patch.terminal_mode !== "blocklist") throw new SettingsError("terminal_mode must be allowlist or blocklist.");
    updates.PC_MCP_TERMINAL_MODE = patch.terminal_mode;
  }
  if (patch.extra_allowed_commands !== undefined) {
    const s = String(patch.extra_allowed_commands);
    if (!/^[\w\-;,.\s]*$/.test(s)) throw new SettingsError("extra_allowed_commands may only contain command names separated by ; or ,");
    updates.PC_MCP_EXTRA_ALLOWED_COMMANDS = s.trim();
  }
  if (patch.devtunnel_id !== undefined) {
    const s = String(patch.devtunnel_id).trim();
    if (!/^[A-Za-z0-9._-]*$/.test(s)) throw new SettingsError("Invalid tunnel id.");
    tunnel = { tunnelId: s, publicUrl: "" }; // the user asked for this tunnel; the old URL is stale for it
  }
  if (!Object.keys(updates).length && !tunnel) throw new SettingsError("Nothing to change.");
  if (Object.keys(updates).length) updateEnvFile(cfg.envFile, updates);
  if (tunnel) setIdentity(cfg.envFile, cfg.home, tunnel); // the PC's tunnel id changes only through here (or a first creation)
  return [...Object.keys(updates), ...(tunnel ? ["PC_MCP_DEVTUNNEL_ID", "PC_MCP_PUBLIC_URL"] : [])];
}

export function regenerateApiKey(cfg: Config): string {
  const key = `pcmcp_${crypto.randomBytes(24).toString("base64url")}`;
  setIdentity(cfg.envFile, cfg.home, { apiKey: key }); // a user-requested rotation: the new key becomes the PC's key
  return key;
}

export function readApiKey(cfg: Config): string {
  return (readEnvFile(cfg.envFile).PC_MCP_API_KEY ?? "").trim();
}
