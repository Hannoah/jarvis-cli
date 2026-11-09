// Example plugin for Jarvis. To add your own tools:
//  1. Put a .mjs file in ~/.jarvis/custom_tools/ (or $JARVIS_HOME/custom_tools/) that exports register(mcp, ctx).
//  2. Register tools with mcp.registerTool(...).
//  3. Restart Jarvis (`jarvis restart`).
// Plugins run with the server's full rights - only install code you trust. (The AI tools cannot write to this folder.)
import { z } from "zod";

// Recursive-descent evaluator: numbers, + - * / % **, unary minus, parentheses. No eval().
function evaluate(src) {
  const s = src.replace(/\s+/g, "");
  let i = 0;
  const peek = () => s[i];
  const num = () => {
    const m = /^\d+(\.\d+)?|^\.\d+/.exec(s.slice(i));
    if (!m) throw new Error(`Unexpected '${s[i] ?? "end"}' at ${i}`);
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const atom = () => {
    if (peek() === "(") {
      i++;
      const v = expr();
      if (peek() !== ")") throw new Error("Missing )");
      i++;
      return v;
    }
    if (peek() === "-") {
      i++;
      return -power();
    }
    if (peek() === "+") {
      i++;
      return power();
    }
    return num();
  };
  const power = () => {
    const base = atom();
    if (s.slice(i, i + 2) === "**") {
      i += 2;
      return base ** power();
    }
    return base;
  };
  const term = () => {
    let v = power();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      if (s.slice(i, i + 2) === "**") break;
      const op = s[i++];
      const r = power();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  };
  const expr = () => {
    let v = term();
    while (peek() === "+" || peek() === "-") v = s[i++] === "+" ? v + term() : v - term();
    return v;
  };
  const out = expr();
  if (i < s.length) throw new Error(`Unexpected '${s[i]}' at ${i}`);
  return out;
}

export function register(mcp) {
  mcp.registerTool(
    "calculate_expression",
    {
      description: "Safely evaluate simple arithmetic expressions (e.g. '128 * 4 + 50').",
      inputSchema: { expression: z.string().describe("Arithmetic expression to calculate.") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ expression }) => {
      let result;
      try {
        if (!/^[0-9+\-*/().% ]*$/.test(expression)) throw new Error("Invalid character in mathematical expression.");
        result = { expression, result: evaluate(expression) };
      } catch (e) {
        result = { error: `Evaluation error: ${e.message}` };
      }
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );
}
