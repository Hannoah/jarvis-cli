/**
 * Start the supervisor when the user logs in, and keep it alive:
 *   Windows  Task Scheduler (ONLOGON) -> hidden VBS wrapper
 *   macOS    LaunchAgent (RunAtLoad + KeepAlive)
 *   Linux    systemd user unit (Restart=always)
 * The generators are pure so they can be tested; `install`/`uninstall` run the OS commands.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
export const TASK_NAME = "Jarvis_Autostart";
export const LAUNCH_LABEL = "com.jarvis.supervisor";
const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function launchAgentPlist(i) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCH_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(i.node)}</string>
    <string>${xml(i.entry)}</string>
    <string>start</string>
    <string>--no-open</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(i.projectDir)}</string>
  <key>EnvironmentVariables</key><dict><key>JARVIS_HOME</key><string>${xml(i.projectDir)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(path.join(i.projectDir, "supervisor.stdout.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(i.projectDir, "supervisor.stdout.log"))}</string>
</dict>
</plist>
`;
}
const sdQuote = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
export function systemdUnit(i) {
    return `[Unit]
Description=Jarvis MCP supervisor
After=network-online.target

[Service]
Environment=JARVIS_HOME=${sdQuote(i.projectDir)}
WorkingDirectory=${i.projectDir}
ExecStart=${sdQuote(i.node)} ${sdQuote(i.entry)} start --no-open
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
}
/** Hidden launch (window style 0) so no console window sits on the desktop. */
export function windowsVbs(i) {
    const q = (s) => `""${s.replace(/"/g, '""')}""`;
    return `Set sh = CreateObject("WScript.Shell")\r\nsh.CurrentDirectory = "${i.projectDir.replace(/"/g, '""')}"\r\nsh.Environment("Process")("JARVIS_HOME") = "${i.projectDir.replace(/"/g, '""')}"\r\nsh.Run "${q(i.node)} ${q(i.entry)} start --no-open", 0, False\r\n`;
}
/**
 * Task Scheduler task (imported via schtasks /Create /XML): logon trigger, least privilege, and —
 * what the old /SC ONLOGON command line could not express — restart on failure, no execution time
 * limit, and start even on batteries. Unlike /TR there is no 261-char path limit. Written UTF-16
 * (what schtasks expects for /XML imports).
 */
export function windowsTaskXml(i, vbs) {
    return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Jarvis MCP supervisor: starts at logon, restarts on failure.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>wscript.exe</Command>
      <Arguments>"${xml(vbs)}"</Arguments>
      <WorkingDirectory>${xml(i.projectDir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}
const defaultRunner = (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 30000 });
    return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
};
export function install(i, platform = process.platform, run = defaultRunner) {
    if (!fs.existsSync(i.entry))
        return { ok: false, message: `Build first (npm run build): ${i.entry} does not exist.`, files: [] };
    if (platform === "win32") {
        const vbs = path.join(i.projectDir, "jarvis-start.vbs");
        const taskXml = path.join(i.projectDir, "jarvis-task.xml");
        fs.writeFileSync(vbs, windowsVbs(i), "utf8");
        fs.writeFileSync(taskXml, "\uFEFF" + windowsTaskXml(i, vbs), "utf16le"); // BOM: schtasks /XML requires UTF-16
        const r = run("schtasks", ["/Create", "/TN", TASK_NAME, "/XML", taskXml, "/F"]);
        return { ok: r.ok, message: r.ok ? `Registered Task Scheduler task ${TASK_NAME} (runs at logon, restarts on failure).` : r.out, files: [vbs, taskXml] };
    }
    if (platform === "darwin") {
        const plist = path.join(i.home, "Library/LaunchAgents", `${LAUNCH_LABEL}.plist`);
        fs.mkdirSync(path.dirname(plist), { recursive: true });
        fs.writeFileSync(plist, launchAgentPlist(i), "utf8");
        const uid = String(os.userInfo().uid);
        run("launchctl", ["bootout", `gui/${uid}/${LAUNCH_LABEL}`]); // ignore "not loaded"
        const r = run("launchctl", ["bootstrap", `gui/${uid}`, plist]);
        return { ok: r.ok, message: r.ok ? `Loaded LaunchAgent ${LAUNCH_LABEL}.` : r.out, files: [plist] };
    }
    const unit = path.join(i.home, ".config/systemd/user/jarvis.service");
    fs.mkdirSync(path.dirname(unit), { recursive: true });
    fs.writeFileSync(unit, systemdUnit(i), "utf8");
    run("systemctl", ["--user", "daemon-reload"]);
    const r = run("systemctl", ["--user", "enable", "--now", "jarvis.service"]);
    return { ok: r.ok, message: r.ok ? "Enabled systemd user unit jarvis.service." : r.out, files: [unit] };
}
export function uninstall(i, platform = process.platform, run = defaultRunner) {
    if (platform === "win32") {
        const vbs = path.join(i.projectDir, "jarvis-start.vbs");
        const taskXml = path.join(i.projectDir, "jarvis-task.xml");
        const r = run("schtasks", ["/Delete", "/TN", TASK_NAME, "/F"]);
        fs.rmSync(vbs, { force: true });
        fs.rmSync(taskXml, { force: true });
        return { ok: r.ok || /cannot find|지정된 파일|찾을 수 없/i.test(r.out), message: r.ok ? `Removed task ${TASK_NAME}.` : r.out, files: [vbs, taskXml] };
    }
    if (platform === "darwin") {
        const plist = path.join(i.home, "Library/LaunchAgents", `${LAUNCH_LABEL}.plist`);
        run("launchctl", ["bootout", `gui/${os.userInfo().uid}/${LAUNCH_LABEL}`]);
        fs.rmSync(plist, { force: true });
        return { ok: true, message: `Removed LaunchAgent ${LAUNCH_LABEL}.`, files: [plist] };
    }
    const unit = path.join(i.home, ".config/systemd/user/jarvis.service");
    run("systemctl", ["--user", "disable", "--now", "jarvis.service"]);
    fs.rmSync(unit, { force: true });
    run("systemctl", ["--user", "daemon-reload"]);
    return { ok: true, message: "Removed systemd user unit jarvis.service.", files: [unit] };
}
