/**
 * Allowlist-based PowerShell command policy for `run_terminal` (port of command_policy.py).
 *
 * The command is parsed with PowerShell's own AST parser (no regex guessing), then:
 *  1. Every invoked command must be on the allowlist (aliases are normalized).
 *  2. Dynamic invocation (`& $x`, `& { }`, `iex`, script files not on the list) is rejected.
 *  3. Literal path arguments / redirections (and $env:X / $HOME paths that can be resolved statically) must resolve inside
 *     the allowed directories and may not name a secret file (.env, token store).
 *  4. File-mutating cmdlets only accept literal arguments, so paths cannot hide in variables or `$env:`.
 *  5. Static .NET calls are rejected unless the type is harmless.
 *  6. Dangerous instance methods (.Delete(), .MoveTo(), .Kill(), ...) are rejected.
 *
 * LIMITATION: allowlisted interpreters (python, node, git ...) can still run arbitrary code
 * (`python -c "..."`). This policy blocks accidental/obvious damage; real isolation needs an OS-level
 * boundary (separate low-privilege account, sandbox, VM).
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { expandPath } from "../core/config.js";
export class CommandPolicyError extends Error {
}
const set = (...xs) => new Set(xs);
export const DEFAULT_ALLOWED_COMMANDS = set(
// developer tools / interpreters
"python", "py", "pythonw", "uv", "uvx", "pip", "pytest", "git", "node", "npm", "npx", "pnpm", "tsc", "tsx", "vitest", "dotnet", "code", "ruff", "black", "mypy", 
// enterprise & cloud clis / kubernetes
"kubectl", "helm", "az", "pac", "sas-viya", "winget", 
// shell & utilities
"sh", "bash", "openssl", "curl", "tar", 
// read-only / formatting cmdlets
"get-childitem", "get-content", "get-item", "get-itemproperty", "get-location", "test-path", "resolve-path", "split-path", "join-path", "select-object", "select-string", "where-object", "foreach-object", "sort-object", "group-object", "measure-object", "compare-object", "format-table", "format-list", "format-wide", "out-string", "out-null", "out-host", "write-output", "write-host", "write-error", "write-warning", "convertto-json", "convertfrom-json", "convertto-csv", "convertfrom-csv", "import-csv", "get-date", "get-process", "get-command", "get-filehash", "get-nettcpconnection", "start-sleep", "get-member", "get-help", "new-timespan", "get-random", "get-unique", 
// file-mutating cmdlets (literal, sandboxed paths only - see MUTATING_COMMANDS)
"set-location", "push-location", "pop-location", "new-item", "copy-item", "move-item", "rename-item", "remove-item", "set-content", "add-content", "clear-content", "out-file", "tee-object", "expand-archive", "compress-archive", "export-csv");
/** Cmdlets whose non-switch arguments must all be literal strings resolving inside the sandbox. */
const MUTATING_COMMANDS = set("set-location", "push-location", "new-item", "copy-item", "move-item", "rename-item", "remove-item", "set-content", "add-content", "clear-content", "out-file", "tee-object", "expand-archive", "compress-archive", "export-csv");
const LOCATION_COMMANDS = set("set-location", "push-location");
const ALIASES = {
    ls: "get-childitem", dir: "get-childitem", gci: "get-childitem",
    cat: "get-content", type: "get-content", gc: "get-content",
    gi: "get-item", gp: "get-itemproperty",
    cd: "set-location", sl: "set-location", chdir: "set-location",
    pushd: "push-location", popd: "pop-location",
    pwd: "get-location", gl: "get-location",
    cp: "copy-item", copy: "copy-item", cpi: "copy-item",
    mv: "move-item", move: "move-item", mi: "move-item",
    rm: "remove-item", del: "remove-item", erase: "remove-item", ri: "remove-item",
    rmdir: "remove-item", rd: "remove-item",
    ni: "new-item", mkdir: "new-item", md: "new-item",
    ren: "rename-item", rni: "rename-item",
    echo: "write-output", write: "write-output",
    select: "select-object", sls: "select-string",
    where: "where-object", "?": "where-object",
    foreach: "foreach-object", "%": "foreach-object",
    sort: "sort-object", group: "group-object", measure: "measure-object",
    diff: "compare-object", compare: "compare-object",
    ft: "format-table", fl: "format-list", fw: "format-wide",
    sleep: "start-sleep", ps: "get-process", gps: "get-process",
    gcm: "get-command", gm: "get-member", tee: "tee-object", ipcsv: "import-csv",
    epcsv: "export-csv", sc: "set-content", ac: "add-content", clc: "clear-content",
};
/** Commands that launch another program: the launched target must also be allowlisted. */
const LAUNCHERS = { uv: set("run"), uvx: set(), npx: set(), npm: set("exec", "x") };
const SAFE_STATIC_TYPES = set("math", "system.math", "string", "system.string", "datetime", "system.datetime", "convert", "system.convert", "guid", "system.guid", "timespan", "system.timespan", "regex", "system.text.regularexpressions.regex", "io.path", "system.io.path", "text.encoding", "system.text.encoding", "int", "int32", "int64", "long", "double", "decimal", "bool", "char", "system.int32", "system.int64", "system.double");
const DANGEROUS_METHODS = set("delete", "moveto", "copyto", "create", "createsubdirectory", "createtext", "appendtext", "openwrite", "writealltext", "writealllines", "writeallbytes", "appendalltext", "appendalllines", "encrypt", "decrypt", "kill", "start", "invoke", "invokescript", "setvalue", "setaccesscontrol", "deletesubkey", "deletesubkeytree", "deletevalue", "createsubkey", "downloadfile", "downloadstring", "uploadfile", "uploadstring");
const EXE_SUFFIXES = [".exe", ".cmd", ".bat", ".com"];
/** PowerShell AST dumper, passed via -EncodedCommand to avoid execution-policy / quoting issues. */
const PS_DUMP = String.raw `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$src = [Environment]::GetEnvironmentVariable('PCMCP_CMD')
$tokens = $null; $errs = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($src, [ref]$tokens, [ref]$errs)

function Conv($e) {
  if ($e -is [System.Management.Automation.Language.StringConstantExpressionAst]) { return ,@(@{k='lit'; v=$e.Value}) }
  if ($e -is [System.Management.Automation.Language.ConstantExpressionAst]) { return ,@(@{k='lit'; v=[string]$e.Value}) }
  if ($e -is [System.Management.Automation.Language.ArrayLiteralAst]) {
    $r = @(); foreach ($x in $e.Elements) { $r += Conv $x }; return ,$r
  }
  if ($e -is [System.Management.Automation.Language.ScriptBlockExpressionAst]) { return ,@(@{k='sb'; v=''}) }
  return ,@(@{k='dyn'; v=$e.Extent.Text})
}

$out = [ordered]@{ errors = @(); nodes = @() }
foreach ($er in $errs) { $out.errors += $er.Message }

$all = $ast.FindAll({ param($a)
  $a -is [System.Management.Automation.Language.PipelineAst] -or
  $a -is [System.Management.Automation.Language.FileRedirectionAst] -or
  $a -is [System.Management.Automation.Language.InvokeMemberExpressionAst] }, $true)

foreach ($n in $all) {
  if ($n -is [System.Management.Automation.Language.PipelineAst]) {
    $els = @()
    foreach ($pe in $n.PipelineElements) {
      if ($pe -is [System.Management.Automation.Language.CommandAst]) {
        $items = @()
        $first = $true
        foreach ($ce in $pe.CommandElements) {
          if ($first) { $first = $false; continue }
          if ($ce -is [System.Management.Automation.Language.CommandParameterAst]) {
            $items += ,@{k='param'; v=$ce.ParameterName}
            if ($ce.Argument) { $items += Conv $ce.Argument }
          } else { $items += Conv $ce }
        }
        $els += ,@{ t='cmd'; name=$pe.GetCommandName(); op=$pe.InvocationOperator.ToString(); args=$items }
      } else {
        $els += ,@{ t='expr'; text=$pe.Extent.Text }
      }
    }
    $out.nodes += ,@{ t='pipeline'; elements=$els }
  }
  elseif ($n -is [System.Management.Automation.Language.FileRedirectionAst]) {
    $loc = Conv $n.Location
    $out.nodes += ,@{ t='redirect'; target=$loc }
  }
  else {
    $member = if ($n.Member -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $n.Member.Value } else { $n.Member.Extent.Text }
    $type = ''
    if ($n.Static -and $n.Expression -is [System.Management.Automation.Language.TypeExpressionAst]) { $type = $n.Expression.TypeName.FullName }
    $out.nodes += ,@{ t='member'; static=[bool]$n.Static; type=$type; member=$member; text=$n.Extent.Text }
  }
}
$out | ConvertTo-Json -Depth 12 -Compress
`;
const ENCODED_PS_DUMP = Buffer.from(PS_DUMP, "utf16le").toString("base64");
/** Windows ships PowerShell 5.1; macOS/Linux need `pwsh` installed. */
export const psExecutable = () => (process.platform === "win32" ? "powershell" : "pwsh");
const cache = new Map();
/** PowerShell's ConvertTo-Json unrolls single-element arrays in some versions; normalize defensively. */
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
function normalizeParsed(raw) {
    return {
        errors: arr(raw?.errors),
        nodes: arr(raw?.nodes).map((n) => ({
            ...n,
            target: arr(n.target),
            elements: arr(n.elements).map((e) => ({ ...e, args: arr(e.args) })),
        })),
    };
}
/** Parse a PowerShell command into a simplified AST using PowerShell itself. Fails closed. */
export function parsePowerShell(command, timeoutMs = 20000) {
    const hit = cache.get(command);
    if (hit)
        return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
        execFile(psExecutable(), ["-NoProfile", "-NonInteractive", "-EncodedCommand", ENCODED_PS_DUMP], { env: { ...process.env, PCMCP_CMD: command }, timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
            if (err && err.code === "ENOENT") {
                return reject(new CommandPolicyError(`${psExecutable()} is not installed, so commands cannot be checked; run_terminal is unavailable.`));
            }
            if (err || !stdout.trim()) {
                return reject(new CommandPolicyError(`Could not parse command safely: ${String(stderr || err?.message || "").trim().slice(0, 300)}`));
            }
            try {
                const parsed = normalizeParsed(JSON.parse(stdout));
                if (cache.size >= 256)
                    cache.delete(cache.keys().next().value);
                cache.set(command, parsed);
                resolve(parsed);
            }
            catch (e) {
                reject(new CommandPolicyError(`Could not parse command safely: ${e.message}`));
            }
        });
    });
}
// ---- path logic ------------------------------------------------------------------------------
const isWin = () => process.platform === "win32";
const DRIVE_RE = /^[A-Za-z]:/;
const PROVIDER_RE = /^(microsoft\.powershell\.core\\)?(registry|hklm|hkcu|hkcr|hku|hkcc|env|cert|function|variable|alias|wsman)::?/i;
const DOTDOT_RE = /(^|[\\/])\.\.([\\/]|$)/;
/** Heuristic for non-mutating commands: absolute, UNC, home or parent-relative paths. */
function looksLikePath(v) {
    if (isWin())
        return DRIVE_RE.test(v) || v.startsWith("\\\\") || v.startsWith("//") || v.startsWith("~") || DOTDOT_RE.test(v);
    return v.startsWith("/") || v.startsWith("~") || DOTDOT_RE.test(v);
}
function resolveArg(v, cwd, home) {
    try {
        let e = expandPath(v, home, process.env);
        if (isWin()) {
            if (DRIVE_RE.test(e) && !/^[A-Za-z]:[\\/]/.test(e))
                e = `${e.slice(0, 2)}\\${e.slice(2)}`; // 'C:foo' -> 'C:\foo' (conservative)
            if (/^[\\/]/.test(e) && !/^(\\\\|\/\/)/.test(e))
                e = path.parse(cwd).root + e.replace(/^[\\/]+/, ""); // drive-rooted '\foo'
        }
        return path.resolve(cwd, e);
    }
    catch {
        return null;
    }
}
function normalizeName(name) {
    const raw = name.trim().replace(/^['"]+|['"]+$/g, "");
    const hadPath = /[\\/]/.test(raw);
    let base = (raw.split(/[\\/]/).pop() ?? "").toLowerCase();
    for (const suf of EXE_SUFFIXES) {
        if (base.endsWith(suf)) {
            base = base.slice(0, -suf.length);
            break;
        }
    }
    return { name: ALIASES[base] ?? base, hadPath };
}
/**
 * The value of a command argument when it can be known without running anything: quotes removed and $env:NAME / $HOME filled in.
 * null when anything else is left ($x, $(...), backtick escapes), because then the real path is only known at run time.
 */
function staticValue(text, home) {
    let s = text.trim();
    if (s.length >= 2 && s[0] === '"' && s.endsWith('"'))
        s = s.slice(1, -1);
    s = s
        .replace(/\$\{?env:(\w+)\}?/gi, (m, n) => process.env[n] ?? m)
        .replace(/\$\{?home\}?(?![\w:])/gi, () => home)
        // PowerShell accepts `\` as a separator; on POSIX it is an ordinary character, so a statically known
        // value containing one would be judged as a different file (and a secret would slip through). Judge it
        // the way Windows PowerShell would: fail closed. On Windows this changes nothing (`/` already works there).
        .replace(/\\/g, "/");
    return /[$`(]/.test(s) ? null : s;
}
/** Throws CommandPolicyError if the command is not allowed. */
export async function checkCommand(command, cwd, deps, allowedCommands = DEFAULT_ALLOWED_COMMANDS, parsed) {
    const ast = parsed ?? (await parsePowerShell(command));
    if (ast.errors.length)
        throw new CommandPolicyError(`PowerShell parse error: ${ast.errors[0]}`);
    let currentDir = cwd;
    const checkPath = (value, ctx, strict = false) => {
        if (PROVIDER_RE.test(value)) {
            if (strict)
                throw new CommandPolicyError(`${ctx}: non-filesystem provider path not allowed: '${value}'`);
            return;
        }
        if (!(looksLikePath(value) || strict)) {
            // a plain relative name such as `data/.env` is not "path-like", but it must still not name a secret file
            const rel = resolveArg(value, currentDir, deps.home);
            if (rel !== null && deps.isSecret?.(rel))
                throw new CommandPolicyError(`${ctx}: '${rel}' is a protected Jarvis secret file`);
            return;
        }
        const target = resolveArg(value, currentDir, deps.home);
        if (target === null) {
            if (strict)
                throw new CommandPolicyError(`${ctx}: could not resolve path '${value}'`);
            return;
        }
        if (!deps.isAllowed(target))
            throw new CommandPolicyError(`${ctx}: path outside allowed directories: '${target}'`);
        if (deps.isSecret?.(target))
            throw new CommandPolicyError(`${ctx}: '${target}' is a protected Jarvis secret file`);
        if (strict && deps.isProtected(target))
            throw new CommandPolicyError(`${ctx}: '${target}' is a protected Jarvis server file`);
    };
    for (const node of ast.nodes) {
        if (node.t === "member") {
            const member = String(node.member ?? "").toLowerCase();
            if (node.static && !SAFE_STATIC_TYPES.has(String(node.type ?? "").toLowerCase())) {
                throw new CommandPolicyError(`Static .NET call not allowed: ${node.text}`);
            }
            if (DANGEROUS_METHODS.has(member))
                throw new CommandPolicyError(`Method call not allowed: ${node.text}`);
            continue;
        }
        if (node.t === "redirect") {
            for (const tgt of node.target ?? []) {
                if (tgt.k !== "lit")
                    throw new CommandPolicyError("Redirection target must be a literal path");
                checkPath(tgt.v, "Redirection", true);
            }
            continue;
        }
        if (node.t !== "pipeline")
            continue;
        const elements = node.elements ?? [];
        const names = elements.filter((el) => el.t === "cmd" && el.name).map((el) => normalizeName(el.name).name);
        const pipelineMutates = names.some((n) => MUTATING_COMMANDS.has(n));
        elements.forEach((el, idx) => {
            if (el.t !== "cmd") {
                // Piping arbitrary objects (e.g. `$x | Remove-Item`) into a mutating cmdlet is blocked.
                if (pipelineMutates && idx === 0) {
                    throw new CommandPolicyError(`Piping an expression into a file-modifying command is not allowed: ${el.text}`);
                }
                return;
            }
            const rawName = el.name;
            if (!rawName)
                throw new CommandPolicyError("Dynamic command invocation (e.g. '& $var' or '& { }') is not allowed");
            const { name, hadPath } = normalizeName(rawName);
            if (!allowedCommands.has(name)) {
                throw new CommandPolicyError(`Command '${rawName}' is not on the allowlist (set PC_MCP_EXTRA_ALLOWED_COMMANDS to add)`);
            }
            const leaf = rawName.split(/[\\/]/).pop() ?? "";
            if (hadPath && leaf.includes(".") && !EXE_SUFFIXES.some((s) => rawName.toLowerCase().endsWith(s))) {
                throw new CommandPolicyError(`Running script files by path is not allowed: '${rawName}'`);
            }
            const args = el.args ?? [];
            const positional = args.filter((a) => a.k !== "param");
            const subs = LAUNCHERS[name];
            if (subs) {
                const lits = positional.filter((a) => a.k === "lit" && !a.v.startsWith("-")).map((a) => a.v);
                let target = "";
                if (subs.size) {
                    if (lits.length > 1 && subs.has(lits[0].toLowerCase()))
                        target = lits[1];
                }
                else if (lits.length)
                    target = lits[0];
                if (target) {
                    const tname = normalizeName(target).name;
                    if (!allowedCommands.has(tname) && !/\.(py|js|mjs|ts)$/i.test(target)) {
                        throw new CommandPolicyError(`'${rawName}' cannot launch non-allowlisted program '${target}'`);
                    }
                }
            }
            const mutating = MUTATING_COMMANDS.has(name) || pipelineMutates;
            for (const a of args) {
                if (a.k === "param")
                    continue;
                if (a.k === "lit")
                    checkPath(a.v, rawName, MUTATING_COMMANDS.has(name));
                else if (a.k === "dyn" && mutating) {
                    throw new CommandPolicyError(`'${rawName}' only accepts literal paths (variables/expressions are not allowed): ${a.v}`);
                }
                else if (a.k === "dyn") {
                    // "$env:USERPROFILE\.ssh\id_rsa" is a known path even though it is not a literal; anything truly dynamic is the documented limit
                    const known = staticValue(a.v, deps.home);
                    if (known !== null)
                        checkPath(known, rawName);
                }
                else if (a.k === "sb" && MUTATING_COMMANDS.has(name)) {
                    throw new CommandPolicyError(`'${rawName}' does not accept script block arguments`);
                }
            }
            if (LOCATION_COMMANDS.has(name)) {
                const lit = positional.find((a) => a.k === "lit");
                if (lit)
                    currentDir = resolveArg(lit.v, currentDir, deps.home) ?? currentDir;
            }
        });
    }
}
