import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Parse CLI args: --port=X --log-dir=X --proxy-key=X --proxy-keys-file=X (override env vars)
const cliArgs = {};
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--([^=]+)=(.*)$/);
  if (m) cliArgs[m[1]] = m[2];
}

const HOST = process.env.BRIDGE_HOST || "127.0.0.1";
const BRIDGE_PORT = Number(cliArgs.port || process.env.BRIDGE_PORT || 43119);
const MOCK_UPSTREAM_PORT = Number(process.env.MOCK_UPSTREAM_PORT || 43118);
const PROXY_KEY = cliArgs["proxy-key"] || process.env.PHASE1_PROXY_KEY || "phase1-proxy-key";
const PROXY_KEYS_FILE = cliArgs["proxy-keys-file"] || process.env.CODEX_BRIDGE_PROXY_KEYS_FILE || "";
const EXTRA_PROXY_KEYS = cliArgs["proxy-keys"] || process.env.CODEX_BRIDGE_PROXY_KEYS || "";
const UPSTREAM_MODE = (process.env.UPSTREAM_MODE || "deepseek").toLowerCase();
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const LOG_DIR = path.resolve(cliArgs["log-dir"] || process.env.PHASE_LOG_DIR || "sandbox/phase1/logs");
const TRACE_DIR = path.resolve(process.env.PHASE_TRACE_DIR || path.join(LOG_DIR, "traces"));
const BRIDGE_LOG = path.join(LOG_DIR, "bridge.log");
const MOCK_LOG = path.join(LOG_DIR, "mock-upstream.log");
const TRACE_LOG = path.join(TRACE_DIR, "bridge-trace.jsonl");
const TRACE_ENABLED = !/^(0|false|off)$/i.test(process.env.BRIDGE_TRACE_ENABLED || "1");
const BRIDGE_MAX_REQUEST_BYTES = Number(process.env.BRIDGE_MAX_REQUEST_BYTES || 0);
const UPSTREAM_RETRY_COUNT = Number(process.env.UPSTREAM_RETRY_COUNT || 0);
const UPSTREAM_RETRY_DELAY_MS = Number(process.env.UPSTREAM_RETRY_DELAY_MS || 250);
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 0);
const MOCK_FAULT = (process.env.MOCK_FAULT || "").toLowerCase();
const MOCK_FAULT_ONCE = (process.env.MOCK_FAULT_ONCE || "").toLowerCase();
const MOCK_FINAL_TEXT = process.env.MOCK_FINAL_TEXT || "CODEX_DEEPSEEK_PHASE1_DONE";
const MOCK_LONG_TEXT_LENGTH = Number(process.env.MOCK_LONG_TEXT_LENGTH || 0);

fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(TRACE_DIR, { recursive: true });

const clientState = new Map();
const staticAuthClients = buildStaticAuthClients();
let fileAuthCache = { mtimeMs: -1, clients: [] };

function nowIso() {
  return new Date().toISOString();
}

function appendLog(file, message, data) {
  const suffix = data === undefined ? "" : ` ${redact(JSON.stringify(data))}`;
  fs.appendFileSync(file, `[${nowIso()}] ${message}${suffix}\n`, "utf8");
}

function bridgeLog(message, data) {
  appendLog(BRIDGE_LOG, message, data);
  console.log(`[bridge] ${message}`);
}

function mockLog(message, data) {
  appendLog(MOCK_LOG, message, data);
  console.log(`[mock] ${message}`);
}

function traceLog(event, data = {}) {
  if (!TRACE_ENABLED) return;
  const entry = {
    time: nowIso(),
    event,
    ...data,
  };
  fs.appendFileSync(TRACE_LOG, `${redact(JSON.stringify(entry))}\n`, "utf8");
}

function redact(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <REDACTED>")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-<REDACTED>")
    .replace(/("?(?:api[_-]?key|token|secret|authorization)"?\s*:\s*)"[^"]+"/gi, "$1\"<REDACTED>\"");
}

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (BRIDGE_MAX_REQUEST_BYTES > 0 && total > BRIDGE_MAX_REQUEST_BYTES) {
      const error = new Error(`Request body exceeds BRIDGE_MAX_REQUEST_BYTES=${BRIDGE_MAX_REQUEST_BYTES}`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function hashToken(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function safeClientId(value, fallback) {
  const raw = String(value || fallback || "client");
  return raw.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 96) || fallback || "client";
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function clientFromKey(id, key) {
  if (!key) return null;
  const keyHash = hashToken(key);
  return {
    id: safeClientId(id, `client_${keyHash.slice(0, 12)}`),
    key,
    keyHash,
  };
}

function buildStaticAuthClients() {
  const clients = [];
  const primary = clientFromKey("default", PROXY_KEY);
  if (primary) clients.push(primary);

  for (const key of String(EXTRA_PROXY_KEYS || "").split(/[,\r\n]+/).map((item) => item.trim()).filter(Boolean)) {
    const client = clientFromKey(`client_${hashToken(key).slice(0, 12)}`, key);
    if (client && !clients.some((existing) => existing.keyHash === client.keyHash)) clients.push(client);
  }
  return clients;
}

function loadAuthClientsFromFile() {
  if (!PROXY_KEYS_FILE) return [];
  try {
    if (!fs.existsSync(PROXY_KEYS_FILE)) {
      fileAuthCache = { mtimeMs: -1, clients: [] };
      return [];
    }
    const stat = fs.statSync(PROXY_KEYS_FILE);
    if (fileAuthCache.mtimeMs === stat.mtimeMs) return fileAuthCache.clients;

    const raw = fs.readFileSync(PROXY_KEYS_FILE, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    const clients = [];
    if (Array.isArray(parsed?.clients)) {
      for (const entry of parsed.clients) {
        const client = clientFromKey(entry.id || entry.name || "", entry.key || entry.proxyKey);
        if (client) clients.push(client);
      }
    }
    if (Array.isArray(parsed?.keys)) {
      for (const key of parsed.keys) {
        const client = clientFromKey(`client_${hashToken(key).slice(0, 12)}`, key);
        if (client) clients.push(client);
      }
    }

    fileAuthCache = { mtimeMs: stat.mtimeMs, clients };
    return clients;
  } catch (error) {
    bridgeLog("proxy key registry reload failed", { error: error.message });
    fileAuthCache = { mtimeMs: -1, clients: [] };
    return [];
  }
}

function allAuthClients() {
  const out = [];
  const seen = new Set();
  for (const client of [...loadAuthClientsFromFile(), ...staticAuthClients]) {
    if (!client?.key || seen.has(client.keyHash)) continue;
    seen.add(client.keyHash);
    out.push(client);
  }
  return out;
}

function authorizedClient(req) {
  const auth = req.headers.authorization || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1];
  for (const client of allAuthClients()) {
    if (timingSafeEqualString(token, client.key)) {
      return { id: client.id, keyHash: client.keyHash.slice(0, 16) };
    }
  }
  return null;
}

function requireAuth(req, res) {
  const client = authorizedClient(req);
  if (client) return client;
  sendJson(res, 401, { error: { message: "Unauthorized" } });
  return null;
}

function phase1Models() {
  return {
    object: "list",
    data: [
      {
        id: "deepseek-v4-pro",
        object: "model",
        created: 0,
        owned_by: "phase1-bridge",
      },
      {
        id: "deepseek-v4-flash",
        object: "model",
        created: 0,
        owned_by: "phase1-bridge",
      },
    ],
  };
}

function normalizeInputToArray(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === "string") {
    return [{ type: "message", role: "user", content: [{ type: "input_text", text: input }] }];
  }
  return [];
}

function stateForClient(client) {
  const clientId = client?.id || "anonymous";
  let state = clientState.get(clientId);
  if (!state) {
    state = { responses: new Map(), reasoningByCallId: new Map() };
    clientState.set(clientId, state);
  }
  return state;
}

function storeResponse(client, responseId, entry) {
  if (!responseId) return;
  const state = stateForClient(client);
  state.responses.set(responseId, { ...entry, storedAt: Date.now() });
  if (state.responses.size > 200) {
    const oldest = state.responses.keys().next().value;
    state.responses.delete(oldest);
  }
  for (const output of entry.output || []) {
    if (
      (output.type === "function_call" || output.type === "custom_tool_call") &&
      output.call_id &&
      entry.reasoningContent
    ) {
      state.reasoningByCallId.set(output.call_id, entry.reasoningContent);
    }
  }
}

function resolveResponseChain(client, previousResponseId) {
  const items = [];
  const seen = new Set();
  let id = previousResponseId;
  const chain = [];
  const state = stateForClient(client);
  while (id && !seen.has(id)) {
    seen.add(id);
    const entry = state.responses.get(id);
    if (!entry) break;
    chain.unshift(entry);
    id = entry.previousResponseId;
  }
  for (const entry of chain) {
    if (Array.isArray(entry.input)) items.push(...entry.input);
    if (Array.isArray(entry.output)) items.push(...entry.output);
  }
  return items;
}

function inputItemsForTranslation(body, client) {
  const current = normalizeInputToArray(body.input);
  if (!body.previous_response_id) return current;
  const previous = resolveResponseChain(client, body.previous_response_id);
  if (previous.length === 0) return current;
  return [...previous, ...current];
}

function contentToChat(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (block.type === "input_text" || block.type === "output_text") {
      parts.push({ type: "text", text: block.text || "" });
    } else if (block.type === "input_image") {
      parts.push({ type: "image_url", image_url: { url: block.image_url || block.url || "" } });
    }
  }
  if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
  return parts;
}

function normalizeMessages(messages) {
  const out = [];
  for (const message of messages) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.role === message.role &&
      message.role === "assistant" &&
      Array.isArray(prev.tool_calls) &&
      Array.isArray(message.tool_calls)
    ) {
      prev.tool_calls.push(...message.tool_calls);
      continue;
    }
    out.push(message);
  }

  const toolByCallId = new Map();
  const nonTool = [];
  for (const message of out) {
    if (message.role === "tool" && message.tool_call_id) {
      toolByCallId.set(message.tool_call_id, message);
    } else {
      nonTool.push(message);
    }
  }

  const ordered = [];
  for (const message of nonTool) {
    ordered.push(message);
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        const toolMessage = toolByCallId.get(call.id);
        if (toolMessage) ordered.push(toolMessage);
      }
    }
  }
  return ordered;
}

function toolName(tool) {
  return tool?.function?.name || tool?.name || "";
}

function sanitizeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function chatNameForNamespace(namespace, childName) {
  const safeNamespace = sanitizeName(namespace || "namespace");
  const safeChildName = sanitizeName(childName || "tool");
  return safeNamespace.startsWith("mcp__")
    ? `${safeNamespace}__${safeChildName}`
    : `mcp__${safeNamespace}__${safeChildName}`;
}

function summarizeResponsesTools(tools = []) {
  const summary = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object") continue;
    if (tool.type === "function") {
      summary.push({ type: "function", name: toolName(tool) });
      continue;
    }
    if (tool.type === "custom") {
      summary.push({ type: "custom", name: tool.name || "custom_tool" });
      continue;
    }
    if (tool.type === "namespace") {
      const namespace = tool.namespace || tool.name || "namespace";
      const children = tool.tools || tool.functions || [];
      summary.push({
        type: "namespace",
        namespace,
        names: children.map((child) => toolName(child)).filter(Boolean),
      });
      continue;
    }
    summary.push({ type: tool.type || "unknown", name: toolName(tool) });
  }
  return summary;
}

function summarizeChatTools(tools = []) {
  return tools.map((tool) => ({
    type: tool.type || "unknown",
    name: tool.function?.name || tool.name || "",
  }));
}

function summarizeMessages(messages = []) {
  return messages.map((message) => ({
    role: message.role,
    hasToolCalls: Array.isArray(message.tool_calls),
    toolCallNames: (message.tool_calls || []).map((call) => call.function?.name || ""),
    toolCallId: message.role === "tool" ? message.tool_call_id || null : undefined,
  }));
}

function summarizeToolContext(context) {
  return Array.from(context.entries()).map(([chatName, value]) => ({
    chatName,
    kind: value.kind,
    namespace: value.namespace || null,
    originalName: value.name || value.original?.name || value.original?.function?.name || null,
  }));
}

function convertTools(tools = []) {
  const chatTools = [];
  const context = new Map();

  for (const tool of tools) {
    if (!tool || typeof tool !== "object") continue;
    if (tool.type === "function") {
      const name = toolName(tool);
      if (!name) continue;
      const chatTool = tool.function
        ? tool
        : {
            type: "function",
            function: {
              name,
              description: tool.description || "",
              parameters: tool.parameters || { type: "object", properties: {} },
            },
          };
      chatTools.push(chatTool);
      context.set(name, { kind: "function", original: tool });
      continue;
    }

    if (tool.type === "custom") {
      const name = tool.name || "custom_tool";
      chatTools.push({
        type: "function",
        function: {
          name,
          description: tool.description || "Custom freeform tool",
          parameters: {
            type: "object",
            properties: { input: { type: "string" } },
            required: ["input"],
          },
        },
      });
      context.set(name, { kind: "custom", original: tool });
      continue;
    }

    if (tool.type === "namespace") {
      const namespace = tool.namespace || tool.name || "namespace";
      const children = tool.tools || tool.functions || [];
      for (const child of children) {
        const childName = toolName(child);
        if (!childName) continue;
        const flatName = chatNameForNamespace(namespace, childName);
        chatTools.push({
          type: "function",
          function: {
            name: flatName,
            description: child.description || "",
            parameters: child.parameters || child.function?.parameters || { type: "object", properties: {} },
          },
        });
        context.set(flatName, { kind: "namespace", namespace, name: childName, original: child });
      }
    }
  }

  return { chatTools, context };
}

function responsesToChatRequest(body, client) {
  const messages = [];
  if (body.instructions) {
    messages.push({ role: "system", content: String(body.instructions) });
  }

  let pendingToolCalls = [];
  const flushToolCalls = () => {
    if (pendingToolCalls.length === 0) return;
    const assistant = { role: "assistant", content: null, tool_calls: pendingToolCalls };
    const state = stateForClient(client);
    for (const call of pendingToolCalls) {
      const reasoning = state.reasoningByCallId.get(call.id);
      if (reasoning) {
        assistant.reasoning_content = reasoning;
        break;
      }
    }
    messages.push(assistant);
    pendingToolCalls = [];
  };

  for (const item of inputItemsForTranslation(body, client)) {
    const type = item?.type || (item?.role ? "message" : "");
    if (type === "message") {
      flushToolCalls();
      let role = item.role || "user";
      if (role === "developer") role = "system";
      messages.push({ role, content: contentToChat(item.content) });
    } else if (type === "function_call") {
      const name = item.namespace
        ? chatNameForNamespace(item.namespace, item.name)
        : item.name;
      pendingToolCalls.push({
        id: item.call_id || item.id || uid("call"),
        type: "function",
        function: {
          name,
          arguments: item.arguments || "{}",
        },
      });
    } else if (type === "function_call_output") {
      flushToolCalls();
      messages.push({
        role: "tool",
        tool_call_id: item.call_id,
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? ""),
      });
    } else if (type === "custom_tool_call") {
      pendingToolCalls.push({
        id: item.call_id || item.id || uid("call"),
        type: "function",
        function: {
          name: item.name,
          arguments: JSON.stringify({ input: item.input || "" }),
        },
      });
    } else if (type === "custom_tool_call_output") {
      flushToolCalls();
      messages.push({
        role: "tool",
        tool_call_id: item.call_id,
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? ""),
      });
    }
  }
  flushToolCalls();

  const { chatTools, context } = convertTools(body.tools || []);
  const chatReq = {
    model: body.model || "deepseek-v4-pro",
    messages: normalizeMessages(messages),
    stream: Boolean(body.stream),
  };

  if (chatTools.length > 0) chatReq.tools = chatTools;
  if (body.parallel_tool_calls !== undefined) chatReq.parallel_tool_calls = body.parallel_tool_calls;
  if (body.max_output_tokens !== undefined) chatReq.max_tokens = body.max_output_tokens;
  if (body.temperature !== undefined) chatReq.temperature = body.temperature;
  if (body.top_p !== undefined) chatReq.top_p = body.top_p;
  if (body.reasoning?.effort) {
    const effort = String(body.reasoning.effort).toLowerCase();
    if (effort === "none") {
      chatReq.thinking = { type: "disabled" };
    } else if (effort === "minimal") {
      chatReq.reasoning_effort = "low";
    } else {
      chatReq.reasoning_effort = effort;
    }
  }
  if (body.tool_choice !== undefined) chatReq.tool_choice = body.tool_choice;
  if (chatReq.stream) chatReq.stream_options = { include_usage: true };

  return { chatReq, toolContext: context };
}

function translateUsage(usage) {
  if (!usage) return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  return {
    input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
    output_tokens: usage.completion_tokens || usage.output_tokens || 0,
    total_tokens: usage.total_tokens || 0,
    input_tokens_details: {
      cached_tokens: usage.prompt_tokens_details?.cached_tokens || 0,
    },
    output_tokens_details: {
      reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens || 0,
    },
  };
}

function customInputFromChatArguments(argumentsText) {
  const raw = String(argumentsText || "");
  if (!raw.trim()) return "";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed === "object" && typeof parsed.input === "string") {
      return parsed.input;
    }
  } catch {
    return raw;
  }
  return raw;
}

function restoredToolContext(chatName, trace) {
  return trace?.toolContext?.get(chatName) || null;
}

function responseToolItemFromChatCall(call, trace, status = "completed", argumentsOverride = null) {
  const ctx = restoredToolContext(call.name, trace);
  const argumentsText = argumentsOverride ?? call.arguments ?? "{}";

  if (ctx?.kind === "namespace") {
    return {
      type: "function_call",
      id: call.itemId || uid("fc"),
      call_id: call.callId,
      namespace: ctx.namespace,
      name: ctx.name,
      arguments: argumentsText || "{}",
      status,
    };
  }

  if (ctx?.kind === "custom") {
    return {
      type: "custom_tool_call",
      id: call.itemId || uid("ctc"),
      call_id: call.callId,
      name: ctx.original?.name || call.name,
      input: customInputFromChatArguments(argumentsText),
      status,
    };
  }

  return {
    type: "function_call",
    id: call.itemId || uid("fc"),
    call_id: call.callId,
    name: call.name,
    arguments: argumentsText || "{}",
    status,
  };
}

function isCustomResponseToolCall(call, trace) {
  return restoredToolContext(call.name, trace)?.kind === "custom";
}

function summarizeResponseToolCallItem(item) {
  if (item.type === "custom_tool_call") {
    return {
      type: item.type,
      name: item.name,
      callId: item.call_id,
      inputLength: String(item.input || "").length,
    };
  }
  return {
    type: item.type,
    namespace: item.namespace || null,
    name: item.name,
    callId: item.call_id,
    argumentsLength: String(item.arguments || "").length,
  };
}

function baseResponse(responseId, model, previousResponseId, metadata, status = "in_progress") {
  return {
    id: responseId,
    object: "response",
    created_at: unixNow(),
    status,
    background: false,
    error: null,
    model,
    output: [],
    previous_response_id: previousResponseId || null,
    metadata: metadata || {},
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  };
}

function sse(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function responseFailedEvent(responseId, model, errorMessage) {
  const response = baseResponse(responseId, model, null, {}, "failed");
  response.error = { message: errorMessage };
  return sse("response.failed", { type: "response.failed", response });
}

function writeResponsesStart(res, responseId, model, previousResponseId, metadata) {
  const response = baseResponse(responseId, model, previousResponseId, metadata);
  res.write(sse("response.created", { type: "response.created", response }));
  res.write(sse("response.in_progress", { type: "response.in_progress", response }));
}

function completedEvent(responseId, model, output, usage, previousResponseId, metadata) {
  const response = baseResponse(responseId, model, previousResponseId, metadata, "completed");
  response.output = output;
  response.usage = translateUsage(usage);
  return sse("response.completed", { type: "response.completed", response });
}

async function pipeChatStreamToResponses(upstreamRes, clientRes, requestBody, trace, client) {
  const responseId = uid("resp");
  const model = requestBody.model || "deepseek-v4-pro";
  const previousResponseId = requestBody.previous_response_id || null;
  const metadata = requestBody.metadata || {};
  const output = [];
  const toolCalls = new Map();
  const messageState = { id: uid("msg"), outputIndex: null, text: "", added: false };
  let outputIndex = 0;
  let usage = null;
  let reasoningContent = "";
  let completed = false;

  clientRes.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  writeResponsesStart(clientRes, responseId, model, previousResponseId, metadata);

  const maybeEmitToolAdded = (call) => {
    if (call.added || !call.name) return;
    const item = responseToolItemFromChatCall(call, trace, "in_progress", "");
    clientRes.write(sse("response.output_item.added", {
      type: "response.output_item.added",
      output_index: call.outputIndex,
      item,
    }));
    call.added = true;
  };

  const finishTools = () => {
    for (const [, call] of toolCalls) {
      if (call.done) continue;
      maybeEmitToolAdded(call);
      const item = responseToolItemFromChatCall(call, trace, "completed");
      if (item.type === "function_call") {
        clientRes.write(sse("response.function_call_arguments.done", {
          type: "response.function_call_arguments.done",
          output_index: call.outputIndex,
          call_id: call.callId,
          arguments: call.arguments,
        }));
      }
      clientRes.write(sse("response.output_item.done", {
        type: "response.output_item.done",
        output_index: call.outputIndex,
        item,
      }));
      output.push({ sortIndex: call.outputIndex, item });
      call.done = true;
    }
  };

  const finishMessage = () => {
    if (!messageState.added || messageState.done) return;
    const text = messageState.text;
    clientRes.write(sse("response.output_text.done", {
      type: "response.output_text.done",
      output_index: messageState.outputIndex,
      content_index: 0,
      text,
    }));
    const part = { type: "output_text", text, annotations: [] };
    clientRes.write(sse("response.content_part.done", {
      type: "response.content_part.done",
      output_index: messageState.outputIndex,
      content_index: 0,
      part,
    }));
    const item = {
      type: "message",
      id: messageState.id,
      status: "completed",
      role: "assistant",
      content: [part],
    };
    clientRes.write(sse("response.output_item.done", {
      type: "response.output_item.done",
      output_index: messageState.outputIndex,
      item,
    }));
    output.push({ sortIndex: messageState.outputIndex, item });
    messageState.done = true;
  };

  const finishResponse = () => {
    if (completed) return;
    completed = true;
    finishTools();
    finishMessage();
    const ordered = output.sort((a, b) => a.sortIndex - b.sortIndex).map((entry) => entry.item);
    clientRes.write(completedEvent(responseId, model, ordered, usage, previousResponseId, metadata));
    clientRes.end();
    storeResponse(client, responseId, {
      provider: UPSTREAM_MODE,
      input: normalizeInputToArray(requestBody.input),
      output: ordered,
      previousResponseId,
      reasoningContent,
    });
    traceLog("responses_completed", {
      traceId: trace.traceId,
      clientId: client?.id || null,
      responseId,
      outputTypes: ordered.map((item) => item.type),
      toolCalls: ordered
        .filter((item) => item.type === "function_call" || item.type === "custom_tool_call")
        .map(summarizeResponseToolCallItem),
      messageCount: ordered.filter((item) => item.type === "message").length,
      usage: translateUsage(usage),
    });
    bridgeLog("stored response", { clientId: client?.id || null, responseId, outputTypes: ordered.map((item) => item.type) });
  };

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for await (const chunk of upstreamRes.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === "[DONE]") {
          finishResponse();
          continue;
        }

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        if (parsed.usage) usage = parsed.usage;

        for (const choice of parsed.choices || []) {
          const delta = choice.delta || {};
          if (typeof delta.reasoning_content === "string") {
            reasoningContent += delta.reasoning_content;
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCalls.has(idx)) {
                const callId = tc.id || uid("call");
                const itemId = uid("fc");
                const call = {
                  itemId,
                  callId,
                  name: tc.function?.name || "",
                  arguments: "",
                  outputIndex: outputIndex++,
                  added: false,
                  done: false,
                };
                toolCalls.set(idx, call);
                traceLog("upstream_tool_call_started", {
                  traceId: trace.traceId,
                  responseId,
                  outputIndex: call.outputIndex,
                  callId,
                  name: call.name,
                });
              }
              const call = toolCalls.get(idx);
              if (tc.function?.name) call.name = tc.function.name;
              maybeEmitToolAdded(call);
              if (tc.function?.arguments) {
                call.arguments += tc.function.arguments;
                traceLog("upstream_tool_call_arguments_delta", {
                  traceId: trace.traceId,
                  responseId,
                  callId: call.callId,
                  name: call.name,
                  deltaLength: tc.function.arguments.length,
                  totalLength: call.arguments.length,
                });
                if (call.name && !isCustomResponseToolCall(call, trace)) {
                  clientRes.write(sse("response.function_call_arguments.delta", {
                    type: "response.function_call_arguments.delta",
                    output_index: call.outputIndex,
                    call_id: call.callId,
                    delta: tc.function.arguments,
                  }));
                }
              }
            }
          }

          if (typeof delta.content === "string" && delta.content.length > 0) {
            if (!messageState.added) {
              messageState.added = true;
              messageState.outputIndex = outputIndex++;
              clientRes.write(sse("response.output_item.added", {
                type: "response.output_item.added",
                output_index: messageState.outputIndex,
                item: {
                  type: "message",
                  id: messageState.id,
                  status: "in_progress",
                  role: "assistant",
                  content: [],
                },
              }));
              clientRes.write(sse("response.content_part.added", {
                type: "response.content_part.added",
                output_index: messageState.outputIndex,
                content_index: 0,
                part: { type: "output_text", text: "", annotations: [] },
              }));
            }
            messageState.text += delta.content;
            clientRes.write(sse("response.output_text.delta", {
              type: "response.output_text.delta",
              output_index: messageState.outputIndex,
              content_index: 0,
              delta: delta.content,
            }));
          }

          if (choice.finish_reason) {
            if (choice.finish_reason === "tool_calls") finishTools();
          }
        }
      }
    }
    if (!completed) finishResponse();
  } catch (error) {
    bridgeLog("stream translation failed", { error: error.message });
    if (!clientRes.destroyed && !completed) {
      clientRes.write(responseFailedEvent(responseId, model, error.message));
      clientRes.end();
    }
  }
}

async function chatCompletionToResponse(upstreamJson, requestBody, trace, client) {
  const responseId = uid("resp");
  const output = [];
  const choice = upstreamJson.choices?.[0];
  const message = choice?.message || {};
  const state = stateForClient(client);

  if (message.reasoning_content) {
    for (const toolCall of message.tool_calls || []) {
      state.reasoningByCallId.set(toolCall.id, message.reasoning_content);
    }
  }

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    for (const toolCall of message.tool_calls) {
      output.push(responseToolItemFromChatCall({
        itemId: uid("fc"),
        callId: toolCall.id,
        name: toolCall.function?.name || "",
        arguments: toolCall.function?.arguments || "{}",
      }, trace, "completed"));
    }
  } else if (message.content) {
    output.push({
      type: "message",
      id: uid("msg"),
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: message.content, annotations: [] }],
    });
  }

  const response = baseResponse(
    responseId,
    requestBody.model || upstreamJson.model || "deepseek-v4-pro",
    requestBody.previous_response_id || null,
    requestBody.metadata || {},
    "completed",
  );
  response.output = output;
  response.usage = translateUsage(upstreamJson.usage);

  storeResponse(client, responseId, {
    provider: UPSTREAM_MODE,
    input: normalizeInputToArray(requestBody.input),
    output,
    previousResponseId: requestBody.previous_response_id || null,
    reasoningContent: message.reasoning_content || "",
  });

  traceLog("responses_completed", {
    traceId: trace.traceId,
    clientId: client?.id || null,
    responseId,
    outputTypes: output.map((item) => item.type),
    toolCalls: output
      .filter((item) => item.type === "function_call" || item.type === "custom_tool_call")
      .map(summarizeResponseToolCallItem),
    messageCount: output.filter((item) => item.type === "message").length,
    usage: response.usage,
  });

  return response;
}

async function handleResponses(req, res) {
  const client = requireAuth(req, res);
  if (!client) return;
  const body = await readJson(req);
  const { chatReq, toolContext } = responsesToChatRequest(body, client);
  const trace = { traceId: body.metadata?.bridge_case_id || uid("trace"), toolContext, client };
  bridgeLog("received /v1/responses", {
    clientId: client.id,
    model: body.model,
    stream: Boolean(body.stream),
    inputShape: Array.isArray(body.input) ? `array:${body.input.length}` : typeof body.input,
    tools: Array.isArray(body.tools) ? body.tools.length : 0,
    previous_response_id: body.previous_response_id || null,
  });
  bridgeLog("translated responses -> chat", {
    messages: chatReq.messages.length,
    tools: chatReq.tools?.length || 0,
    roles: chatReq.messages.map((message) => `${message.role}${message.tool_calls ? "(tool_calls)" : ""}`),
  });
  traceLog("responses_request", {
    traceId: trace.traceId,
    clientId: client.id,
    model: body.model || null,
    stream: Boolean(body.stream),
    previousResponseId: body.previous_response_id || null,
    inputShape: Array.isArray(body.input) ? `array:${body.input.length}` : typeof body.input,
    inputTypes: normalizeInputToArray(body.input).map((item) => item.type || item.role || "unknown"),
    responsesTools: summarizeResponsesTools(body.tools || []),
    chatTools: summarizeChatTools(chatReq.tools || []),
    toolContext: summarizeToolContext(toolContext),
    messages: summarizeMessages(chatReq.messages),
  });

  const upstream = upstreamForMode();
  const upstreamRes = await fetchUpstreamWithRetry(upstream, chatReq, trace);

  if (!upstreamRes.ok) {
    const text = await upstreamRes.text();
    bridgeLog("upstream error", { status: upstreamRes.status, body: text.slice(0, 400) });
    sendJson(res, upstreamRes.status, {
      error: {
        message: `Upstream error ${upstreamRes.status}`,
        status: upstreamRes.status,
      },
    });
    return;
  }

  if (chatReq.stream) {
    await pipeChatStreamToResponses(upstreamRes, res, body, trace, client);
    return;
  }

  let upstreamJson;
  try {
    upstreamJson = await upstreamRes.json();
  } catch (error) {
    bridgeLog("upstream json parse failed", { error: error.message });
    sendJson(res, 502, { error: { message: "Upstream response was not valid JSON" } });
    return;
  }
  const response = await chatCompletionToResponse(upstreamJson, body, trace, client);
  bridgeLog("returned non-stream response", { id: response.id, outputTypes: response.output.map((item) => item.type) });
  sendJson(res, 200, response);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function fetchOnce(url, options) {
  if (!UPSTREAM_TIMEOUT_MS || UPSTREAM_TIMEOUT_MS <= 0) {
    return fetch(url, options);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchUpstreamWithRetry(upstream, chatReq, trace) {
  const body = JSON.stringify(chatReq);
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${upstream.key}`,
    },
    body,
  };

  let lastError = null;
  for (let attempt = 0; attempt <= UPSTREAM_RETRY_COUNT; attempt += 1) {
    try {
      const upstreamRes = await fetchOnce(upstream.url, options);
      if (!isRetryableStatus(upstreamRes.status) || attempt >= UPSTREAM_RETRY_COUNT) {
        if (attempt > 0) {
          traceLog("upstream_retry_completed", { traceId: trace.traceId, attempt, status: upstreamRes.status });
        }
        return upstreamRes;
      }

      bridgeLog("upstream retryable status", { attempt, status: upstreamRes.status });
      traceLog("upstream_retry_scheduled", { traceId: trace.traceId, attempt, status: upstreamRes.status });
      await upstreamRes.arrayBuffer().catch(() => null);
    } catch (error) {
      lastError = error;
      if (attempt >= UPSTREAM_RETRY_COUNT) {
        const mapped = new Error(error.name === "AbortError" ? "Upstream request timed out" : error.message);
        mapped.statusCode = error.name === "AbortError" ? 504 : 502;
        throw mapped;
      }
      bridgeLog("upstream retryable fetch error", { attempt, error: error.message });
      traceLog("upstream_retry_scheduled", { traceId: trace.traceId, attempt, error: error.message });
    }

    if (UPSTREAM_RETRY_DELAY_MS > 0) {
      await sleep(UPSTREAM_RETRY_DELAY_MS);
    }
  }

  throw lastError || new Error("Upstream request failed");
}

function upstreamForMode() {
  if (UPSTREAM_MODE === "deepseek") {
    if (!DEEPSEEK_API_KEY) {
      throw new Error("DEEPSEEK_API_KEY is required when UPSTREAM_MODE=deepseek");
    }
    return {
      url: `${DEEPSEEK_BASE_URL.replace(/\/$/, "")}/chat/completions`,
      key: DEEPSEEK_API_KEY,
    };
  }
  return {
    url: `http://127.0.0.1:${MOCK_UPSTREAM_PORT}/v1/chat/completions`,
    key: "mock-upstream-key",
  };
}

function createBridgeServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, {
          status: "ok",
          mode: UPSTREAM_MODE,
          upstream_base_url: DEEPSEEK_BASE_URL,
          registry_enabled: Boolean(PROXY_KEYS_FILE),
          uptime_sec: Math.floor((Date.now() - START_TIME) / 1000),
          trace_enabled: TRACE_ENABLED,
          max_request_bytes: BRIDGE_MAX_REQUEST_BYTES,
          retry_count: UPSTREAM_RETRY_COUNT,
          timeout_ms: UPSTREAM_TIMEOUT_MS,
          auth_clients: allAuthClients().length,
          active_clients: clientState.size,
        });
        return;
      }
      if (req.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/models")) {
        if (!requireAuth(req, res)) return;
        sendJson(res, 200, phase1Models());
        return;
      }
      if (req.method === "POST" && (url.pathname === "/v1/responses" || url.pathname === "/responses")) {
        await handleResponses(req, res);
        return;
      }
      sendJson(res, 404, { error: { message: "Not found" } });
    } catch (error) {
      bridgeLog("request failed", { error: error.message });
      sendJson(res, error.statusCode || 500, { error: { message: error.message } });
    }
  });
}

function hasToolMessage(messages = []) {
  return messages.some((message) => message.role === "tool");
}

function chooseMockTool(tools = []) {
  const candidates = tools
    .filter((tool) => tool.type === "function" && tool.function?.name)
    .map((tool) => tool.function);
  if (candidates.length === 0) return null;
  return (
    candidates.find((tool) => /shell|command|exec|terminal|run/i.test(tool.name)) ||
    candidates.find((tool) => !/apply_patch|patch/i.test(tool.name)) ||
    candidates[0]
  );
}

function argsForTool(tool) {
  const schema = tool?.parameters || {};
  const properties = schema.properties || {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const args = {};
  const commandText = "echo CODEX_DEEPSEEK_TOOL_OK";

  if (properties.command) args.command = commandText;
  if (properties.cmd) args.cmd = commandText;

  const names = required.length > 0 ? required : Object.keys(properties).slice(0, 1);
  for (const name of names) {
    if (args[name] !== undefined) continue;
    const prop = properties[name] || {};
    if (prop.type === "number" || prop.type === "integer") {
      args[name] = /timeout/i.test(name) ? 30000 : 1;
    } else if (prop.type === "boolean") {
      args[name] = false;
    } else if (prop.type === "array") {
      args[name] = [];
    } else if (prop.type === "object") {
      args[name] = {};
    } else {
      args[name] = /command|cmd|input|script/i.test(name) ? commandText : "CODEX_DEEPSEEK_TOOL_OK";
    }
  }

  if (Object.keys(args).length === 0) {
    args.input = commandText;
  }
  return JSON.stringify(args);
}

function chatResponseJson(model, message, finishReason = "stop") {
  return {
    id: uid("chatcmpl"),
    object: "chat.completion",
    created: unixNow(),
    model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 8,
      total_tokens: 28,
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

function writeChatSse(res, chunk) {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

const mockFaultCounts = new Map();

function nextMockFault() {
  if (MOCK_FAULT_ONCE) {
    const count = mockFaultCounts.get(MOCK_FAULT_ONCE) || 0;
    if (count === 0) {
      mockFaultCounts.set(MOCK_FAULT_ONCE, 1);
      return MOCK_FAULT_ONCE;
    }
  }
  return MOCK_FAULT;
}

function mockStatusFromFault(fault) {
  const match = String(fault || "").match(/^status[:=]?(\d{3})$|^(\d{3})$/);
  if (!match) return null;
  return Number(match[1] || match[2]);
}

function mockText() {
  if (MOCK_LONG_TEXT_LENGTH > 0) {
    return `${MOCK_FINAL_TEXT}\n${"A".repeat(MOCK_LONG_TEXT_LENGTH)}\nCODEX_DEEPSEEK_PHASE4_LONG_TEXT_END`;
  }
  return MOCK_FINAL_TEXT;
}

async function maybeHandleMockFault(fault, res, body, model) {
  if (!fault) return false;

  const status = mockStatusFromFault(fault);
  if (status) {
    sendJson(res, status, { error: { message: `mock upstream status ${status}` } });
    return true;
  }

  if (fault === "timeout") {
    await sleep(Number(process.env.MOCK_FAULT_TIMEOUT_MS || 5000));
    sendJson(res, 200, chatResponseJson(model, { role: "assistant", content: mockText() }, "stop"));
    return true;
  }

  if (fault === "malformed-json") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{ this is not valid json");
    return true;
  }

  if (fault === "stream-break") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    writeChatSse(res, {
      id: uid("chatcmpl"),
      object: "chat.completion.chunk",
      created: unixNow(),
      model,
      choices: [{ index: 0, delta: { role: "assistant", content: "CODEX_DEEPSEEK_PHASE4_STREAM_BREAK_PARTIAL" }, finish_reason: null }],
    });
    res.destroy();
    return true;
  }

  if (fault === "malformed-tool") {
    const tool = chooseMockTool(body.tools || []);
    if (!tool) {
      sendJson(res, 200, chatResponseJson(model, { role: "assistant", content: mockText() }, "stop"));
      return true;
    }
    sendJson(res, 200, chatResponseJson(model, {
      role: "assistant",
      content: null,
      tool_calls: [{
        id: uid("call"),
        type: "function",
        function: { name: tool.name, arguments: "{not-valid-json" },
      }],
    }, "tool_calls"));
    return true;
  }

  return false;
}

async function handleMockChat(req, res) {
  const body = await readJson(req);
  const model = body.model || "deepseek-v4-pro";
  const stream = Boolean(body.stream);
  const finalText = mockText();
  mockLog("received /v1/chat/completions", {
    stream,
    messages: body.messages?.length || 0,
    tools: body.tools?.length || 0,
    roles: (body.messages || []).map((message) => `${message.role}${message.tool_calls ? "(tool_calls)" : ""}`),
  });

  const fault = nextMockFault();
  if (await maybeHandleMockFault(fault, res, body, model)) {
    mockLog("returned injected fault", { fault });
    return;
  }

  if (hasToolMessage(body.messages)) {
    if (!stream) {
      sendJson(res, 200, chatResponseJson(model, { role: "assistant", content: finalText }, "stop"));
      return;
    }

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    writeChatSse(res, {
      id: uid("chatcmpl"),
      object: "chat.completion.chunk",
      created: unixNow(),
      model,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    });
    for (const part of ["CODEX_DEEPSEEK_", "PHASE1_", "DONE"]) {
      writeChatSse(res, {
        id: uid("chatcmpl"),
        object: "chat.completion.chunk",
        created: unixNow(),
        model,
        choices: [{ index: 0, delta: { content: part }, finish_reason: null }],
      });
    }
    writeChatSse(res, {
      id: uid("chatcmpl"),
      object: "chat.completion.chunk",
      created: unixNow(),
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
    });
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  const tool = chooseMockTool(body.tools || []);
  if (!tool) {
    const text = `No callable function tool was exposed. ${finalText}`;
    if (!stream) {
      sendJson(res, 200, chatResponseJson(model, { role: "assistant", content: text }, "stop"));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    writeChatSse(res, {
      id: uid("chatcmpl"),
      object: "chat.completion.chunk",
      created: unixNow(),
      model,
      choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
    });
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  const callId = uid("call");
  const args = argsForTool(tool);
  mockLog("returning tool_call", { tool: tool.name, args });

  if (!stream) {
    sendJson(res, 200, chatResponseJson(model, {
      role: "assistant",
      content: null,
      tool_calls: [{
        id: callId,
        type: "function",
        function: { name: tool.name, arguments: args },
      }],
      reasoning_content: "phase1 mock reasoning",
    }, "tool_calls"));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  writeChatSse(res, {
    id: uid("chatcmpl"),
    object: "chat.completion.chunk",
    created: unixNow(),
    model,
    choices: [{
      index: 0,
      delta: {
        role: "assistant",
        reasoning_content: "phase1 mock reasoning",
        tool_calls: [{
          index: 0,
          id: callId,
          type: "function",
          function: { name: tool.name, arguments: "" },
        }],
      },
      finish_reason: null,
    }],
  });

  const midpoint = Math.max(1, Math.floor(args.length / 2));
  for (const part of [args.slice(0, midpoint), args.slice(midpoint)]) {
    if (!part) continue;
    writeChatSse(res, {
      id: uid("chatcmpl"),
      object: "chat.completion.chunk",
      created: unixNow(),
      model,
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: part } }] },
        finish_reason: null,
      }],
    });
  }
  writeChatSse(res, {
    id: uid("chatcmpl"),
    object: "chat.completion.chunk",
    created: unixNow(),
    model,
    choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
  });
  res.write("data: [DONE]\n\n");
  res.end();
}

function createMockServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { status: "ok", mode: "mock" });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        await handleMockChat(req, res);
        return;
      }
      sendJson(res, 404, { error: { message: "Not found" } });
    } catch (error) {
      mockLog("request failed", { error: error.message });
      sendJson(res, 500, { error: { message: error.message } });
    }
  });
}

function listen(server, port, label) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => {
      server.off("error", reject);
      console.log(`${label} listening on http://${HOST}:${port}`);
      resolve();
    });
  });
}

const bridgeServer = createBridgeServer();
const servers = [bridgeServer];

if (UPSTREAM_MODE === "mock") {
  const mockServer = createMockServer();
  servers.push(mockServer);
  await listen(mockServer, MOCK_UPSTREAM_PORT, "mock upstream");
}

const START_TIME = Date.now();

await listen(bridgeServer, BRIDGE_PORT, "codex deepseek bridge");

bridgeLog("started", {
  bridge: `http://${HOST}:${BRIDGE_PORT}/v1`,
  upstreamMode: UPSTREAM_MODE,
  mock: UPSTREAM_MODE === "mock" ? `http://${HOST}:${MOCK_UPSTREAM_PORT}/v1` : null,
});

function gracefulShutdown() {
  console.log("Stopping Codex DeepSeek bridge");
  for (const server of servers) {
    server.close(() => {});
  }
  process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
