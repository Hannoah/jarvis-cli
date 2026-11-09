/**
 * Palo Alto GlobalProtect VPN inspection and Keep-Alive tools.
 * Helps remote AI agents verify corporate network access before calling Kubernetes/Viya tools,
 * and maintains outbound traffic to prevent corporate VPN idle session disconnects.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Ctx } from "../core/context.js";
import { psExecutable } from "../security/policy.js";
import { json, READ_ONLY } from "./common.js";

export interface VpnStatus {
  connected: boolean;
  adapter_name: string | null;
  adapter_status: string;
  ip_addresses: string[];
  service_status: string;
  k8s_target: string;
  k8s_reachable: boolean;
  message: string;
}

export interface KeepAliveState {
  active: boolean;
  target: string;
  interval_sec: number;
  total_pings: number;
  successful_pings: number;
  last_ping_time: string | null;
  last_ping_success: boolean | null;
}

// In-memory keep-alive timer state across tool calls within the process
let keepAliveTimer: NodeJS.Timeout | null = null;
let keepAliveState: KeepAliveState = {
  active: false,
  target: "",
  interval_sec: 180,
  total_pings: 0,
  successful_pings: 0,
  last_ping_time: null,
  last_ping_success: null,
};

/** Normalize target host/URL string into clean hostname and optional port. */
export function parseTargetEndpoint(input: string, fallbackPort = 443): { host: string; port: number } {
  let cleaned = input.trim().replace(/^https?:\/\//i, "");
  // Strip any trailing paths or queries
  cleaned = cleaned.split("/")[0]!.split("?")[0]!;
  const m = /^([^:]+)(?::(\d+))?$/.exec(cleaned);
  if (m) {
    return {
      host: m[1]!,
      port: m[2] ? Number(m[2]) : fallbackPort,
    };
  }
  return { host: cleaned, port: fallbackPort };
}

/** Parse the default kubeconfig to discover the corporate AKS/Kubernetes endpoint. */
export function getDefaultKubeServer(home = os.homedir()): { host: string; port: number } | null {
  try {
    const kfile = path.join(home, ".kube", "config");
    if (!fs.existsSync(kfile)) return null;
    const content = fs.readFileSync(kfile, "utf8");
    const m = /server:\s*["']?https?:\/\/([^:\s/"']+)(?::(\d+))?/i.exec(content);
    if (!m) return null;
    return { host: m[1]!, port: m[2] ? Number(m[2]) : 443 };
  } catch {
    return null;
  }
}

/** Test TCP connectivity with a strict timeout (including DNS lookup watchdog). */
export function testTcpConnectivity(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (ok: boolean) => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };

    // Overall watchdog timer: guarantees resolution even if DNS lookup hangs
    timer = setTimeout(() => finish(false), timeoutMs);

    const socket = net.connect({ host, port });
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

/** Check GlobalProtect Virtual Adapter status using PowerShell (Windows-safe). */
export function queryGlobalProtectAdapter(): Promise<{ status: string; name: string | null; ips: string[] }> {
  if (process.platform !== "win32") {
    return Promise.resolve({ status: "Unsupported on non-Windows", name: null, ips: [] });
  }
  return new Promise((resolve) => {
    const ps = psExecutable();
    const script = `
$adapter = Get-NetAdapter | Where-Object { $_.InterfaceDescription -like '*Palo Alto*' -or $_.InterfaceDescription -like '*PANGP*' -or $_.Name -like '*GlobalProtect*' -or $_.Name -like '*PANGP*' } | Select-Object -First 1
if (!$adapter) {
    Write-Output "NOT_FOUND"
} else {
    $ips = (Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -ErrorAction SilentlyContinue | Where-Object { $_.AddressFamily -eq 'IPv4' }).IPAddress -join ','
    Write-Output ($adapter.Status + '|' + $adapter.Name + '|' + $ips)
}
    `.trim();

    execFile(ps, ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 8000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout.trim() || stdout.includes("NOT_FOUND")) {
        return resolve({ status: "Not Found", name: null, ips: [] });
      }
      const parts = stdout.trim().split("|");
      const status = parts[0]?.trim() || "Unknown";
      const name = parts[1]?.trim() || null;
      const ips = parts[2] ? parts[2].split(",").map((s) => s.trim()).filter(Boolean) : [];
      resolve({ status, name, ips });
    });
  });
}

/** Query PanGPS Windows service status. */
export function queryPanGpsService(): Promise<string> {
  if (process.platform !== "win32") return Promise.resolve("Unsupported on non-Windows");
  return new Promise((resolve) => {
    const ps = psExecutable();
    execFile(ps, ["-NoProfile", "-NonInteractive", "-Command", "(Get-Service PanGPS -ErrorAction SilentlyContinue).Status"], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout.trim()) return resolve("Stopped or Not Installed");
      resolve(stdout.trim());
    });
  });
}

export function registerVpnTools(mcp: McpServer, ctx: Ctx): void {
  mcp.registerTool(
    "check_vpn_status",
    {
      description:
        "Check Palo Alto GlobalProtect VPN adapter and connectivity to corporate Kubernetes/SAS Viya cluster. " +
        "Run this before kubectl/viya commands to verify if the corporate VPN is connected.",
      inputSchema: {
        target_host: z.string().optional().describe("Optional host or IP to probe (defaults to the cluster in ~/.kube/config)."),
        target_port: z.number().int().default(443).describe("TCP port to probe (default 443)."),
      },
      annotations: READ_ONLY,
    },
    async ({ target_host, target_port }) => {
      const kubeServer = getDefaultKubeServer(ctx.cfg.home);
      const defaultHost = kubeServer?.host || process.env.JARVIS_VPN_TARGET_HOST || "";
      const defaultPort = kubeServer?.port || 443;

      let host = defaultHost;
      let port = target_port || defaultPort;

      if (target_host && target_host.trim()) {
        const parsed = parseTargetEndpoint(target_host, port);
        host = parsed.host;
        port = target_port !== undefined && target_port !== 443 ? target_port : parsed.port;
      }

      if (!host) {
        return json({
          connected: false,
          adapter_name: null,
          adapter_status: "Target Host Required",
          ip_addresses: [],
          service_status: "Unknown",
          k8s_target: "",
          k8s_reachable: false,
          message: "No target host specified and corporate cluster endpoint was not found in ~/.kube/config. Please provide target_host or set JARVIS_VPN_TARGET_HOST.",
        });
      }

      const [adapter, svcStatus, k8sReachable] = await Promise.all([
        queryGlobalProtectAdapter(),
        queryPanGpsService(),
        testTcpConnectivity(host, port, 3000),
      ]);

      const connected = adapter.status.toLowerCase() === "up" || k8sReachable;
      let message = "";
      if (connected && k8sReachable) {
        message = `GlobalProtect VPN is CONNECTED (${adapter.name ?? "VPN"}). SAS Viya Kubernetes cluster (${host}:${port}) is reachable.`;
      } else if (connected && !k8sReachable) {
        message = `GlobalProtect VPN adapter is UP, but Kubernetes endpoint (${host}:${port}) is not reachable. Check corporate DNS or route.`;
      } else {
        message = `GlobalProtect VPN is DISCONNECTED (Adapter: ${adapter.status}, Service: ${svcStatus}). Please connect GlobalProtect from the PC tray.`;
      }

      ctx.audit("check_vpn_status", "ALLOW", `connected=${connected} k8s=${k8sReachable}`);
      const res: VpnStatus = {
        connected,
        adapter_name: adapter.name,
        adapter_status: adapter.status,
        ip_addresses: adapter.ips,
        service_status: svcStatus,
        k8s_target: `${host}:${port}`,
        k8s_reachable: k8sReachable,
        message,
      };
      return json(res);
    },
  );

  mcp.registerTool(
    "vpn_keepalive",
    {
      description:
        "Manage background keep-alive probes to prevent corporate VPN idle session timeouts. " +
        "Sends lightweight TCP probes to the Kubernetes/corporate endpoint periodically.",
      inputSchema: {
        action: z.enum(["start", "stop", "status"]).default("status").describe("Action to perform: 'start' keep-alive, 'stop' keep-alive, or 'status'."),
        interval_sec: z.number().int().min(30).max(600).default(180).describe("Probe interval in seconds (default 180s = 3 minutes)."),
        target_host: z.string().optional().describe("Optional host to probe (defaults to the cluster in ~/.kube/config)."),
        target_port: z.number().int().default(443).describe("Port to probe (default 443)."),
      },
      annotations: READ_ONLY,
    },
    async ({ action, interval_sec, target_host, target_port }) => {
      const kubeServer = getDefaultKubeServer(ctx.cfg.home);
      const defaultHost = kubeServer?.host || process.env.JARVIS_VPN_TARGET_HOST || "";
      const defaultPort = kubeServer?.port || 443;

      let host = defaultHost;
      let port = target_port || defaultPort;

      if (target_host && target_host.trim()) {
        const parsed = parseTargetEndpoint(target_host, port);
        host = parsed.host;
        port = target_port !== undefined && target_port !== 443 ? target_port : parsed.port;
      }

      if (action === "stop") {
        if (keepAliveTimer) {
          clearInterval(keepAliveTimer);
          keepAliveTimer = null;
        }
        keepAliveState.active = false;
        ctx.audit("vpn_keepalive", "ALLOW", "stopped");
        return json({ success: true, message: "VPN keep-alive stopped.", state: keepAliveState });
      }

      if (action === "status") {
        return json({
          success: true,
          state: keepAliveState,
        });
      }

      // action === "start" requires a valid target host
      if (!host) {
        return json({
          success: false,
          message: "No target host specified and corporate cluster endpoint was not found in ~/.kube/config. Please provide target_host or set JARVIS_VPN_TARGET_HOST.",
          state: keepAliveState,
        });
      }

      const targetStr = `${host}:${port}`;

      if (action === "start") {
        if (keepAliveTimer) clearInterval(keepAliveTimer);

        keepAliveState = {
          active: true,
          target: targetStr,
          interval_sec,
          total_pings: 0,
          successful_pings: 0,
          last_ping_time: null,
          last_ping_success: null,
        };

        const doProbe = async () => {
          try {
            const ok = await testTcpConnectivity(host, port, 3000);
            keepAliveState.total_pings++;
            if (ok) keepAliveState.successful_pings++;
            keepAliveState.last_ping_time = new Date().toISOString();
            keepAliveState.last_ping_success = ok;
          } catch {
            keepAliveState.total_pings++;
            keepAliveState.last_ping_time = new Date().toISOString();
            keepAliveState.last_ping_success = false;
          }
        };

        // Initial immediate probe
        await doProbe();

        // Recurring unref'd timer
        keepAliveTimer = setInterval(doProbe, interval_sec * 1000);
        keepAliveTimer.unref();

        ctx.audit("vpn_keepalive", "ALLOW", `started target=${targetStr} interval=${interval_sec}s`);
        return json({
          success: true,
          message: `VPN keep-alive started for ${targetStr} every ${interval_sec} seconds.`,
          state: keepAliveState,
        });
      }

      // 'status' action
      return json({
        success: true,
        state: keepAliveState,
      });
    },
  );
}

/** Test helper to ensure isolated keep-alive state across runs. */
export function resetKeepAliveForTest(): void {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  keepAliveState = {
    active: false,
    target: "",
    interval_sec: 180,
    total_pings: 0,
    successful_pings: 0,
    last_ping_time: null,
    last_ping_success: null,
  };
}
