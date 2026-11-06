/** OS-specific actions behind one small API, so tools stay platform-agnostic (Windows, macOS, Linux). */
import { spawn, spawnSync } from "node:child_process";

const PS = ["-NoProfile", "-NonInteractive", "-Command"];
const UTF8_OUT = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ";

/** Open a file path or http(s) URL with the desktop's default handler. No shell is involved. */
export function openDefault(target: string): void {
  const [cmd, args] =
    process.platform === "win32"
      ? ["rundll32.exe", ["url.dll,FileProtocolHandler", target]]
      : process.platform === "darwin"
        ? ["open", [target]]
        : ["xdg-open", [target]];
  const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => undefined);
  child.unref();
}

export function getClipboard(): string {
  const r =
    process.platform === "win32"
      ? spawnSync("powershell.exe", [...PS, `${UTF8_OUT}Get-Clipboard`], { encoding: "utf8", timeout: 5000, windowsHide: true })
      : process.platform === "darwin"
        ? spawnSync("pbpaste", [], { encoding: "utf8", timeout: 5000 })
        : spawnSync("sh", ["-c", "wl-paste 2>/dev/null || xclip -selection clipboard -o"], { encoding: "utf8", timeout: 5000 });
  if (r.error) throw r.error;
  return r.stdout.replace(/[\r\n]+$/, "");
}

export function setClipboard(text: string): void {
  const r =
    process.platform === "win32"
      ? spawnSync("powershell.exe", [...PS, "[Console]::InputEncoding=[System.Text.Encoding]::UTF8; $input | Set-Clipboard"], { input: text, encoding: "utf8", timeout: 5000, windowsHide: true })
      : process.platform === "darwin"
        ? spawnSync("pbcopy", [], { input: text, encoding: "utf8", timeout: 5000 })
        : spawnSync("sh", ["-c", "wl-copy 2>/dev/null || xclip -selection clipboard"], { input: text, encoding: "utf8", timeout: 5000 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr || `clipboard command exited with ${r.status}`);
}

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function notify(title: string, message: string): void {
  let r;
  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "Add-Type -AssemblyName System.Drawing",
      "$n = New-Object System.Windows.Forms.NotifyIcon",
      "$n.Icon = [System.Drawing.SystemIcons]::Information",
      "$n.Visible = $true",
      `$n.ShowBalloonTip(4000, ${psQuote(title)}, ${psQuote(message)}, [System.Windows.Forms.ToolTipIcon]::Info)`,
      "Start-Sleep -Milliseconds 800",
      "$n.Dispose()",
    ].join("\n");
    r = spawnSync("powershell.exe", [...PS, script], { timeout: 8000, windowsHide: true });
  } else if (process.platform === "darwin") {
    // title/message travel as argv, never interpolated into the AppleScript source.
    r = spawnSync("osascript", ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", title, message], { timeout: 8000 });
  } else {
    r = spawnSync("notify-send", [title, message], { timeout: 8000 });
  }
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`notification command exited with ${r.status}`);
}
