/** Carries the HTTP status the dashboard should answer with (the dashboard's error handler reads `status`). */
export class ToolsError extends Error {
    status = 503;
}
export async function listTools(port, apiKey) {
    if (!apiKey)
        throw new ToolsError("API Key가 아직 만들어지지 않았습니다. 엔진을 한 번 시작하세요.");
    let res;
    try {
        res = await fetch(`http://127.0.0.1:${port}/mcp`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-api-key": apiKey },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
            signal: AbortSignal.timeout(5000),
        });
    }
    catch {
        throw new ToolsError("엔진에 연결할 수 없습니다. 엔진이 실행 중인지 확인하세요.");
    }
    if (res.status === 401)
        throw new ToolsError("엔진이 이 API Key를 받아주지 않습니다. 엔진을 재시작해 보세요.");
    if (!res.ok)
        throw new ToolsError(`엔진이 도구 목록을 돌려주지 않았습니다 (HTTP ${res.status}).`);
    let tools;
    try {
        tools = (await res.json()).result?.tools ?? [];
    }
    catch {
        throw new ToolsError("엔진의 응답을 읽을 수 없습니다.");
    }
    return tools
        .map((t) => ({ name: t.name, description: (t.description ?? "").trim(), readonly: t.annotations?.idempotentHint === true && t.annotations.destructiveHint === false }))
        .sort((a, b) => a.name.localeCompare(b.name));
}
