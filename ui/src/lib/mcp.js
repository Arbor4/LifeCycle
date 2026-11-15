let seq = 0;

function parseBody(text, contentType) {
  if (!text.trim()) return null;
  if (contentType.includes("text/event-stream")) {
    for (const block of text.split("\n\n")) {
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("\n");
      if (!data) continue;
      try {
        return JSON.parse(data);
      } catch {
        // 继续找下一个事件块
      }
    }
    return null;
  }
  return JSON.parse(text);
}

async function rpc(endpoint, payload, sessionId, protocol) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  if (protocol) headers["mcp-protocol-version"] = protocol;
  const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
  const sid = res.headers.get("mcp-session-id");
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${text.slice(0, 180)}`);
  }
  return { sid, data: parseBody(text, res.headers.get("content-type") ?? "") };
}

/// 真实走一遍 MCP Streamable HTTP 握手，返回 AI 客户端此刻能看到的工具。
export async function probeMcp(endpoint) {
  const started = performance.now();
  const init = await rpc(endpoint, {
    jsonrpc: "2.0",
    id: ++seq,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "lifecycle-console", version: "0.1.0" },
    },
  });
  if (init.data?.error) throw new Error(init.data.error.message);
  const sessionId = init.sid;
  const protocol = init.data?.result?.protocolVersion ?? "2025-06-18";
  const serverInfo = init.data?.result?.serverInfo ?? {};

  await rpc(endpoint, { jsonrpc: "2.0", method: "notifications/initialized" }, sessionId, protocol);
  const list = await rpc(
    endpoint,
    { jsonrpc: "2.0", id: ++seq, method: "tools/list", params: {} },
    sessionId,
    protocol
  );
  if (list.data?.error) throw new Error(list.data.error.message);
  const tools = (list.data?.result?.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description ?? "",
  }));

  if (sessionId) {
    fetch(endpoint, {
      method: "DELETE",
      headers: { "mcp-session-id": sessionId, "mcp-protocol-version": protocol },
    }).catch(() => {});
  }
  return {
    ok: true,
    ms: Math.round(performance.now() - started),
    protocol,
    serverInfo,
    tools,
    at: Date.now(),
  };
}