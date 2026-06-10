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
const STATE_DIR = path.resolve(process.env.PHASE_STATE_DIR || path.join(LOG_DIR, "..", "state"));
const TRACE_DIR = path.resolve(process.env.PHASE_TRACE_DIR || path.join(LOG_DIR, "traces"));
const BRIDGE_LOG = path.join(LOG_DIR, "bridge.log");
const MOCK_LOG = path.join(LOG_DIR, "mock-upstream.log");
const REASONING_AUDIT_LOG = path.join(LOG_DIR, "reasoning-audit.jsonl");
const REASONING_AUDIT_TEXT_LOG = path.join(LOG_DIR, "reasoning-audit.log");
const REASONING_SUMMARY_JSON = path.join(LOG_DIR, "reasoning-summary.json");
const REASONING_DISPLAY = process.env.CODEX_DEEPSEEK_REASONING_DISPLAY || "summarize";
const REASONING_SUMMARY_MODEL = process.env.CODEX_DEEPSEEK_REASONING_SUMMARY_MODEL || "deepseek-v4-flash";
const REASONING_SUMMARY_TIMEOUT_MS = Number(process.env.CODEX_DEEPSEEK_REASONING_SUMMARY_TIMEOUT_MS || 8000);
const REASONING_SUMMARY_MAX_TOKENS = Number(process.env.CODEX_DEEPSEEK_REASONING_SUMMARY_MAX_TOKENS || 900);
const REASONING_SUMMARY_MAX_RAW_CHARS = Number(process.env.CODEX_DEEPSEEK_REASONING_SUMMARY_MAX_RAW_CHARS || 6000);
const REASONING_SUMMARY_MAX_TOOL_ARG_CHARS = Number(process.env.CODEX_DEEPSEEK_REASONING_SUMMARY_MAX_TOOL_ARG_CHARS || 300);
const REASONING_SUMMARY_THINKING = (process.env.CODEX_DEEPSEEK_REASONING_SUMMARY_THINKING || "enabled").trim().toLowerCase();
const REASONING_SUMMARY_REASONING_EFFORT = (process.env.CODEX_DEEPSEEK_REASONING_SUMMARY_REASONING_EFFORT || "medium").trim();
const TOOL_SUMMARY_SURFACE = (
  process.env.CODEX_DEEPSEEK_TOOL_SUMMARY_SURFACE ||
  "commentary"
).trim().toLowerCase();
const COMPACT_AUDIT_LOG = path.join(LOG_DIR, "compact-audit.jsonl");
const COMPACT_AUDIT_TEXT_LOG = path.join(LOG_DIR, "compact-audit.log");
const COMPACT_SUMMARY_JSON = path.join(LOG_DIR, "compact-summary.json");
const REASONING_STORE_FILE = path.join(STATE_DIR, "reasoning-store.jsonl");
const COMPACTION_STORE_FILE = path.join(STATE_DIR, "compaction-store.jsonl");
const TRACE_LOG = path.join(TRACE_DIR, "bridge-trace.jsonl");
const TRACE_ENABLED = !/^(0|false|off)$/i.test(process.env.BRIDGE_TRACE_ENABLED || "1");
const REASONING_SUMMARY_MODE = (
  process.env.CODEX_DEEPSEEK_REASONING_SUMMARY_MODE ||
  ""
).trim().toLowerCase();
const MOCK_REASONING_SUMMARY = process.env.CODEX_DEEPSEEK_MOCK_REASONING_SUMMARY ||
  `CODEX_DEEPSEEK_MOCK_SUMMARY_VISIBLE_BEFORE_TOOL_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
const BRIDGE_MAX_REQUEST_BYTES = Number(process.env.BRIDGE_MAX_REQUEST_BYTES || 0);
const UPSTREAM_RETRY_COUNT = Number(process.env.UPSTREAM_RETRY_COUNT || 0);
const UPSTREAM_RETRY_DELAY_MS = Number(process.env.UPSTREAM_RETRY_DELAY_MS || 250);
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 0);
const UPSTREAM_REASONING_REPAIR_RETRIES = Number(process.env.UPSTREAM_REASONING_REPAIR_RETRIES || 3);
const RESPONSE_STORE_MAX_RECORDS = Number(process.env.RESPONSE_STORE_MAX_RECORDS || 2000);
const TOOL_CALL_CACHE_MAX_RECORDS = Number(process.env.TOOL_CALL_CACHE_MAX_RECORDS || 512);
const REASONING_STORE_MAX_RECORDS = Number(process.env.REASONING_STORE_MAX_RECORDS || 10000);
const REASONING_STORE_MAX_BYTES = Number(process.env.REASONING_STORE_MAX_BYTES || 32 * 1024 * 1024);
const COMPACTION_STORE_MAX_RECORDS = Number(process.env.COMPACTION_STORE_MAX_RECORDS || 1000);
const COMPACTION_STORE_MAX_BYTES = Number(process.env.COMPACTION_STORE_MAX_BYTES || 32 * 1024 * 1024);
const BRIDGE_COMPACT_TRIGGER_TOKENS = Number(process.env.BRIDGE_COMPACT_TRIGGER_TOKENS || 950000);
const BRIDGE_COMPACT_TARGET_TOKENS = Number(process.env.BRIDGE_COMPACT_TARGET_TOKENS || 300000);
const BRIDGE_COMPACT_TAIL_TOKENS = Number(process.env.BRIDGE_COMPACT_TAIL_TOKENS || 150000);
const BRIDGE_COMPACT_CHARS_PER_TOKEN = Number(process.env.BRIDGE_COMPACT_CHARS_PER_TOKEN || 4);
const BRIDGE_COMPACT_MAX_TRANSCRIPT_CHARS = Number(process.env.BRIDGE_COMPACT_MAX_TRANSCRIPT_CHARS || 180000);
const MOCK_FAULT = (process.env.MOCK_FAULT || "").toLowerCase();
const MOCK_FAULT_ONCE = (process.env.MOCK_FAULT_ONCE || "").toLowerCase();
const MOCK_FINAL_TEXT = process.env.MOCK_FINAL_TEXT || "CODEX_DEEPSEEK_PHASE1_DONE";
const MOCK_LONG_TEXT_LENGTH = Number(process.env.MOCK_LONG_TEXT_LENGTH || 0);
const MOCK_PROMPT_TOKENS = Number(process.env.MOCK_PROMPT_TOKENS || 20);
const MOCK_COMPLETION_TOKENS = Number(process.env.MOCK_COMPLETION_TOKENS || 8);

fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(STATE_DIR, { recursive: true });
fs.mkdirSync(TRACE_DIR, { recursive: true });

const clientState = new Map();
const staticAuthClients = buildStaticAuthClients();
let fileAuthCache = { mtimeMs: -1, clients: [] };
const reasoningMetrics = {
  requests: 0,
  thinking_enabled: 0,
  thinking_disabled: 0,
  downgraded: 0,
  policies: {},
  clients: {},
  events: {},
  upstream_missing_reasoning: 0,
  upstream_repaired: 0,
  upstream_retried: 0,
  upstream_retry_recovered: 0,
  upstream_synthesized_after_retries: 0,
  codex_history_repaired: 0,
  codex_missing_reasoning_total: 0,
  deepseek_missing_reasoning_total: 0,
  last_request: null,
  last_downgrade: null,
};
const compactMetrics = {
  preflight_checked: 0,
  preflight_skipped: 0,
  preflight_created: 0,
  endpoint_requests: 0,
  endpoint_created: 0,
  active_chain_replacements: 0,
  resolved: 0,
  unknown_external: 0,
  missing_store: 0,
  summary_failed: 0,
  events: {},
  last_compact: null,
  last_usage: null,
};
const completionMetrics = {
  responses: 0,
  terminal_kinds: {},
  last: null,
};
const BRIDGE_DIAGNOSTIC_PREFIX = "[Codex DeepSeek Bridge]";
const BRIDGE_COMPACTION_PREFIX = "bridge_compaction_v1:";
const THINK_OPEN_TAG = "<think>";
const THINK_CLOSE_TAG = "</think>";
const CHAT_TOOL_NAME_MAX_LENGTH = 64;
const TOOL_SEARCH_PROXY_NAME = "tool_search";
const REASONING_REPAIR_INSTRUCTION =
  "Bridge protocol requirement: thinking mode is enabled. If you call any tool in this response, " +
  "the assistant tool-call turn must include a concise non-empty reasoning_content field. " +
  "Do not omit reasoning_content on tool-call turns.";
const clientMetadataById = new Map();
const traceClientByTraceId = new Map();

function nowIso() {
  return new Date().toISOString();
}

function normalizePathForKey(value) {
  return path.resolve(String(value || "")).toLowerCase();
}

function shortHash(value, length = 10) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function projectIdFromWorkDir(workDir, fallback) {
  const text = String(workDir || "").trim();
  if (!text) return safeClientId(fallback || "project", "project");
  const resolved = path.resolve(text);
  const base = safeClientId(path.basename(resolved) || "project", "project");
  return safeClientId(`${base}_${shortHash(resolved, 8)}`, "project");
}

function publicClientInfo(client) {
  if (!client) return null;
  return {
    id: client.id || null,
    keyHash: client.keyHash ? String(client.keyHash).slice(0, 16) : null,
    projectId: client.projectId || null,
    instanceId: client.instanceId || null,
    projectName: client.projectName || null,
    workDir: client.workDir || null,
    sandboxRoot: client.sandboxRoot || null,
    logDir: client.logDir || null,
    registeredAt: client.registeredAt || null,
    updatedAt: client.updatedAt || null,
  };
}

function rememberClient(client) {
  const info = publicClientInfo(client);
  if (!info?.id) return info;
  const previous = clientMetadataById.get(info.id) || {};
  clientMetadataById.set(info.id, { ...previous, ...Object.fromEntries(Object.entries(info).filter(([, value]) => value !== null && value !== undefined && value !== "")) });
  return clientMetadataById.get(info.id);
}

function rememberTraceClient(traceId, client) {
  if (!traceId || !client?.id) return;
  rememberClient(client);
  traceClientByTraceId.set(traceId, client.id);
  if (traceClientByTraceId.size > 10000) {
    const oldest = traceClientByTraceId.keys().next().value;
    traceClientByTraceId.delete(oldest);
  }
}

function enrichLogEntry(entry) {
  const traceClientId = entry.clientId || (entry.traceId ? traceClientByTraceId.get(entry.traceId) : null);
  const clientId = traceClientId || null;
  const meta = clientId ? clientMetadataById.get(clientId) : null;
  return {
    ...entry,
    ...(clientId && !entry.clientId ? { clientId } : {}),
    ...(meta?.projectId && !entry.projectId ? { projectId: meta.projectId } : {}),
    ...(meta?.instanceId && !entry.instanceId ? { instanceId: meta.instanceId } : {}),
    ...(meta?.projectName && !entry.projectName ? { projectName: meta.projectName } : {}),
    ...(meta?.workDir && !entry.workDir ? { workDir: meta.workDir } : {}),
  };
}

function clientScopedLogFiles(clientId, relativeFile) {
  const meta = clientId ? clientMetadataById.get(clientId) : null;
  if (!clientId || !relativeFile) return [];

  const safeId = safeClientId(clientId, "client");
  const projectId = safeClientId(meta?.projectId || "unknown_project", "unknown_project");
  const instanceId = safeClientId(meta?.instanceId || safeId, safeId);
  const roots = [LOG_DIR];
  if (meta?.logDir) roots.push(path.resolve(meta.logDir));

  const out = [];
  const seen = new Set();
  for (const root of roots) {
    const candidates = [
      path.join(root, "clients", safeId, relativeFile),
      path.join(root, "projects", projectId, relativeFile),
      path.join(root, "projects", projectId, "instances", instanceId, relativeFile),
    ];
    for (const candidate of candidates) {
      const key = normalizePathForKey(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(candidate);
    }
  }
  return out;
}

function appendClientScopedTextLog(clientId, relativeFile, line) {
  if (!clientId || !line) return;
  for (const file of clientScopedLogFiles(clientId, relativeFile)) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${redact(line)}\n`, "utf8");
    } catch (error) {
      fs.appendFileSync(BRIDGE_LOG, `[${nowIso()}] client scoped log write failed ${redact(JSON.stringify({ clientId, file, error: error.message }))}\n`, "utf8");
    }
  }
}

function appendLog(file, message, data) {
  const suffix = data === undefined ? "" : ` ${redact(JSON.stringify(data))}`;
  const line = `[${nowIso()}] ${message}${suffix}`;
  fs.appendFileSync(file, `${line}\n`, "utf8");
  return line;
}

function bridgeLog(message, data) {
  const scopedData = data && typeof data === "object" ? enrichLogEntry(data) : data;
  const line = appendLog(BRIDGE_LOG, message, scopedData);
  appendClientScopedTextLog(scopedData?.clientId, "bridge.log", line);
  console.log(`[bridge] ${message}`);
}

function mockLog(message, data) {
  appendLog(MOCK_LOG, message, data);
  console.log(`[mock] ${message}`);
}

function traceLog(event, data = {}) {
  if (!TRACE_ENABLED) return;
  const entry = enrichLogEntry({
    time: nowIso(),
    event,
    ...data,
  });
  const line = redact(JSON.stringify(entry));
  fs.appendFileSync(TRACE_LOG, `${line}\n`, "utf8");
  appendClientScopedTextLog(entry.clientId, path.join("traces", "bridge-trace.jsonl"), line);
}

function incrementCounter(target, key) {
  const safeKey = String(key || "unknown");
  target[safeKey] = (target[safeKey] || 0) + 1;
}

function responseMessageTextLength(item) {
  if (item?.type !== "message" || !Array.isArray(item.content)) return 0;
  return item.content.reduce((total, part) => total + String(part?.text || "").length, 0);
}

function isBridgeUiOnlyMessage(item) {
  return Boolean(
    item?.metadata?.bridge_ui_only ||
    item?.metadata?.bridge_tool_summary_commentary
  );
}

function responseOutputDiagnostics(output = [], finishReason = null) {
  const outputTypes = output.map((item) => item.type);
  const toolCalls = output
    .filter(isToolCallItem)
    .map(summarizeResponseToolCallItem);
  const messageCount = output.filter((item) => item.type === "message").length;
  const messageTextChars = output.reduce((total, item) => total + responseMessageTextLength(item), 0);
  const terminalKind = toolCalls.length > 0
    ? "tool_call"
    : messageCount > 0
      ? "message"
      : output.length > 0
        ? "non_tool_output"
        : "empty";
  return {
    finishReason: finishReason || null,
    terminalKind,
    outputTypes,
    toolCalls,
    messageCount,
    messageTextChars,
    messageOnly: terminalKind === "message",
  };
}

function recordCompletionDiagnostics(trace, client, responseId, diagnostics) {
  completionMetrics.responses += 1;
  incrementCounter(completionMetrics.terminal_kinds, diagnostics.terminalKind);
  completionMetrics.last = {
    time: nowIso(),
    traceId: trace?.traceId || null,
    clientId: client?.id || null,
    responseId,
    finishReason: diagnostics.finishReason || null,
    terminalKind: diagnostics.terminalKind,
    outputTypes: diagnostics.outputTypes,
    messageCount: diagnostics.messageCount,
    messageTextChars: diagnostics.messageTextChars,
    toolCalls: diagnostics.toolCalls,
  };
}

function writeReasoningSummary() {
  const summary = {
    updated_at: nowIso(),
    audit_log: REASONING_AUDIT_LOG,
    audit_text_log: REASONING_AUDIT_TEXT_LOG,
    summary_file: REASONING_SUMMARY_JSON,
    ...reasoningMetrics,
  };
  fs.writeFileSync(REASONING_SUMMARY_JSON, `${redact(JSON.stringify(summary, null, 2))}\n`, "utf8");
}

function writeCompactSummary() {
  const summary = {
    updated_at: nowIso(),
    audit_log: COMPACT_AUDIT_LOG,
    audit_text_log: COMPACT_AUDIT_TEXT_LOG,
    summary_file: COMPACT_SUMMARY_JSON,
    store_file: COMPACTION_STORE_FILE,
    config: {
      trigger_tokens: BRIDGE_COMPACT_TRIGGER_TOKENS,
      target_tokens: BRIDGE_COMPACT_TARGET_TOKENS,
      tail_tokens: BRIDGE_COMPACT_TAIL_TOKENS,
      chars_per_token: BRIDGE_COMPACT_CHARS_PER_TOKEN,
    },
    ...compactMetrics,
  };
  fs.writeFileSync(COMPACT_SUMMARY_JSON, `${redact(JSON.stringify(summary, null, 2))}\n`, "utf8");
}

function compactEventLog(event, data = {}) {
  const fullEntry = enrichLogEntry({ time: nowIso(), event, ...data });
  const jsonLine = redact(JSON.stringify(fullEntry));
  fs.appendFileSync(COMPACT_AUDIT_LOG, `${jsonLine}\n`, "utf8");
  appendClientScopedTextLog(fullEntry.clientId, "compact-audit.jsonl", jsonLine);
  incrementCounter(compactMetrics.events, event);

  if (event === "compact_preflight_checked") {
    compactMetrics.preflight_checked += 1;
  } else if (event === "compact_preflight_skipped") {
    compactMetrics.preflight_skipped += 1;
  } else if (event === "compact_preflight_created") {
    compactMetrics.preflight_created += 1;
    compactMetrics.active_chain_replacements += 1;
  } else if (event === "compact_endpoint_request") {
    compactMetrics.endpoint_requests += 1;
  } else if (event === "compact_endpoint_created") {
    compactMetrics.endpoint_created += 1;
  } else if (event === "compact_item_resolved") {
    compactMetrics.resolved += 1;
  } else if (event === "unknown_external_compaction_item") {
    compactMetrics.unknown_external += 1;
  } else if (event === "missing_bridge_compaction_store_entry") {
    compactMetrics.missing_store += 1;
  } else if (event === "compact_summary_failed") {
    compactMetrics.summary_failed += 1;
  }

  if (event === "compact_preflight_created" || event === "compact_endpoint_created") {
    compactMetrics.last_compact = {
      time: fullEntry.time,
      event,
      traceId: fullEntry.traceId || null,
      clientId: fullEntry.clientId || null,
      compactionId: fullEntry.compactionId || null,
      beforeEstimate: fullEntry.beforeEstimate || null,
      afterEstimate: fullEntry.afterEstimate || null,
      tailItems: fullEntry.tailItems || null,
      sourceItems: fullEntry.sourceItems || null,
    };
  }

  const text = [
    `[${fullEntry.time}]`,
    `event=${event}`,
    `trace=${fullEntry.traceId || "-"}`,
    `client=${fullEntry.clientId || "-"}`,
    fullEntry.compactionId ? `compaction=${fullEntry.compactionId}` : "",
    fullEntry.beforeEstimate !== undefined ? `before=${fullEntry.beforeEstimate}` : "",
    fullEntry.lastInputTokens !== undefined ? `last_input=${fullEntry.lastInputTokens}` : "",
    fullEntry.triggerBasis !== undefined ? `basis=${fullEntry.triggerBasis}` : "",
    fullEntry.triggerSource ? `source=${fullEntry.triggerSource}` : "",
    fullEntry.alreadyCompacted !== undefined ? `already_compacted=${fullEntry.alreadyCompacted ? "yes" : "no"}` : "",
    fullEntry.afterEstimate !== undefined ? `after=${fullEntry.afterEstimate}` : "",
    fullEntry.reason ? `reason=${fullEntry.reason}` : "",
  ].filter(Boolean).join(" ");
  fs.appendFileSync(COMPACT_AUDIT_TEXT_LOG, `${redact(text)}\n`, "utf8");
  appendClientScopedTextLog(fullEntry.clientId, "compact-audit.log", text);
  traceLog(event, data);
  writeCompactSummary();
}

function formatReasoningAuditLine(entry) {
  const base = [
    `[${entry.time}]`,
    `trace=${entry.traceId || "-"}`,
    `client=${entry.clientId || "-"}`,
    `policy=${entry.policy || "-"}`,
    `thinking=${entry.thinking || "-"}`,
    `effort=${entry.reasoningEffort || "-"}`,
    `downgraded=${entry.downgraded ? "yes" : "no"}`,
    `messages=${entry.messageCount ?? 0}`,
    `tool_call_messages=${entry.assistantToolCallMessages ?? 0}`,
    `missing_reasoning_messages=${entry.missingReasoningMessages ?? 0}`,
    `missing_reasoning_tool_calls=${entry.missingReasoningToolCalls ?? 0}`,
  ];
  if (entry.downgradeReason) base.push(`reason=${entry.downgradeReason}`);
  return base.join(" ");
}

function appendReasoningTextLog(entry) {
  const lines = [formatReasoningAuditLine(entry)];
  if (entry.downgraded && Array.isArray(entry.missingSamples) && entry.missingSamples.length > 0) {
    lines.push("  downgrade_samples:");
    for (const sample of entry.missingSamples) {
      lines.push(
        [
          "   -",
          `message_index=${sample.messageIndex}`,
          `previous_role=${sample.previousRole || "-"}`,
          `next_role=${sample.nextRole || "-"}`,
          `call_count=${sample.callCount}`,
          `tools=${(sample.toolNames || []).join(",") || "-"}`,
          `call_ids=${(sample.callIds || []).join(",") || "-"}`,
        ].join(" "),
      );
    }
  }
  const text = lines.join("\n");
  fs.appendFileSync(REASONING_AUDIT_TEXT_LOG, `${redact(text)}\n`, "utf8");
  appendClientScopedTextLog(entry.clientId, "reasoning-audit.log", text);
}

function reasoningAuditLog(entry) {
  const fullEntry = enrichLogEntry({ time: nowIso(), event: "reasoning_policy", ...entry });
  const jsonLine = redact(JSON.stringify(fullEntry));
  fs.appendFileSync(REASONING_AUDIT_LOG, `${jsonLine}\n`, "utf8");
  appendClientScopedTextLog(fullEntry.clientId, "reasoning-audit.jsonl", jsonLine);
  appendReasoningTextLog(fullEntry);

  reasoningMetrics.requests += 1;
  incrementCounter(reasoningMetrics.events, fullEntry.event);
  incrementCounter(reasoningMetrics.policies, fullEntry.policy);
  incrementCounter(reasoningMetrics.clients, fullEntry.clientId);
  if (fullEntry.thinking === "enabled") reasoningMetrics.thinking_enabled += 1;
  if (fullEntry.thinking === "disabled") reasoningMetrics.thinking_disabled += 1;
  reasoningMetrics.last_request = {
    time: fullEntry.time,
    traceId: fullEntry.traceId,
    clientId: fullEntry.clientId,
    policy: fullEntry.policy,
    thinking: fullEntry.thinking,
    reasoningEffort: fullEntry.reasoningEffort || null,
    downgraded: Boolean(fullEntry.downgraded),
    missingReasoningMessages: fullEntry.missingReasoningMessages || 0,
    missingReasoningToolCalls: fullEntry.missingReasoningToolCalls || 0,
  };

  if (fullEntry.downgraded) {
    reasoningMetrics.downgraded += 1;
    reasoningMetrics.last_downgrade = {
      time: fullEntry.time,
      traceId: fullEntry.traceId,
      clientId: fullEntry.clientId,
      policy: fullEntry.policy,
      reason: fullEntry.downgradeReason,
      missingReasoningMessages: fullEntry.missingReasoningMessages || 0,
      missingReasoningToolCalls: fullEntry.missingReasoningToolCalls || 0,
      samples: fullEntry.missingSamples || [],
    };
    bridgeLog("reasoning downgraded", reasoningMetrics.last_downgrade);
  }

  writeReasoningSummary();
}

function reasoningEventLog(event, data = {}) {
  const fullEntry = enrichLogEntry({ time: nowIso(), event, ...data });
  const jsonLine = redact(JSON.stringify(fullEntry));
  fs.appendFileSync(REASONING_AUDIT_LOG, `${jsonLine}\n`, "utf8");
  appendClientScopedTextLog(fullEntry.clientId, "reasoning-audit.jsonl", jsonLine);
  incrementCounter(reasoningMetrics.events, event);

  if (event === "upstream_tool_call_without_reasoning") {
    reasoningMetrics.upstream_missing_reasoning += 1;
  } else if (event === "upstream_missing_reasoning_retry") {
    reasoningMetrics.upstream_retried += 1;
  } else if (event === "upstream_missing_reasoning_retry_recovered") {
    reasoningMetrics.upstream_retry_recovered += 1;
    reasoningMetrics.upstream_repaired += 1;
  } else if (event === "upstream_missing_reasoning_synthesized_after_retries") {
    reasoningMetrics.upstream_synthesized_after_retries += 1;
    reasoningMetrics.upstream_repaired += 1;
  } else if (event === "codex_history_repaired") {
    reasoningMetrics.codex_history_repaired += 1;
    reasoningMetrics.codex_missing_reasoning_total += Number(fullEntry.missingReasoningMessages || 1);
  }

  const text = [
    `[${fullEntry.time}]`,
    `event=${event}`,
    `trace=${fullEntry.traceId || "-"}`,
    `client=${fullEntry.clientId || "-"}`,
    fullEntry.repairAction ? `repair=${fullEntry.repairAction}` : "",
    fullEntry.effectLevel ? `effect=${fullEntry.effectLevel}` : "",
    fullEntry.attempt !== undefined ? `attempt=${fullEntry.attempt}` : "",
    Array.isArray(fullEntry.toolNames) ? `tools=${fullEntry.toolNames.join(",") || "-"}` : "",
    Array.isArray(fullEntry.toolCallIds) ? `call_ids=${fullEntry.toolCallIds.join(",") || "-"}` : "",
  ].filter(Boolean).join(" ");
  fs.appendFileSync(REASONING_AUDIT_TEXT_LOG, `${redact(text)}\n`, "utf8");
  appendClientScopedTextLog(fullEntry.clientId, "reasoning-audit.log", text);
  traceLog(event, data);
  writeReasoningSummary();
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

const reasoningStoreByClientCall = new Map();
let reasoningStoreLoaded = false;

function reasoningStoreKey(clientId, callId) {
  return `${clientId || "anonymous"}\u0000${callId || ""}`;
}

function loadReasoningStore() {
  if (reasoningStoreLoaded) return;
  reasoningStoreLoaded = true;
  if (!fs.existsSync(REASONING_STORE_FILE)) return;

  const lines = fs.readFileSync(REASONING_STORE_FILE, "utf8").split(/\r?\n/).filter(Boolean);
  const start = Math.max(0, lines.length - REASONING_STORE_MAX_RECORDS);
  for (const line of lines.slice(start)) {
    try {
      const entry = JSON.parse(line);
      if (!entry.clientId || !entry.callId || !entry.reasoningContent) continue;
      reasoningStoreByClientCall.set(reasoningStoreKey(entry.clientId, entry.callId), entry);
    } catch {
      // Ignore corrupt store lines; the append-only store is best effort.
    }
  }
}

function pruneReasoningStoreIfNeeded() {
  try {
    if (!fs.existsSync(REASONING_STORE_FILE)) return;
    const stat = fs.statSync(REASONING_STORE_FILE);
    if (stat.size <= REASONING_STORE_MAX_BYTES && reasoningStoreByClientCall.size <= REASONING_STORE_MAX_RECORDS) return;

    const entries = Array.from(reasoningStoreByClientCall.values()).slice(-REASONING_STORE_MAX_RECORDS);
    const text = entries.map((entry) => redact(JSON.stringify(entry))).join("\n");
    fs.writeFileSync(REASONING_STORE_FILE, text ? `${text}\n` : "", "utf8");
  } catch (error) {
    bridgeLog("reasoning store prune failed", { error: error.message });
  }
}

function storeReasoningRecord(client, responseId, callId, toolName, reasoningContent, source = "model", repairReason = null) {
  const text = String(reasoningContent || "").trim();
  if (!callId || !text) return;
  loadReasoningStore();
  const clientId = client?.id || "anonymous";
  const entry = {
    time: nowIso(),
    clientId,
    responseId: responseId || null,
    callId,
    toolName: toolName || null,
    reasoningContent: text,
    reasoningSource: source,
    repairReason,
  };
  reasoningStoreByClientCall.set(reasoningStoreKey(clientId, callId), entry);
  fs.appendFileSync(REASONING_STORE_FILE, `${redact(JSON.stringify(entry))}\n`, "utf8");
  pruneReasoningStoreIfNeeded();
}

function lookupStoredReasoning(client, callId) {
  if (!callId) return "";
  loadReasoningStore();
  const entry = reasoningStoreByClientCall.get(reasoningStoreKey(client?.id || "anonymous", callId));
  return entry?.reasoningContent || "";
}

const compactionStoreByToken = new Map();
const compactionStoreById = new Map();
let compactionStoreLoaded = false;

function compactionStoreKey(clientId, value) {
  return `${clientId || "anonymous"}\u0000${value || ""}`;
}

function loadCompactionStore() {
  if (compactionStoreLoaded) return;
  compactionStoreLoaded = true;
  if (!fs.existsSync(COMPACTION_STORE_FILE)) return;

  const lines = fs.readFileSync(COMPACTION_STORE_FILE, "utf8").split(/\r?\n/).filter(Boolean);
  const start = Math.max(0, lines.length - COMPACTION_STORE_MAX_RECORDS);
  for (const line of lines.slice(start)) {
    try {
      const entry = JSON.parse(line);
      if (!entry.clientId || !entry.compactionId || !entry.summary) continue;
      if (entry.encryptedContent) {
        compactionStoreByToken.set(compactionStoreKey(entry.clientId, entry.encryptedContent), entry);
      }
      compactionStoreById.set(compactionStoreKey(entry.clientId, entry.compactionId), entry);
    } catch {
      // Ignore corrupt compaction store lines; the append-only store is best effort.
    }
  }
}

function pruneCompactionStoreIfNeeded() {
  try {
    if (!fs.existsSync(COMPACTION_STORE_FILE)) return;
    const stat = fs.statSync(COMPACTION_STORE_FILE);
    if (stat.size <= COMPACTION_STORE_MAX_BYTES && compactionStoreById.size <= COMPACTION_STORE_MAX_RECORDS) return;

    const entries = Array.from(compactionStoreById.values()).slice(-COMPACTION_STORE_MAX_RECORDS);
    const text = entries.map((entry) => redact(JSON.stringify(entry))).join("\n");
    fs.writeFileSync(COMPACTION_STORE_FILE, text ? `${text}\n` : "", "utf8");
  } catch (error) {
    bridgeLog("compaction store prune failed", { error: error.message });
  }
}

function storeCompactionRecord(client, record) {
  loadCompactionStore();
  const clientId = client?.id || "anonymous";
  const entry = {
    time: nowIso(),
    clientId,
    ...record,
  };
  compactionStoreById.set(compactionStoreKey(clientId, entry.compactionId), entry);
  if (entry.encryptedContent) {
    compactionStoreByToken.set(compactionStoreKey(clientId, entry.encryptedContent), entry);
  }
  fs.appendFileSync(COMPACTION_STORE_FILE, `${redact(JSON.stringify(entry))}\n`, "utf8");
  pruneCompactionStoreIfNeeded();
  return entry;
}

function lookupCompactionRecord(client, item) {
  loadCompactionStore();
  const clientId = client?.id || "anonymous";
  const encryptedContent = item?.encrypted_content || item?.encryptedContent || "";
  if (encryptedContent) {
    const byToken = compactionStoreByToken.get(compactionStoreKey(clientId, encryptedContent));
    if (byToken) return byToken;
  }
  const id = item?.id || item?.compaction_id || item?.compactionId || "";
  if (id) {
    const byId = compactionStoreById.get(compactionStoreKey(clientId, id));
    if (byId) return byId;
  }
  return null;
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

function previewValue(value, maxLength = 400) {
  const text = String(value ?? "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...[truncated ${text.length - maxLength} chars]`;
}

function parseJsonSafe(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error };
  }
}

function upstreamErrorEnvelope(status, details = {}) {
  const upstream = details.upstream || {};
  const upstreamMessage = upstream.message || details.message || `Upstream error ${status}`;
  return {
    error: {
      message: status === 502 || status === 504
        ? upstreamMessage
        : `Upstream error ${status}: ${upstreamMessage}`,
      type: details.type || "upstream_error",
      code: details.code || upstream.code || null,
      status,
      upstream: {
        status: upstream.status ?? details.upstreamStatus ?? status,
        type: upstream.type || null,
        code: upstream.code || null,
        message: upstreamMessage,
        body_preview: upstream.body_preview || null,
      },
      trace_id: details.traceId || null,
      response_id: details.responseId || null,
    },
  };
}

async function upstreamErrorFromResponse(upstreamRes, trace, responseId) {
  const status = upstreamRes.status || 502;
  const body = await upstreamRes.text().catch((error) => `Failed to read upstream error body: ${error.message}`);
  const parsed = parseJsonSafe(body);
  const errorObject = parsed.ok && parsed.value && typeof parsed.value === "object"
    ? (parsed.value.error && typeof parsed.value.error === "object" ? parsed.value.error : parsed.value)
    : {};
  const message = errorObject.message || errorObject.error || upstreamRes.statusText || body || `HTTP ${status}`;
  const envelope = upstreamErrorEnvelope(status, {
    traceId: trace?.traceId || null,
    responseId,
    upstream: {
      status,
      type: errorObject.type || null,
      code: errorObject.code || null,
      message: String(message),
      body_preview: previewValue(body),
    },
  });
  traceLog("upstream_error", {
    traceId: trace?.traceId || null,
    responseId,
    status,
    upstreamType: envelope.error.upstream.type,
    upstreamCode: envelope.error.upstream.code,
    bodyPreview: envelope.error.upstream.body_preview,
  });
  return envelope;
}

function upstreamErrorFromException(error, trace, responseId) {
  const status = error.statusCode || 502;
  const envelope = upstreamErrorEnvelope(status, {
    traceId: trace?.traceId || null,
    responseId,
    type: error.type || (status === 504 ? "upstream_timeout" : "upstream_fetch_error"),
    code: error.code || null,
    upstream: {
      status,
      type: error.name || null,
      code: error.code || null,
      message: error.message || "Upstream request failed",
      body_preview: null,
    },
  });
  traceLog("upstream_fetch_failed", {
    traceId: trace?.traceId || null,
    responseId,
    status,
    error: error.message,
    type: envelope.error.type,
  });
  return envelope;
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

function clientFromKey(id, key, metadata = {}) {
  if (!key) return null;
  const keyHash = hashToken(key);
  const workDir = metadata.workDir ? path.resolve(String(metadata.workDir)) : "";
  const sandboxRoot = metadata.sandboxRoot ? path.resolve(String(metadata.sandboxRoot)) : "";
  const logDir = metadata.logDir ? path.resolve(String(metadata.logDir)) : "";
  const projectId = safeClientId(
    metadata.projectId || projectIdFromWorkDir(workDir, metadata.projectName || id || keyHash.slice(0, 12)),
    "project",
  );
  return {
    id: safeClientId(id, `client_${keyHash.slice(0, 12)}`),
    key,
    keyHash,
    projectId,
    instanceId: safeClientId(metadata.instanceId || id || `instance_${keyHash.slice(0, 12)}`, "instance"),
    projectName: metadata.projectName || (workDir ? path.basename(workDir) : ""),
    workDir,
    sandboxRoot,
    logDir,
    registeredAt: metadata.registeredAt || "",
    updatedAt: metadata.updatedAt || "",
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
        const client = clientFromKey(entry.id || entry.name || "", entry.key || entry.proxyKey, {
          projectId: entry.projectId,
          instanceId: entry.instanceId,
          projectName: entry.projectName || entry.name,
          workDir: entry.workDir,
          sandboxRoot: entry.sandboxRoot,
          logDir: entry.logDir || entry.logsDir,
          registeredAt: entry.registeredAt,
          updatedAt: entry.updatedAt,
        });
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
    rememberClient(client);
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
      const info = rememberClient(client);
      return { ...info, id: client.id, keyHash: client.keyHash.slice(0, 16) };
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
    state = {
      responses: new Map(),
      reasoningByCallId: new Map(),
      toolCallsByResponseCallId: new Map(),
      toolCallKeysByCallId: new Map(),
      lastDeepSeekUsage: null,
    };
    clientState.set(clientId, state);
  }
  if (!state.toolCallsByResponseCallId) state.toolCallsByResponseCallId = new Map();
  if (!state.toolCallKeysByCallId) state.toolCallKeysByCallId = new Map();
  return state;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isToolCallItem(item) {
  return item?.type === "function_call" || item?.type === "custom_tool_call" || item?.type === "tool_search_call";
}

function isToolOutputItem(item) {
  return item?.type === "function_call_output" || item?.type === "custom_tool_call_output" || item?.type === "tool_search_output";
}

function toolCallCacheKey(responseId, callId) {
  return `${responseId || "unknown"}::${callId || ""}`;
}

function pruneToolCallCache(state) {
  const maxRecords = Math.max(1, TOOL_CALL_CACHE_MAX_RECORDS);
  while (state.toolCallsByResponseCallId.size > maxRecords) {
    const oldestKey = state.toolCallsByResponseCallId.keys().next().value;
    const oldest = state.toolCallsByResponseCallId.get(oldestKey);
    state.toolCallsByResponseCallId.delete(oldestKey);
    const keys = state.toolCallKeysByCallId.get(oldest?.callId);
    if (keys) {
      keys.delete(oldestKey);
      if (keys.size === 0) state.toolCallKeysByCallId.delete(oldest.callId);
    }
  }
}

function rememberToolCallItem(client, responseId, item, reasoningContent = "") {
  if (!isToolCallItem(item)) return;
  const callId = itemCallId(item);
  if (!callId) return;
  const state = stateForClient(client);
  const key = toolCallCacheKey(responseId, callId);
  if (state.toolCallsByResponseCallId.has(key)) {
    state.toolCallsByResponseCallId.delete(key);
    const existingKeys = state.toolCallKeysByCallId.get(callId);
    if (existingKeys) existingKeys.delete(key);
  }
  const cachedItem = cloneJson(item);
  if (reasoningContent && !cachedItem.reasoning_content) cachedItem.reasoning_content = reasoningContent;
  const entry = {
    key,
    callId,
    responseId: responseId || null,
    item: cachedItem,
    reasoningContent: cachedItem.reasoning_content || reasoningContent || "",
    storedAt: Date.now(),
  };
  state.toolCallsByResponseCallId.set(key, entry);
  let keys = state.toolCallKeysByCallId.get(callId);
  if (!keys) {
    keys = new Set();
    state.toolCallKeysByCallId.set(callId, keys);
  }
  keys.add(key);
  pruneToolCallCache(state);
}

function lookupCachedToolCallItem(client, callId, previousResponseId = null) {
  if (!callId) return null;
  const state = stateForClient(client);
  if (previousResponseId) {
    const exact = state.toolCallsByResponseCallId.get(toolCallCacheKey(previousResponseId, callId));
    if (exact) return cloneJson(exact.item);
  }
  const keys = state.toolCallKeysByCallId.get(callId);
  if (!keys || keys.size !== 1) return null;
  const onlyKey = Array.from(keys)[0];
  const entry = state.toolCallsByResponseCallId.get(onlyKey);
  return entry ? cloneJson(entry.item) : null;
}

function storeResponse(client, responseId, entry) {
  if (!responseId) return;
  const state = stateForClient(client);
  state.responses.set(responseId, { ...entry, storedAt: Date.now() });
  if (state.responses.size > RESPONSE_STORE_MAX_RECORDS) {
    const oldest = state.responses.keys().next().value;
    state.responses.delete(oldest);
  }
  for (const output of entry.output || []) {
    if (isToolCallItem(output)) rememberToolCallItem(client, responseId, output, entry.reasoningContent || "");
    if (isToolCallItem(output) && output.call_id && entry.reasoningContent) {
      state.reasoningByCallId.set(output.call_id, entry.reasoningContent);
      storeReasoningRecord(
        client,
        responseId,
        output.call_id,
        output.name || output.namespace || null,
        entry.reasoningContent,
        entry.reasoningSource || "model",
        entry.repairReason || null,
      );
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
    if (Array.isArray(entry.input)) items.push(...entry.input.filter((item) => !isBridgeDiagnosticMessage(item)));
    if (Array.isArray(entry.output)) items.push(...entry.output.filter((item) => !isBridgeDiagnosticMessage(item)));
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

function expectedToolCallTypeForOutput(item) {
  if (item?.type === "custom_tool_call_output") return "custom_tool_call";
  if (item?.type === "tool_search_output") return "tool_search_call";
  if (item?.type === "function_call_output") return "function_call";
  return "";
}

function repairToolOutputsWithCachedCalls(items, client, previousResponseId, traceId) {
  const out = [];
  const seenCallIds = new Set();
  const repairs = [];
  for (const item of items || []) {
    if (isToolCallItem(item)) {
      const callId = itemCallId(item);
      if (callId) seenCallIds.add(callId);
      out.push(item);
      continue;
    }

    if (isToolOutputItem(item)) {
      const callId = itemCallId(item);
      if (callId && !seenCallIds.has(callId)) {
        const cached = lookupCachedToolCallItem(client, callId, previousResponseId);
        const expectedType = expectedToolCallTypeForOutput(item);
        if (cached && (!expectedType || cached.type === expectedType)) {
          out.push(cached);
          seenCallIds.add(callId);
          const repair = {
            callId,
            outputType: item.type,
            restoredType: cached.type,
            previousResponseId: previousResponseId || null,
          };
          repairs.push(repair);
          traceLog("cached_tool_call_restored", {
            traceId,
            clientId: client?.id || null,
            ...repair,
          });
        } else {
          traceLog("cached_tool_call_missing", {
            traceId,
            clientId: client?.id || null,
            callId,
            outputType: item.type,
            expectedType,
            previousResponseId: previousResponseId || null,
            reason: cached ? "type_mismatch_or_ambiguous" : "not_found_or_ambiguous",
          });
        }
      }
    }
    out.push(item);
  }
  return { items: out, repairs };
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

function outputTextFromResponseMessage(item) {
  if (!item || typeof item !== "object") return "";
  if (typeof item.content === "string") return item.content;
  if (!Array.isArray(item.content)) return "";
  return item.content
    .map((block) => (
      (block.type === "input_text" || block.type === "output_text") && typeof block.text === "string"
        ? block.text
        : ""
    ))
    .join("");
}

function isBridgeDiagnosticMessage(item) {
  if (isBridgeUiOnlyMessage(item)) return true;
  if (item?.metadata?.bridge_diagnostic) return true;
  if ((item?.type || (item?.role ? "message" : "")) !== "message") return false;
  return outputTextFromResponseMessage(item).startsWith(BRIDGE_DIAGNOSTIC_PREFIX);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function extractTextFromReasoningLike(value) {
  const direct = nonEmptyString(value);
  if (direct) return direct;

  if (Array.isArray(value)) {
    return value
      .map(extractTextFromReasoningLike)
      .filter(Boolean)
      .join("\n\n");
  }

  if (!value || typeof value !== "object") return "";
  for (const key of ["reasoning_content", "content", "text", "summary"]) {
    const text = extractTextFromReasoningLike(value[key]);
    if (text) return text;
  }
  for (const key of ["parts", "details", "items"]) {
    const text = extractTextFromReasoningLike(value[key]);
    if (text) return text;
  }
  return "";
}

function splitLeadingThinkBlock(text) {
  const raw = String(text || "");
  const leadingLength = raw.length - raw.trimStart().length;
  const rest = raw.slice(leadingLength);
  if (!rest.startsWith(THINK_OPEN_TAG)) return null;
  const bodyStart = leadingLength + THINK_OPEN_TAG.length;
  const closeIndex = raw.indexOf(THINK_CLOSE_TAG, bodyStart);
  if (closeIndex < 0) return null;
  const answerStart = closeIndex + THINK_CLOSE_TAG.length;
  return {
    reasoning: raw.slice(bodyStart, closeIndex).trim(),
    answer: raw.slice(0, leadingLength) + raw.slice(answerStart).replace(/^\s*\n?/, ""),
  };
}

function chatMessageReasoningText(message) {
  if (!message || typeof message !== "object") return "";
  for (const key of ["reasoning_content", "reasoning", "reasoning_details"]) {
    const text = extractTextFromReasoningLike(message[key]);
    if (text) return text;
  }
  const content = message.content;
  if (typeof content === "string") {
    const split = splitLeadingThinkBlock(content);
    if (split?.reasoning) return split.reasoning;
  }
  return "";
}

function chatMessageVisibleContent(message) {
  if (!message || typeof message !== "object") return "";
  const content = message.content;
  if (typeof content === "string") {
    return splitLeadingThinkBlock(content)?.answer || content;
  }
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part === "string" ? part : part?.text || part?.content || ""))
    .join("\n");
}

function normalizeChatAssistantMessage(message) {
  if (!message || typeof message !== "object") return message;
  const reasoning = chatMessageReasoningText(message);
  if (reasoning) message.reasoning_content = reasoning;
  if (typeof message.content === "string") {
    const split = splitLeadingThinkBlock(message.content);
    if (split) message.content = split.answer;
  }
  if (!Array.isArray(message.tool_calls) && message.function_call) {
    message.tool_calls = [{
      id: message.function_call.id || uid("call"),
      type: "function",
      function: {
        name: message.function_call.name || "",
        arguments: canonicalChatArguments(message.function_call.arguments),
      },
    }];
    message.content = null;
  }
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      if (!call.type) call.type = "function";
      if (!call.id) call.id = uid("call");
      if (!call.function) call.function = { name: call.name || "", arguments: canonicalChatArguments(call.arguments) };
      call.function.name = call.function.name || call.name || "";
      call.function.arguments = canonicalChatArguments(call.function.arguments);
    }
  }
  return message;
}

function canonicalChatArguments(value) {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "{}";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function canonicalResponseToolArguments(argumentsText, trace, call) {
  const raw = String(argumentsText ?? "");
  if (!raw.trim()) return "{}";
  const parsed = parseJsonSafe(raw);
  if (parsed.ok) {
    if (parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)) {
      return JSON.stringify(parsed.value);
    }
    traceLog("non_object_tool_arguments_repaired", {
      traceId: trace?.traceId || null,
      responseId: call?.responseId || trace?.responseId || null,
      callId: call?.callId || null,
      name: call?.name || null,
      valueType: Array.isArray(parsed.value) ? "array" : typeof parsed.value,
    });
    return JSON.stringify({ input: parsed.value });
  }
  traceLog("malformed_tool_arguments_repaired", {
    traceId: trace?.traceId || null,
    responseId: call?.responseId || trace?.responseId || null,
    callId: call?.callId || null,
    name: call?.name || null,
    rawPreview: previewValue(raw, 160),
  });
  return JSON.stringify({ input: raw });
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

function chatToolCallName(call) {
  return call?.function?.name || call?.name || "";
}

function chatToolCallArguments(call) {
  return call?.function?.arguments || call?.arguments || "";
}

function parseMaybeJsonObject(text) {
  if (!text || typeof text !== "string") return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function classifyShellCommandEffect(commandText) {
  const command = String(commandText || "").trim();
  if (!command) return "other_tool_or_script";
  if (/[;&|`]|>\s*|>>\s*/.test(command)) return "other_tool_or_script";
  if (/\b(Remove-Item|Move-Item|Copy-Item|Set-Content|Add-Content|Out-File|New-Item|Start-Process|Stop-Process|Invoke-WebRequest|Invoke-RestMethod|curl|wget|npm|pnpm|yarn|pip|python|node|git\s+(push|commit|reset|checkout|clean|merge|rebase|pull)|rm|mv|cp|del|erase|rmdir|mkdir)\b/i.test(command)) {
    return "other_tool_or_script";
  }
  if (/^(Get-Content|Select-String|Get-ChildItem|Get-Item|Test-Path|rg|git\s+(status|diff|show|log)|findstr|dir|ls|pwd|where)\b/i.test(command)) {
    return "read_only";
  }
  return "other_tool_or_script";
}

function classifyToolCallEffect(call) {
  const name = chatToolCallName(call);
  if (/^(view_image|find|open|read|get|list|search)$/i.test(name)) return "read_only";
  if (/^(rg|grep|findstr|select-string|get-content|get-childitem|get-item|test-path)$/i.test(name)) return "read_only";
  if (/shell|command|exec|terminal|powershell|bash|cmd/i.test(name)) {
    const args = parseMaybeJsonObject(chatToolCallArguments(call));
    const command = args?.command || args?.cmd || args?.script || args?.input || "";
    return classifyShellCommandEffect(command);
  }
  return "other_tool_or_script";
}

function classifyToolCallsEffect(calls = []) {
  if (!Array.isArray(calls) || calls.length === 0) return "read_only";
  return calls.every((call) => classifyToolCallEffect(call) === "read_only")
    ? "read_only"
    : "other_tool_or_script";
}

function syntheticReasoningForToolCalls(calls = []) {
  const names = Array.from(new Set(calls.map(chatToolCallName).filter(Boolean)));
  if (names.length === 1) {
    return (
      `Bridge protocol repair: tool \`${names[0]}\` was selected but the upstream response omitted ` +
      "reasoning_content, so a minimal placeholder is attached to preserve DeepSeek thinking-mode history."
    );
  }
  return (
    "Bridge protocol repair: the upstream response omitted reasoning_content for this tool call, " +
    "so a minimal placeholder is attached to preserve DeepSeek thinking-mode tool-call history."
  );
}

function sanitizeName(value) {
  const sanitized = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  return sanitized || "tool";
}

function shortToolNameHash(value) {
  return shortHash(value, 12);
}

function truncateChatToolName(name) {
  const raw = sanitizeName(name);
  if (raw.length <= CHAT_TOOL_NAME_MAX_LENGTH) return raw;
  const suffix = `_${shortToolNameHash(raw)}`;
  return `${raw.slice(0, CHAT_TOOL_NAME_MAX_LENGTH - suffix.length)}${suffix}`;
}

function uniqueChatToolName(baseName, usedNames) {
  const base = truncateChatToolName(baseName);
  let candidate = base;
  let index = 2;
  while (usedNames.has(candidate)) {
    const suffix = `_${index}`;
    const prefixLength = Math.max(1, CHAT_TOOL_NAME_MAX_LENGTH - suffix.length);
    candidate = `${base.slice(0, prefixLength)}${suffix}`;
    index += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function chatNameForNamespace(namespace, childName) {
  const safeNamespace = sanitizeName(namespace || "namespace");
  const safeChildName = sanitizeName(childName || "tool");
  return truncateChatToolName(`${safeNamespace}__${safeChildName}`);
}

function createToolContext() {
  const context = new Map();
  context.responseFunctionMap = new Map();
  context.customMap = new Map();
  context.toolSearchEnabled = false;
  context.usedNames = new Set();
  return context;
}

function rememberToolContext(context, chatName, spec) {
  context.set(chatName, { ...spec, chatName });
  if (spec.kind === "function" || spec.kind === "namespace") {
    const responseKey = responseToolKey(spec.name || spec.originalName || chatName, spec.namespace || null);
    context.responseFunctionMap.set(responseKey, chatName);
  }
  if (spec.kind === "custom") {
    context.customMap.set(spec.name || spec.original?.name || chatName, chatName);
  }
  if (spec.kind === "tool_search") context.toolSearchEnabled = true;
}

function responseToolKey(name, namespace = null) {
  return namespace ? `${namespace}::${name || ""}` : String(name || "");
}

function chatNameForResponseFunction(context, name, namespace = null) {
  const direct = context?.responseFunctionMap?.get(responseToolKey(name, namespace));
  if (direct) return direct;
  if (namespace) return chatNameForNamespace(namespace, name);
  return truncateChatToolName(name);
}

function chatNameForCustomTool(context, name) {
  return context?.customMap?.get(name) || truncateChatToolName(name || "custom_tool");
}

function chatNameForToolSearch(context) {
  for (const [chatName, spec] of context?.entries?.() || []) {
    if (spec.kind === "tool_search") return chatName;
  }
  return TOOL_SEARCH_PROXY_NAME;
}

function toolSearchChatTool(chatName = TOOL_SEARCH_PROXY_NAME) {
  return {
    type: "function",
    function: {
      name: chatName,
      description: "Search for available client-side Codex tools and return matching tool definitions.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer" },
        },
        required: ["query"],
      },
    },
  };
}

function toolSearchArgumentsFromChat(argumentsText) {
  const parsed = parseMaybeJsonObject(String(argumentsText || ""));
  if (parsed) return parsed;
  const raw = String(argumentsText || "").trim();
  return raw ? { query: raw } : {};
}

function customArgumentsFromInput(input) {
  return JSON.stringify({ input: String(input || "") });
}

function responsesToolChoiceToChat(toolChoice, context) {
  if (!toolChoice || typeof toolChoice !== "object") return toolChoice;
  if (toolChoice.type === "function") {
    const chatName = chatNameForResponseFunction(context, toolChoice.name, toolChoice.namespace || null);
    return { type: "function", function: { name: chatName } };
  }
  if (toolChoice.type === "custom") {
    return { type: "function", function: { name: chatNameForCustomTool(context, toolChoice.name) } };
  }
  if (toolChoice.type === "tool_search") {
    return { type: "function", function: { name: chatNameForToolSearch(context) } };
  }
  return toolChoice;
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
    hasReasoningContent: typeof message.reasoning_content === "string" && message.reasoning_content.length > 0,
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

function collectToolSearchOutputTools(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectToolSearchOutputTools(item, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  if (value.type === "tool_search_output" && Array.isArray(value.tools)) {
    out.push(...value.tools);
  }
  for (const nested of Object.values(value)) collectToolSearchOutputTools(nested, out);
  return out;
}

function convertTools(tools = []) {
  const chatTools = [];
  const context = createToolContext();
  const addChatTool = (chatTool, chatName, spec) => {
    if (!chatTool || !chatName) return;
    chatTools.push(chatTool);
    rememberToolContext(context, chatName, spec);
  };

  for (const tool of tools) {
    if (!tool || typeof tool !== "object") continue;
    if (tool.type === "tool_search") {
      if (context.toolSearchEnabled) continue;
      const chatName = uniqueChatToolName(TOOL_SEARCH_PROXY_NAME, context.usedNames);
      addChatTool(toolSearchChatTool(chatName), chatName, { kind: "tool_search", name: TOOL_SEARCH_PROXY_NAME, original: tool });
      continue;
    }

    if (tool.type === "function") {
      const name = toolName(tool);
      if (!name) continue;
      const responseKey = responseToolKey(name, null);
      if (context.responseFunctionMap.has(responseKey)) continue;
      const chatName = uniqueChatToolName(name, context.usedNames);
      const chatTool = tool.function
        ? {
            ...tool,
            function: {
              ...tool.function,
              name: chatName,
            },
          }
        : {
            type: "function",
            function: {
              name: chatName,
              description: tool.description || "",
              parameters: tool.parameters || { type: "object", properties: {} },
            },
          };
      addChatTool(chatTool, chatName, { kind: "function", name, original: tool });
      continue;
    }

    if (tool.type === "custom") {
      const name = tool.name || "custom_tool";
      if (context.customMap.has(name)) continue;
      const chatName = uniqueChatToolName(name, context.usedNames);
      addChatTool({
        type: "function",
        function: {
          name: chatName,
          description: tool.description || "Custom freeform tool",
          parameters: {
            type: "object",
            properties: { input: { type: "string" } },
            required: ["input"],
          },
        },
      }, chatName, { kind: "custom", name, original: tool });
      continue;
    }

    if (tool.type === "namespace") {
      const namespace = tool.namespace || tool.name || "namespace";
      const children = tool.tools || tool.functions || [];
      for (const child of children) {
        const childName = toolName(child);
        if (!childName) continue;
        const responseKey = responseToolKey(childName, namespace);
        if (context.responseFunctionMap.has(responseKey)) continue;
        const flatName = uniqueChatToolName(chatNameForNamespace(namespace, childName), context.usedNames);
        addChatTool({
          type: "function",
          function: {
            name: flatName,
            description: child.description || "",
            parameters: child.parameters || child.function?.parameters || { type: "object", properties: {} },
          },
        }, flatName, { kind: "namespace", namespace, name: childName, original: child });
      }
    }
  }

  return { chatTools, context };
}

function responseRawReasoningText(item) {
  if (!item || typeof item !== "object") return "";
  if (typeof item.reasoning_content === "string") return item.reasoning_content;
  const reasoning = extractTextFromReasoningLike(item.reasoning);
  if (reasoning) return reasoning;
  const reasoningDetails = extractTextFromReasoningLike(item.reasoning_details);
  if (reasoningDetails) return reasoningDetails;
  if (typeof item.text === "string") return item.text;
  const parts = [];
  for (const block of item.content || []) {
    if (
      (block.type === "reasoning_text" || block.type === "output_text") &&
      typeof block.text === "string"
    ) { parts.push(block.text); }
  }
  return parts.join("");
}

function responseDisplayReasoningSummary(item) {
  if (!item || typeof item !== "object") return "";
  const parts = [];
  for (const block of item.summary || []) {
    if (typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("");
}

function responseReasoningText(item) { return responseRawReasoningText(item); }
function responseReasoningItem(value, status = "completed", id = uid("rs")) {
  const options = value && typeof value === "object" && !Array.isArray(value)
    ? value : { rawReasoningContent: value };
  const reasoningText = String(options.rawReasoningContent || "");
  const displaySummary = String(options.displaySummary || "");
  const itemId = options.id || id;
  const item = { type: "reasoning", id: itemId };
  if (displaySummary) item.summary = [{ type: "summary_text", text: displaySummary }];
  else item.summary = [];
  if (reasoningText) item.content = [{ type: "reasoning_text", text: reasoningText }];
  return item;
}
function responseMessageItem(text, status = "completed", id = uid("msg"), metadata = {}, phase = null) {
  const item = {
    type: "message",
    id,
    status,
    role: "assistant",
    content: [{ type: "output_text", text: String(text || ""), annotations: [] }],
  };
  if (metadata && Object.keys(metadata).length > 0) item.metadata = metadata;
  if (phase) item.phase = phase;
  return item;
}

function responseInputMessageItem(role, text, metadata = {}, id = uid("msg")) {
  const item = {
    type: "message",
    id,
    status: "completed",
    role,
    content: [{ type: "input_text", text: String(text || "") }],
  };
  if (metadata && Object.keys(metadata).length > 0) item.metadata = metadata;
  return item;
}

function compactCheckpointText(summary, compactionId) {
  return (
    "Compacted conversation summary generated by Codex DeepSeek Bridge using DeepSeek.\n" +
    `Compaction ID: ${compactionId}\n\n` +
    String(summary || "").trim()
  );
}

function compactCheckpointItem(summary, compactionId) {
  return responseInputMessageItem("system", compactCheckpointText(summary, compactionId), {
    bridge_compaction_checkpoint: true,
    bridge_compaction_id: compactionId,
  }, `msg_${compactionId}`);
}

function compactNoticeText(info) {
  if (!info) return "";
  return (
    `${BRIDGE_DIAGNOSTIC_PREFIX} COMPACT FALLBACK NOTICE\n` +
    `Bridge compacted active history before the DeepSeek request.\n` +
    `compaction_id=${info.compactionId}; before_estimate=${info.beforeEstimate}; ` +
    `after_estimate=${info.afterEstimate}; source_items=${info.sourceItems}; tail_items=${info.tailItems}; ` +
    `total_compactions=${compactMetrics.preflight_created + compactMetrics.endpoint_created}.\n` +
    "This protects DeepSeek context but may not rewrite Codex local history. " +
    "Run /compact in Codex when convenient so Codex installs replacement history."
  );
}

function responseCompactNoticeItem(info, status = "completed") {
  const text = compactNoticeText(info);
  if (!text) return null;
  return responseMessageItem(text, status, uid("msg"), {
    bridge_diagnostic: true,
    bridge_compact_notice: true,
  });
}

function estimateTokensForValue(value) {
  const charsPerToken = BRIDGE_COMPACT_CHARS_PER_TOKEN > 0 ? BRIDGE_COMPACT_CHARS_PER_TOKEN : 4;
  let text = "";
  try {
    text = JSON.stringify(value ?? "");
  } catch {
    text = String(value ?? "");
  }
  return Math.max(1, Math.ceil(text.length / charsPerToken));
}

function estimateTokensForItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  return items.reduce((sum, item) => sum + estimateTokensForValue(item), 0);
}

function estimateRequestTokens(body, items = []) {
  return (
    estimateTokensForItems(items) +
    estimateTokensForValue(body.instructions || "") +
    estimateTokensForValue(body.tools || [])
  );
}

function itemCallId(item) {
  return item?.call_id || item?.id || "";
}

function repairTailStartIndex(items, startIndex) {
  let start = Math.max(0, startIndex);
  let changed = true;
  while (changed && start > 0) {
    changed = false;
    const first = items[start];
    const firstType = first?.type || (first?.role ? "message" : "");
    if (firstType === "function_call_output" || firstType === "custom_tool_call_output") {
      const callId = itemCallId(first);
      for (let index = start - 1; index >= 0; index -= 1) {
        const candidateType = items[index]?.type || "";
        if (
          (candidateType === "function_call" || candidateType === "custom_tool_call") &&
          itemCallId(items[index]) === callId
        ) {
          start = index;
          changed = true;
          break;
        }
      }
    }
    const current = items[start];
    const currentType = current?.type || "";
    if (
      (currentType === "function_call" || currentType === "custom_tool_call") &&
      items[start - 1]?.type === "reasoning"
    ) {
      start -= 1;
      changed = true;
    }
  }
  return start;
}

function selectRecentTailItems(items = [], maxTokens = BRIDGE_COMPACT_TAIL_TOKENS) {
  if (!Array.isArray(items) || items.length === 0) {
    return { startIndex: 0, tailItems: [], sourceItems: [] };
  }
  const budget = Math.max(1, Number(maxTokens || 1));
  let tokens = 0;
  let start = items.length;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const itemTokens = estimateTokensForValue(items[index]);
    if (start < items.length && tokens + itemTokens > budget) break;
    tokens += itemTokens;
    start = index;
  }
  if (start === items.length) start = items.length - 1;
  start = repairTailStartIndex(items, start);
  return {
    startIndex: start,
    tailItems: items.slice(start),
    sourceItems: items.slice(0, start),
  };
}

function hasBridgeCompactionCheckpoint(items = []) {
  return (Array.isArray(items) ? items : []).some((item) => (
    item?.type === "compaction" ||
    item?.metadata?.bridge_compaction_checkpoint ||
    outputTextFromResponseMessage(item).startsWith("Compacted conversation summary generated by Codex DeepSeek Bridge")
  ));
}

function previewText(value, maxLength = 1200) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)} ...[truncated ${text.length - maxLength} chars]`;
}

function compactContentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if ((block.type === "input_text" || block.type === "output_text") && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block.type === "input_image") {
      parts.push("[input_image omitted]");
    }
  }
  return parts.join("\n");
}

function serializeItemForCompact(item) {
  if (!item || typeof item !== "object") return "";
  const type = item.type || (item.role ? "message" : "unknown");
  if (type === "message") {
    if (isBridgeDiagnosticMessage(item)) return "";
    const role = item.role || "unknown";
    return `[${role}] ${previewText(compactContentText(item.content), 2000)}`;
  }
  if (type === "function_call") {
    const name = item.namespace ? `${item.namespace}.${item.name || ""}` : item.name || "";
    return `[assistant tool_call] ${name || "function"} call_id=${item.call_id || "-"} args=${previewText(item.arguments || "{}", 1200)}`;
  }
  if (type === "custom_tool_call") {
    return `[assistant custom_tool_call] ${item.name || "custom"} call_id=${item.call_id || "-"} input=${previewText(item.input || "", 1200)}`;
  }
  if (type === "function_call_output" || type === "custom_tool_call_output") {
    return `[tool output] call_id=${item.call_id || "-"} output=${previewText(typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? ""), 1600)}`;
  }
  if (type === "reasoning") {
    return "[assistant reasoning item present; hidden reasoning content omitted]";
  }
  if (type === "compaction") {
    return `[compaction item] id=${item.id || "-"} encrypted_content_prefix=${previewText(item.encrypted_content || "", 80)}`;
  }
  return `[${type}] ${previewText(JSON.stringify(item), 1200)}`;
}

function serializeItemsForCompact(items = [], maxChars = BRIDGE_COMPACT_MAX_TRANSCRIPT_CHARS) {
  const lines = [];
  let total = 0;
  for (const item of items) {
    const line = serializeItemForCompact(item);
    if (!line) continue;
    const nextLength = line.length + 1;
    if (maxChars > 0 && total + nextLength > maxChars) {
      lines.push(`[... transcript truncated before ${items.length - lines.length} remaining item(s) ...]`);
      break;
    }
    lines.push(line);
    total += nextLength;
  }
  return lines.join("\n");
}

function downgradeWarningText(reasoningAudit) {
  if (!reasoningAudit?.downgraded) return "";
  const missingMessages = reasoningAudit.safety?.missingReasoningMessages || 0;
  const missingCalls = reasoningAudit.safety?.missingReasoningToolCalls || 0;
  return (
    `${BRIDGE_DIAGNOSTIC_PREFIX} DeepSeek thinking was disabled for this turn because ` +
    `${missingMessages} prior assistant tool-call message(s) / ${missingCalls} tool call(s) are missing reasoning_content. ` +
    "Start a new Codex session to restore DeepSeek thinking=max for this task."
  );
}

function responseDowngradeWarningItem(reasoningAudit, status = "completed", id = uid("msg")) {
  return responseMessageItem(downgradeWarningText(reasoningAudit), status, id, { bridge_diagnostic: true });
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function formatCounts(counts) {
  return Object.entries(counts)
    .map(([key, count]) => `${key}=${count}`)
    .join(", ");
}

function conciseList(values, limit = 4) {
  const unique = Array.from(new Set((values || []).filter(Boolean)));
  if (unique.length <= limit) return unique.join(",") || "-";
  return `${unique.slice(0, limit).join(",")}+${unique.length - limit}`;
}

function reasoningRepairNoticeText(notices = []) {
  const active = notices.filter(Boolean);
  if (active.length === 0) return "";

  const codex = active.filter((notice) => notice.source === "codex");
  const deepseek = active.filter((notice) => notice.source === "deepseek");
  const parts = [`${BRIDGE_DIAGNOSTIC_PREFIX} reasoning_content repair notice.`];

  if (codex.length > 0) {
    const messages = codex.reduce((sum, notice) => sum + (notice.missingReasoningMessages || 0), 0);
    const calls = codex.reduce((sum, notice) => sum + (notice.missingReasoningToolCalls || 0), 0);
    parts.push(
      `Codex history missing: ${messages} assistant tool-call turn(s), ${calls} tool call(s); ` +
      `actions: ${formatCounts(countBy(codex, (notice) => notice.repairAction))}.`,
    );
  }

  if (deepseek.length > 0) {
    const attempts = deepseek.reduce((sum, notice) => sum + (notice.attempts || 0), 0);
    parts.push(
      `DeepSeek upstream missing: ${deepseek.length} response(s); ` +
      `actions: ${formatCounts(countBy(deepseek, (notice) => notice.repairAction))}; ` +
      `retry_attempts=${attempts}.`,
    );
  }

  const detail = active.slice(0, 3).map((notice) => (
    `${notice.source}:${notice.repairAction}; tools=${conciseList(notice.toolNames)}; ` +
    `call_ids=${conciseList(notice.toolCallIds, 2)}`
  ));
  if (detail.length > 0) parts.push(`Details: ${detail.join(" | ")}`);

  parts.push(
    `Totals: codex_missing=${reasoningMetrics.codex_missing_reasoning_total}, ` +
    `deepseek_missing=${reasoningMetrics.deepseek_missing_reasoning_total}.`,
  );
  return parts.join(" ");
}

function responseReasoningRepairNoticeItem(notices = [], status = "completed", id = uid("msg")) {
  const text = reasoningRepairNoticeText(notices);
  if (!text) return null;
  return responseMessageItem(text, status, id, {
    bridge_diagnostic: true,
    bridge_reasoning_repair_notice: true,
  });
}

function upstreamMessageNeedsReasoningRepair(message) {
  return (
    message &&
    Array.isArray(message.tool_calls) &&
    message.tool_calls.length > 0 &&
    !String(message.reasoning_content || "").trim()
  );
}

function summarizeChatToolCalls(calls = []) {
  return calls.map((call) => ({
    id: call.id || null,
    name: chatToolCallName(call),
    argumentsLength: String(chatToolCallArguments(call) || "").length,
  }));
}

function attachSyntheticReasoningToMessage(message) {
  const reasoning = syntheticReasoningForToolCalls(message.tool_calls || []);
  message.reasoning_content = reasoning;
  return reasoning;
}

function chatReqWithReasoningRepairInstruction(chatReq, attempt) {
  const copy = JSON.parse(JSON.stringify(chatReq));
  copy.messages = [
    {
      role: "system",
      content: `${REASONING_REPAIR_INSTRUCTION} Repair retry attempt ${attempt}.`,
    },
    ...(Array.isArray(copy.messages) ? copy.messages : []),
  ];
  return copy;
}

function logUpstreamMissingReasoning(trace, client, responseId, message, effectLevel) {
  reasoningEventLog("upstream_tool_call_without_reasoning", {
    traceId: trace?.traceId || null,
    clientId: client?.id || null,
    responseId: responseId || null,
    toolNames: (message.tool_calls || []).map(chatToolCallName).filter(Boolean),
    toolCallIds: (message.tool_calls || []).map((call) => call.id || "").filter(Boolean),
    effectLevel,
    toolCalls: summarizeChatToolCalls(message.tool_calls || []),
  });
}

function logUpstreamReasoningRepair(event, trace, client, responseId, message, effectLevel, extra = {}) {
  reasoningEventLog(event, {
    traceId: trace?.traceId || null,
    clientId: client?.id || null,
    responseId: responseId || null,
    toolNames: (message.tool_calls || []).map(chatToolCallName).filter(Boolean),
    toolCallIds: (message.tool_calls || []).map((call) => call.id || "").filter(Boolean),
    effectLevel,
    reasoningSource: "bridge_synthesized",
    ...extra,
  });
}

function validateOrRepairUpstreamJson(upstreamJson, trace, client, responseId, mode = "final") {
  const message = upstreamJson?.choices?.[0]?.message || {};
  if (!upstreamMessageNeedsReasoningRepair(message)) {
    return { needsRetry: false, repaired: false, repairInfo: null };
  }

  const effectLevel = classifyToolCallsEffect(message.tool_calls || []);
  logUpstreamMissingReasoning(trace, client, responseId, message, effectLevel);

  if (mode === "final") {
    attachSyntheticReasoningToMessage(message);
    logUpstreamReasoningRepair("upstream_missing_reasoning_synthesized_after_retries", trace, client, responseId, message, effectLevel, {
      repairAction: "synthetic_reasoning",
      repairReason: "missing_reasoning_content_on_tool_call",
    });
    return {
      needsRetry: false,
      repaired: true,
      repairInfo: {
        source: "bridge_synthesized",
        repairReason: "missing_reasoning_content_on_tool_call",
        effectLevel,
      },
    };
  }

  return {
    needsRetry: true,
    repaired: false,
    repairInfo: {
      source: "missing",
      repairReason: "missing_reasoning_content_on_tool_call",
      effectLevel,
    },
  };
}

function analyzeReasoningSafety(messages = []) {
  const out = {
    assistantToolCallMessages: 0,
    assistantToolCalls: 0,
    missingReasoningMessages: 0,
    missingReasoningToolCalls: 0,
    missingSamples: [],
  };

  messages.forEach((message, index) => {
    if (message.role !== "assistant" || !Array.isArray(message.tool_calls) || message.tool_calls.length === 0) return;
    out.assistantToolCallMessages += 1;
    out.assistantToolCalls += message.tool_calls.length;

    const hasReasoning = typeof message.reasoning_content === "string" && message.reasoning_content.length > 0;
    if (hasReasoning) return;

    out.missingReasoningMessages += 1;
    out.missingReasoningToolCalls += message.tool_calls.length;
    if (out.missingSamples.length < 8) {
      out.missingSamples.push({
        messageIndex: index,
        previousRole: messages[index - 1]?.role || null,
        nextRole: messages[index + 1]?.role || null,
        callCount: message.tool_calls.length,
        toolNames: message.tool_calls.map((call) => call.function?.name || "").filter(Boolean).slice(0, 8),
        callIds: message.tool_calls.map((call) => call.id || "").filter(Boolean).slice(0, 8),
      });
    }
  });

  out.safeForThinking = out.missingReasoningMessages === 0;
  return out;
}

function applyDeepSeekReasoningPolicy(chatReq) {
  chatReq.thinking = { type: "enabled" };
  chatReq.reasoning_effort = "max";
  const safety = analyzeReasoningSafety(chatReq.messages);

  if (!safety.safeForThinking) {
    chatReq.thinking = { type: "disabled" };
    delete chatReq.reasoning_effort;
    return {
      policy: "disabled_missing_reasoning",
      thinking: "disabled",
      reasoningEffort: null,
      downgraded: true,
      downgradeReason: "assistant_tool_calls_missing_reasoning_content",
      safety,
    };
  }

  return {
    policy: "max",
    thinking: "enabled",
    reasoningEffort: "max",
    downgraded: false,
    downgradeReason: null,
    safety,
  };
}

function applyStrictChatCompatibility(chatReq) {
  const hasTools = Array.isArray(chatReq.tools) && chatReq.tools.length > 0;
  if (!hasTools) {
    delete chatReq.tool_choice;
    delete chatReq.parallel_tool_calls;
  } else if (chatReq.tool_choice?.type === "function") {
    const chosen = chatReq.tool_choice.function?.name || "";
    const exposed = new Set(chatReq.tools.map((tool) => tool.function?.name).filter(Boolean));
    if (!exposed.has(chosen)) delete chatReq.tool_choice;
  }
  if (chatReq.stream) {
    chatReq.stream_options = {
      ...(chatReq.stream_options || {}),
      include_usage: true,
    };
  } else {
    delete chatReq.stream_options;
  }
  return chatReq;
}

function responsesToChatRequest(body, client) {
  const messages = [];
  const traceIdForRepair = body.metadata?.bridge_case_id || null;
  const repairNotices = [];
  const rawInputItems = inputItemsForTranslation(body, client);
  const toolHistoryRepair = repairToolOutputsWithCachedCalls(rawInputItems, client, body.previous_response_id || null, traceIdForRepair);
  const inputItems = toolHistoryRepair.items;
  const dynamicTools = collectToolSearchOutputTools(inputItems);
  const { chatTools, context } = convertTools([...(body.tools || []), ...dynamicTools]);
  if (body.instructions) {
    messages.push({ role: "system", content: String(body.instructions) });
  }

  let pendingToolCalls = [];
  let pendingReasoningContent = "";
  const flushToolCalls = () => {
    if (pendingToolCalls.length === 0) return;
    const assistant = { role: "assistant", content: null, tool_calls: pendingToolCalls };
    const state = stateForClient(client);
    let restoredReasoning = pendingReasoningContent;
    let repairAction = null;
    for (const call of pendingToolCalls) {
      const reasoning = state.reasoningByCallId.get(call.id);
      if (reasoning) {
        restoredReasoning = reasoning;
        if (!pendingReasoningContent) repairAction = "restore_from_memory";
        break;
      }
    }
    if (!restoredReasoning) {
      for (const call of pendingToolCalls) {
        const reasoning = lookupStoredReasoning(client, call.id);
        if (reasoning) {
          restoredReasoning = reasoning;
          repairAction = "restore_from_store";
          break;
        }
      }
    }
    if (!restoredReasoning) {
      restoredReasoning = syntheticReasoningForToolCalls(pendingToolCalls);
      repairAction = "synthetic_reasoning";
    }
    if (restoredReasoning) {
      assistant.reasoning_content = restoredReasoning;
      for (const call of pendingToolCalls) {
        state.reasoningByCallId.set(call.id, restoredReasoning);
        if (repairAction) {
          storeReasoningRecord(
            client,
            null,
            call.id,
            chatToolCallName(call),
            restoredReasoning,
            repairAction === "synthetic_reasoning" ? "bridge_synthesized" : "model",
            repairAction === "synthetic_reasoning" ? "codex_history_missing_reasoning_content" : null,
          );
        }
      }
      if (repairAction) {
        const notice = {
          source: "codex",
          repairAction,
          missingReasoningMessages: 1,
          missingReasoningToolCalls: pendingToolCalls.length,
          toolNames: pendingToolCalls.map(chatToolCallName).filter(Boolean),
          toolCallIds: pendingToolCalls.map((call) => call.id).filter(Boolean),
        };
        reasoningEventLog("codex_history_repaired", {
          traceId: traceIdForRepair,
          clientId: client?.id || null,
          repairAction: notice.repairAction,
          reasoningSource: repairAction === "synthetic_reasoning" ? "bridge_synthesized" : "model",
          missingReasoningMessages: notice.missingReasoningMessages,
          missingReasoningToolCalls: notice.missingReasoningToolCalls,
          toolNames: notice.toolNames,
          toolCallIds: notice.toolCallIds,
        });
        repairNotices.push(notice);
      }
    }
    messages.push(assistant);
    pendingToolCalls = [];
    pendingReasoningContent = "";
  };

  for (const item of inputItems) {
    const type = item?.type || (item?.role ? "message" : "");
    if (type === "message") {
      if (isBridgeDiagnosticMessage(item)) continue;
      flushToolCalls();
      let role = item.role || "user";
      if (role === "developer") role = "system";
      messages.push({ role, content: contentToChat(item.content) });
    } else if (type === "function_call") {
      const name = item.namespace
        ? chatNameForResponseFunction(context, item.name, item.namespace)
        : chatNameForResponseFunction(context, item.name, null);
      pendingToolCalls.push({
        id: item.call_id || item.id || uid("call"),
        type: "function",
        function: {
          name,
          arguments: canonicalChatArguments(item.arguments),
        },
      });
      const itemReasoning = responseRawReasoningText(item);
      if (itemReasoning) pendingReasoningContent = itemReasoning;
    } else if (type === "reasoning") {
      const reasoning = responseRawReasoningText(item);
      if (reasoning) pendingReasoningContent = reasoning;
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
          name: chatNameForCustomTool(context, item.name),
          arguments: customArgumentsFromInput(item.input || ""),
        },
      });
      const itemReasoning = responseRawReasoningText(item);
      if (itemReasoning) pendingReasoningContent = itemReasoning;
    } else if (type === "tool_search_call") {
      pendingToolCalls.push({
        id: item.call_id || item.id || uid("call"),
        type: "function",
        function: {
          name: context.toolSearchEnabled ? chatNameForToolSearch(context) : chatNameForResponseFunction(context, TOOL_SEARCH_PROXY_NAME, null),
          arguments: canonicalChatArguments(item.arguments && typeof item.arguments === "object" ? item.arguments : {}),
        },
      });
      const itemReasoning = responseRawReasoningText(item);
      if (itemReasoning) pendingReasoningContent = itemReasoning;
    } else if (type === "custom_tool_call_output") {
      flushToolCalls();
      messages.push({
        role: "tool",
        tool_call_id: item.call_id,
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? ""),
      });
    } else if (type === "tool_search_output") {
      flushToolCalls();
      messages.push({
        role: "tool",
        tool_call_id: item.call_id,
        content: typeof item.output === "string" ? item.output : JSON.stringify({
          output: item.output ?? null,
          tools: item.tools || [],
        }),
      });
    } else if (type === "compaction") {
      flushToolCalls();
      const encryptedContent = item.encrypted_content || item.encryptedContent || "";
      const record = lookupCompactionRecord(client, item);
      if (record?.summary) {
        messages.push({
          role: "system",
          content: compactCheckpointText(record.summary, record.compactionId || item.id || "unknown"),
        });
        compactEventLog("compact_item_resolved", {
          traceId: traceIdForRepair,
          clientId: client?.id || null,
          compactionId: record.compactionId || item.id || null,
        });
      } else if (String(encryptedContent).startsWith(BRIDGE_COMPACTION_PREFIX)) {
        compactEventLog("missing_bridge_compaction_store_entry", {
          traceId: traceIdForRepair,
          clientId: client?.id || null,
          compactionId: item.id || null,
          encryptedContentPrefix: String(encryptedContent).slice(0, 64),
        });
      } else {
        compactEventLog("unknown_external_compaction_item", {
          traceId: traceIdForRepair,
          clientId: client?.id || null,
          compactionId: item.id || null,
          encryptedContentPrefix: String(encryptedContent).slice(0, 64),
        });
      }
    }
  }
  flushToolCalls();

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
  if (body.tool_choice !== undefined) chatReq.tool_choice = responsesToolChoiceToChat(body.tool_choice, context);
  applyStrictChatCompatibility(chatReq);
  const reasoningAudit = applyDeepSeekReasoningPolicy(chatReq);

  return { chatReq, toolContext: context, reasoningAudit, repairNotices, toolHistoryRepairs: toolHistoryRepair.repairs };
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
  const attachReasoning = (item) => { return item; };

  if (ctx?.kind === "tool_search") {
    return attachReasoning({
      type: "tool_search_call",
      call_id: call.callId,
      status,
      execution: "client",
      arguments: toolSearchArgumentsFromChat(argumentsText),
    });
  }

  if (ctx?.kind === "namespace") {
    const functionArguments = canonicalResponseToolArguments(argumentsText, trace, call);
    return attachReasoning({
      type: "function_call",
      id: call.itemId || uid("fc"),
      call_id: call.callId,
      namespace: ctx.namespace,
      name: ctx.name,
      arguments: functionArguments,
      status,
    });
  }

  if (ctx?.kind === "custom") {
    return attachReasoning({
      type: "custom_tool_call",
      id: call.itemId || uid("ctc"),
      call_id: call.callId,
      name: ctx.original?.name || call.name,
      input: customInputFromChatArguments(argumentsText),
      status,
    });
  }

  const functionArguments = canonicalResponseToolArguments(argumentsText, trace, call);
  return attachReasoning({
    type: "function_call",
    id: call.itemId || uid("fc"),
    call_id: call.callId,
    name: call.name,
    arguments: functionArguments,
    status,
  });
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
  if (item.type === "tool_search_call") {
    return {
      type: item.type,
      callId: item.call_id,
      argumentKeys: Object.keys(item.arguments || {}),
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

function responseFailedEvent(responseId, model, errorInput) {
  const response = baseResponse(responseId, model, null, {}, "failed");
  const error = typeof errorInput === "string" ? { message: errorInput } : (errorInput || {});
  response.error = {
    message: error.message || "Bridge stream failed.",
    type: error.type || "upstream_stream_error",
    code: error.code || null,
    status: error.statusCode || error.status || null,
  };
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

async function collectChatStreamCompletionJson(upstreamRes, model, trace, responseId) {
  const decoder = new TextDecoder();
  let buffer = "";
  let usage = null;
  let finishReason = "stop";
  let responseModel = model || "deepseek-v4-pro";
  const message = { role: "assistant", content: "" };
  const toolCalls = new Map();
  let sawDone = false;
  let sawFinishReason = false;

  const updateToolCall = (tc) => {
    const idx = tc.index ?? 0;
    if (!toolCalls.has(idx)) {
      const call = {
        id: tc.id || uid("call"),
        type: tc.type || "function",
        function: {
          name: tc.function?.name || "",
          arguments: "",
        },
      };
      toolCalls.set(idx, call);
      traceLog("upstream_tool_call_started", {
        traceId: trace.traceId,
        responseId,
        outputIndex: idx,
        callId: call.id,
        name: call.function.name,
      });
    }
    const call = toolCalls.get(idx);
    if (tc.id) call.id = tc.id;
    if (tc.type) call.type = tc.type;
    if (tc.function?.name) call.function.name = tc.function.name;
    if (tc.function?.arguments) {
      call.function.arguments += tc.function.arguments;
      traceLog("upstream_tool_call_arguments_delta", {
        traceId: trace.traceId,
        responseId,
        callId: call.id,
        name: call.function.name,
        deltaLength: tc.function.arguments.length,
        totalLength: call.function.arguments.length,
      });
    }
  };

  for await (const chunk of upstreamRes.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      if (data === "[DONE]") {
        sawDone = true;
        continue;
      }

      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (parsed.model) responseModel = parsed.model;
      if (parsed.usage) usage = parsed.usage;

      for (const choice of parsed.choices || []) {
        const delta = choice.delta || {};
        if (typeof delta.reasoning_content === "string") {
          message.reasoning_content = `${message.reasoning_content || ""}${delta.reasoning_content}`;
        }
        const reasoningDelta = extractTextFromReasoningLike(delta.reasoning);
        if (reasoningDelta) {
          message.reasoning_content = `${message.reasoning_content || ""}${reasoningDelta}`;
        }
        const reasoningDetailsDelta = extractTextFromReasoningLike(delta.reasoning_details);
        if (reasoningDetailsDelta) {
          message.reasoning_content = `${message.reasoning_content || ""}${reasoningDetailsDelta}`;
        }
        if (typeof delta.content === "string") {
          message.content += delta.content;
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) updateToolCall(tc);
        }
        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
          sawFinishReason = true;
        }
      }
    }
  }

  if (!sawDone && !sawFinishReason) {
    const error = new Error("Upstream stream ended before completion.");
    error.statusCode = 502;
    error.type = "upstream_stream_incomplete";
    throw error;
  }

  const orderedToolCalls = Array.from(toolCalls.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, call]) => call);
  if (orderedToolCalls.length > 0) {
    message.content = null;
    message.tool_calls = orderedToolCalls;
  } else if (!message.content) {
    message.content = "";
  }

  normalizeChatAssistantMessage(message);

  return {
    id: uid("chatcmpl"),
    object: "chat.completion",
    created: unixNow(),
    model: responseModel,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage,
  };
}

function normalizeChatCompletionJson(upstreamJson) {
  for (const choice of upstreamJson?.choices || []) {
    if (choice?.message) normalizeChatAssistantMessage(choice.message);
  }
  return upstreamJson;
}

async function fetchParsedChatCompletion(upstream, chatReq, trace, responseId) {
  let upstreamRes;
  try {
    upstreamRes = await fetchUpstreamWithRetry(upstream, chatReq, trace);
  } catch (error) {
    const envelope = upstreamErrorFromException(error, trace, responseId);
    return { ok: false, status: envelope.error.status, body: envelope.error.message, error: envelope.error };
  }
  if (!upstreamRes.ok) {
    const envelope = await upstreamErrorFromResponse(upstreamRes, trace, responseId);
    return { ok: false, status: upstreamRes.status, body: envelope.error.message, error: envelope.error };
  }

  if (chatReq.stream) {
    try {
      return {
        ok: true,
        upstreamJson: normalizeChatCompletionJson(await collectChatStreamCompletionJson(upstreamRes, chatReq.model, trace, responseId)),
      };
    } catch (error) {
      const envelope = upstreamErrorFromException(error, trace, responseId);
      return { ok: false, status: envelope.error.status, body: envelope.error.message, error: envelope.error };
    }
  }

  try {
    return { ok: true, upstreamJson: normalizeChatCompletionJson(await upstreamRes.json()) };
  } catch (error) {
    const mapped = new Error(`Upstream response was not valid JSON: ${error.message}`);
    mapped.statusCode = 502;
    mapped.type = "upstream_invalid_json";
    const envelope = upstreamErrorEnvelope(502, {
      traceId: trace?.traceId || null,
      responseId,
      type: "upstream_invalid_json",
      upstream: {
        status: upstreamRes.status || 200,
        type: "invalid_json",
        code: null,
        message: mapped.message,
        body_preview: null,
      },
    });
    traceLog("upstream_invalid_json", {
      traceId: trace?.traceId || null,
      responseId,
      error: error.message,
    });
    return { ok: false, status: 502, body: envelope.error.message, error: envelope.error };
  }
}

async function fetchChatCompletionWithReasoningRepair(upstream, chatReq, trace, client, responseId) {
  const repairNotices = [];
  let result = await fetchParsedChatCompletion(upstream, chatReq, trace, responseId);
  if (!result.ok) return result;

  let lastValidJson = result.upstreamJson;
  let validation = validateOrRepairUpstreamJson(lastValidJson, trace, client, responseId, "initial");
  if (!validation.needsRetry) return { ...result, repairInfo: validation.repairInfo, repairNotices };

  const initialMessage = lastValidJson?.choices?.[0]?.message || {};
  const deepseekMissingBase = {
    source: "deepseek",
    effectLevel: validation.repairInfo?.effectLevel || "unknown",
    toolNames: (initialMessage.tool_calls || []).map(chatToolCallName).filter(Boolean),
    toolCallIds: (initialMessage.tool_calls || []).map((call) => call.id || "").filter(Boolean),
  };
  reasoningMetrics.deepseek_missing_reasoning_total += 1;
  writeReasoningSummary();

  let attemptsMade = 0;
  for (let attempt = 1; attempt <= UPSTREAM_REASONING_REPAIR_RETRIES; attempt += 1) {
    attemptsMade = attempt;
    const retryEffectLevel = validation.repairInfo?.effectLevel || "unknown";
    reasoningEventLog("upstream_missing_reasoning_retry", {
      traceId: trace?.traceId || null,
      clientId: client?.id || null,
      responseId,
      attempt,
      maxAttempts: UPSTREAM_REASONING_REPAIR_RETRIES,
      effectLevel: retryEffectLevel,
      repairAction: "retry_with_bridge_instruction",
    });

    const retryReq = chatReqWithReasoningRepairInstruction(chatReq, attempt);
    result = await fetchParsedChatCompletion(upstream, retryReq, trace, responseId);
    if (!result.ok) {
      reasoningEventLog("upstream_missing_reasoning_retry_failed", {
        traceId: trace?.traceId || null,
        clientId: client?.id || null,
        responseId,
        attempt,
        status: result.status,
      });
      break;
    }

    lastValidJson = result.upstreamJson;
    validation = validateOrRepairUpstreamJson(
      lastValidJson,
      trace,
      client,
      responseId,
      attempt >= UPSTREAM_REASONING_REPAIR_RETRIES ? "final" : "initial",
    );
    if (!validation.needsRetry) {
      if (!validation.repaired) {
        const message = lastValidJson?.choices?.[0]?.message || {};
        reasoningEventLog("upstream_missing_reasoning_retry_recovered", {
          traceId: trace?.traceId || null,
          clientId: client?.id || null,
          responseId,
          attempt,
          maxAttempts: UPSTREAM_REASONING_REPAIR_RETRIES,
          effectLevel: retryEffectLevel,
          repairAction: "retry_recovered_model_reasoning",
          toolNames: (message.tool_calls || []).map(chatToolCallName).filter(Boolean),
          toolCallIds: (message.tool_calls || []).map((call) => call.id || "").filter(Boolean),
        });
        repairNotices.push({
          ...deepseekMissingBase,
          repairAction: "retry_recovered_model_reasoning",
          attempts: attempt,
          toolNames: (message.tool_calls || []).map(chatToolCallName).filter(Boolean),
          toolCallIds: (message.tool_calls || []).map((call) => call.id || "").filter(Boolean),
        });
      } else {
        repairNotices.push({
          ...deepseekMissingBase,
          repairAction: "synthetic_reasoning_after_retries",
          attempts: attempt,
        });
      }
      return { ...result, repairInfo: validation.repairInfo, repairNotices };
    }
  }

  validation = validateOrRepairUpstreamJson(lastValidJson, trace, client, responseId, "final");
  repairNotices.push({
    ...deepseekMissingBase,
    repairAction: "synthetic_reasoning_after_retries",
    attempts: attemptsMade,
  });
  return { ok: true, upstreamJson: lastValidJson, repairInfo: validation.repairInfo, repairNotices };
}

function canUseHybridStream(chatReq, reasoningAudit, requestRepairNotices = [], compactInfo = null) {
  return Boolean(
    chatReq?.stream &&
    (!Array.isArray(chatReq.tools) || chatReq.tools.length === 0) &&
    !reasoningAudit?.downgraded &&
    (!Array.isArray(requestRepairNotices) || requestRepairNotices.length === 0) &&
    !compactInfo
  );
}

async function pipeHybridStreamIfPossible(upstream, chatReq, res, body, trace, client, reasoningAudit, responseId, storeOptions = {}) {
  let upstreamRes;
  try {
    upstreamRes = await fetchUpstreamWithRetry(upstream, chatReq, trace);
  } catch (error) {
    const envelope = upstreamErrorFromException(error, trace, responseId);
    return { ok: false, status: envelope.error.status, body: envelope.error.message, error: envelope.error };
  }
  if (!upstreamRes.ok) {
    const envelope = await upstreamErrorFromResponse(upstreamRes, trace, responseId);
    return { ok: false, status: upstreamRes.status, body: envelope.error.message, error: envelope.error };
  }
  await pipeChatStreamToResponses(upstreamRes, res, body, trace, client, reasoningAudit, {
    responseId,
    ...storeOptions,
  });
  return { ok: true, streamed: true };
}

function buildCompactSummaryPrompt(items, reason) {
  const transcript = serializeItemsForCompact(items);
  return (
    "Create a continuation summary for a coding agent.\n\n" +
    "Preserve concrete state needed to continue:\n" +
    "- user's current goal and latest request\n" +
    "- workspace path\n" +
    "- files created or modified\n" +
    "- commands/tests run and outcomes\n" +
    "- important decisions, constraints, and risks\n" +
    "- unresolved tasks and next best action\n" +
    "- tool-call or bridge repair state only if it affects continuation\n\n" +
    "Do not include hidden chain-of-thought.\n" +
    "Do not invent facts.\n" +
    "Return only the summary text.\n\n" +
    `Compaction reason: ${reason || "bridge_preflight"}\n\n` +
    "Conversation items:\n" +
    transcript
  );
}

async function createDeepSeekCompactionSummary(items, body, trace, client, reason) {
  if (!Array.isArray(items) || items.length === 0) {
    return "No older conversation history was available for compaction.";
  }

  const upstream = upstreamForMode();
  const chatReq = {
    model: body.model || "deepseek-v4-pro",
    messages: [
      {
        role: "system",
        content:
          "You are compacting a coding-agent conversation. Return only a concise continuation summary. " +
          "Do not call tools. Do not include hidden chain-of-thought.",
      },
      {
        role: "user",
        content: buildCompactSummaryPrompt(items, reason),
      },
    ],
    stream: false,
    thinking: { type: "enabled" },
    reasoning_effort: "max",
    temperature: 0,
  };

  const summaryResponseId = uid("compact_chat");
  const result = await fetchParsedChatCompletion(upstream, chatReq, trace, summaryResponseId);
  if (!result.ok) {
    compactEventLog("compact_summary_failed", {
      traceId: trace?.traceId || null,
      clientId: client?.id || null,
      status: result.status,
      bodyPreview: String(result.body || "").slice(0, 400),
      reason,
    });
    const error = new Error(`Bridge compact failed: DeepSeek summary generation failed (${result.status}).`);
    error.statusCode = result.status || 502;
    throw error;
  }

  const message = result.upstreamJson?.choices?.[0]?.message || {};
  const summary = chatMessageVisibleContent(message).trim();
  if (!summary) {
    compactEventLog("compact_summary_failed", {
      traceId: trace?.traceId || null,
      clientId: client?.id || null,
      status: 502,
      reason: "empty_summary",
    });
    const error = new Error("Bridge compact failed: DeepSeek summary was empty.");
    error.statusCode = 502;
    throw error;
  }

  return {
    summary,
    usage: result.upstreamJson?.usage || null,
    model: result.upstreamJson?.model || chatReq.model,
  };
}

function buildBridgeCompactionItem(compactionId, encryptedContent) {
  return {
    type: "compaction",
    id: compactionId,
    encrypted_content: encryptedContent,
    metadata: {
      bridge_compaction: true,
      summary_source: "deepseek",
    },
  };
}

async function createCompactionRecord(client, body, trace, sourceItems, reason, extra = {}) {
  const compactionId = uid("cmp");
  const encryptedContent = `${BRIDGE_COMPACTION_PREFIX}${compactionId}`;
  const summaryResult = await createDeepSeekCompactionSummary(sourceItems, body, trace, client, reason);
  const summary = summaryResult.summary || summaryResult;
  const record = storeCompactionRecord(client, {
    compactionId,
    encryptedContent,
    sourceResponseId: extra.sourceResponseId || body.response_id || null,
    previousResponseId: extra.previousResponseId || body.previous_response_id || null,
    itemCount: Array.isArray(sourceItems) ? sourceItems.length : 0,
    summary,
    summaryModel: summaryResult.model || body.model || "deepseek-v4-pro",
    summaryTokens: translateUsage(summaryResult.usage || null),
    beforeEstimate: extra.beforeEstimate || null,
    afterEstimate: extra.afterEstimate || null,
    reason,
  });
  return {
    record,
    item: buildBridgeCompactionItem(compactionId, encryptedContent),
  };
}

async function prepareRequestBodyForBridgeCompact(body, client, trace) {
  const current = normalizeInputToArray(body.input);
  const previous = body.previous_response_id ? resolveResponseChain(client, body.previous_response_id) : [];
  const activeItems = previous.length > 0 ? [...previous, ...current] : current;
  const beforeEstimate = estimateRequestTokens(body, activeItems);
  const state = stateForClient(client);
  const lastInputTokens = Number(state.lastDeepSeekUsage?.input_tokens || 0);
  const alreadyCompacted = hasBridgeCompactionCheckpoint(activeItems);
  const useLastUsage = !alreadyCompacted || beforeEstimate >= BRIDGE_COMPACT_TRIGGER_TOKENS;
  const triggerBasis = useLastUsage ? Math.max(beforeEstimate, lastInputTokens) : beforeEstimate;
  const triggerSource = triggerBasis === lastInputTokens && lastInputTokens > beforeEstimate
    ? "last_deepseek_usage"
    : alreadyCompacted && !useLastUsage
      ? "bridge_estimate_after_compact"
      : "bridge_estimate";

  compactEventLog("compact_preflight_checked", {
    traceId: trace?.traceId || null,
    clientId: client?.id || null,
    previousResponseId: body.previous_response_id || null,
    beforeEstimate,
    lastInputTokens,
    triggerBasis,
    triggerSource,
    alreadyCompacted,
    itemCount: activeItems.length,
    triggerTokens: BRIDGE_COMPACT_TRIGGER_TOKENS,
  });

  if (!BRIDGE_COMPACT_TRIGGER_TOKENS || BRIDGE_COMPACT_TRIGGER_TOKENS <= 0) {
    compactEventLog("compact_preflight_skipped", {
      traceId: trace?.traceId || null,
      clientId: client?.id || null,
      beforeEstimate,
      lastInputTokens,
      triggerBasis,
      triggerSource,
      alreadyCompacted,
      reason: "disabled",
    });
    return { body, compactInfo: null };
  }
  if (triggerBasis < BRIDGE_COMPACT_TRIGGER_TOKENS) {
    return { body, compactInfo: null };
  }

  const compactTailBudget = BRIDGE_COMPACT_TARGET_TOKENS > 0
    ? Math.min(BRIDGE_COMPACT_TAIL_TOKENS, BRIDGE_COMPACT_TARGET_TOKENS)
    : BRIDGE_COMPACT_TAIL_TOKENS;
  const { tailItems, sourceItems, startIndex } = selectRecentTailItems(activeItems, compactTailBudget);
  if (sourceItems.length === 0) {
    compactEventLog("compact_preflight_skipped", {
      traceId: trace?.traceId || null,
      clientId: client?.id || null,
      beforeEstimate,
      lastInputTokens,
      triggerBasis,
      triggerSource,
      alreadyCompacted,
      reason: "no_older_source_items",
      tailItems: tailItems.length,
    });
    return { body, compactInfo: null };
  }

  const compactRecord = await createCompactionRecord(client, body, trace, sourceItems, "bridge_preflight", {
    previousResponseId: body.previous_response_id || null,
    beforeEstimate,
    triggerBasis,
    alreadyCompacted,
  });
  const checkpoint = compactCheckpointItem(compactRecord.record.summary, compactRecord.record.compactionId);
  const compactedInput = [checkpoint, ...tailItems];
  const afterEstimate = estimateRequestTokens(body, compactedInput);
  compactRecord.record.afterEstimate = afterEstimate;

  const compactInfo = {
    compactionId: compactRecord.record.compactionId,
    encryptedContent: compactRecord.record.encryptedContent,
    beforeEstimate,
    lastInputTokens,
    triggerBasis,
    triggerSource,
    alreadyCompacted,
    afterEstimate,
    sourceItems: sourceItems.length,
    tailItems: tailItems.length,
    tailStartIndex: startIndex,
    activeInput: compactedInput,
  };

  compactEventLog("compact_preflight_created", {
    traceId: trace?.traceId || null,
    clientId: client?.id || null,
    compactionId: compactInfo.compactionId,
    beforeEstimate,
    lastInputTokens,
    triggerBasis,
    triggerSource,
    alreadyCompacted,
    afterEstimate,
    sourceItems: compactInfo.sourceItems,
    tailItems: compactInfo.tailItems,
    tailStartIndex: compactInfo.tailStartIndex,
  });

  return {
    body: {
      ...body,
      input: compactedInput,
      previous_response_id: null,
      metadata: {
        ...(body.metadata || {}),
        bridge_compacted: "true",
        bridge_compaction_id: compactInfo.compactionId,
      },
    },
    compactInfo,
  };
}

function itemWithStatus(item, status) {
  return { ...item, status };
}

function emitResponseOutputItemSse(res, outputIndex, item) {
  if (item.type === "message") {
    const text = outputTextFromResponseMessage(item);
    const inProgress = { ...item, status: "in_progress", content: [] };
    const part = { type: "output_text", text, annotations: [] };
    res.write(sse("response.output_item.added", {
      type: "response.output_item.added",
      output_index: outputIndex,
      item: inProgress,
    }));
    res.write(sse("response.content_part.added", {
      type: "response.content_part.added",
      output_index: outputIndex,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    }));
    if (text) {
      res.write(sse("response.output_text.delta", {
        type: "response.output_text.delta",
        output_index: outputIndex,
        content_index: 0,
        delta: text,
      }));
    }
    res.write(sse("response.output_text.done", {
      type: "response.output_text.done",
      output_index: outputIndex,
      content_index: 0,
      text,
    }));
    res.write(sse("response.content_part.done", {
      type: "response.content_part.done",
      output_index: outputIndex,
      content_index: 0,
      part,
    }));
    res.write(sse("response.output_item.done", {
      type: "response.output_item.done",
      output_index: outputIndex,
      item,
    }));
    return;
  }

  if (item.type === "function_call") {
    const added = itemWithStatus({ ...item, arguments: "" }, "in_progress");
    res.write(sse("response.output_item.added", {
      type: "response.output_item.added",
      output_index: outputIndex,
      item: added,
    }));
    if (item.arguments) {
      res.write(sse("response.function_call_arguments.delta", {
        type: "response.function_call_arguments.delta",
        output_index: outputIndex,
        call_id: item.call_id,
        delta: item.arguments,
      }));
    }
    res.write(sse("response.function_call_arguments.done", {
      type: "response.function_call_arguments.done",
      output_index: outputIndex,
      call_id: item.call_id,
      arguments: item.arguments || "{}",
    }));
    res.write(sse("response.output_item.done", {
      type: "response.output_item.done",
      output_index: outputIndex,
      item,
    }));
    return;
  }

  if (item.type === "custom_tool_call") {
    const added = itemWithStatus({ ...item, input: "" }, "in_progress");
    res.write(sse("response.output_item.added", {
      type: "response.output_item.added",
      output_index: outputIndex,
      item: added,
    }));
    if (item.input) {
      res.write(sse("response.custom_tool_call_input.delta", {
        type: "response.custom_tool_call_input.delta",
        output_index: outputIndex,
        call_id: item.call_id,
        delta: item.input,
      }));
    }
    res.write(sse("response.custom_tool_call_input.done", {
      type: "response.custom_tool_call_input.done",
      output_index: outputIndex,
      call_id: item.call_id,
      input: item.input || "",
    }));
    res.write(sse("response.output_item.done", {
      type: "response.output_item.done",
      output_index: outputIndex,
      item,
    }));
    return;
  }

  if (item.type === "reasoning") {
    const summary = responseDisplayReasoningSummary(item);
    res.write(sse("response.output_item.added", { type: "response.output_item.added", output_index: outputIndex, item: responseReasoningItem({ rawReasoningContent: "", displaySummary: "", status: "in_progress", id: item.id }) }));
    res.write(sse("response.reasoning_summary_part.added", { type: "response.reasoning_summary_part.added", item_id: item.id, output_index: outputIndex, summary_index: 0, part: { type: "summary_text", text: "" } }));
    if (summary) { res.write(sse("response.reasoning_summary_text.delta", { type: "response.reasoning_summary_text.delta", item_id: item.id, output_index: outputIndex, summary_index: 0, delta: summary })); }
    res.write(sse("response.reasoning_summary_text.done", { type: "response.reasoning_summary_text.done", item_id: item.id, output_index: outputIndex, summary_index: 0, text: summary }));
    res.write(sse("response.output_item.done", { type: "response.output_item.done", output_index: outputIndex, item }));
    return;
  }

  res.write(sse("response.output_item.added", {
    type: "response.output_item.added",
    output_index: outputIndex,
    item: itemWithStatus(item, "in_progress"),
  }));
  res.write(sse("response.output_item.done", {
    type: "response.output_item.done",
    output_index: outputIndex,
    item,
  }));
}

function writeCompletedResponseAsSse(res, response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  writeResponsesStart(res, response.id, response.model, response.previous_response_id, response.metadata);
  response.output.forEach((item, index) => emitResponseOutputItemSse(res, index, item));
  res.write(sse("response.completed", { type: "response.completed", response }));
  res.end();
}

async function pipeChatStreamToResponses(upstreamRes, clientRes, requestBody, trace, client, reasoningAudit, options = {}) {
  const responseId = options.responseId || uid("resp");
  const model = requestBody.model || "deepseek-v4-pro";
  const previousResponseId = options.visiblePreviousResponseId !== undefined
    ? options.visiblePreviousResponseId
    : requestBody.previous_response_id || null;
  const metadata = requestBody.metadata || {};
  const output = [];
  const toolCalls = new Map();
  const reasoningState = { id: uid("rs"), outputIndex: null, text: "", added: false, done: false };
  const messageState = { id: uid("msg"), outputIndex: null, text: "", added: false };
  let outputIndex = 0;
  let usage = null;
  let reasoningContent = "";
  let completed = false;
  let finishReason = null;

  clientRes.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  writeResponsesStart(clientRes, responseId, model, previousResponseId, metadata);

  const emitDowngradeWarning = () => {
    if (!reasoningAudit?.downgraded) return;
    const warningId = uid("msg");
    const warningText = downgradeWarningText(reasoningAudit);
    const outputIndexForWarning = outputIndex++;
    const inProgressItem = responseMessageItem("", "in_progress", warningId);
    const completedItem = responseDowngradeWarningItem(reasoningAudit, "completed", warningId);
    const part = { type: "output_text", text: warningText, annotations: [] };

    clientRes.write(sse("response.output_item.added", {
      type: "response.output_item.added",
      output_index: outputIndexForWarning,
      item: inProgressItem,
    }));
    clientRes.write(sse("response.content_part.added", {
      type: "response.content_part.added",
      output_index: outputIndexForWarning,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    }));
    clientRes.write(sse("response.output_text.delta", {
      type: "response.output_text.delta",
      output_index: outputIndexForWarning,
      content_index: 0,
      delta: warningText,
    }));
    clientRes.write(sse("response.output_text.done", {
      type: "response.output_text.done",
      output_index: outputIndexForWarning,
      content_index: 0,
      text: warningText,
    }));
    clientRes.write(sse("response.content_part.done", {
      type: "response.content_part.done",
      output_index: outputIndexForWarning,
      content_index: 0,
      part,
    }));
    clientRes.write(sse("response.output_item.done", {
      type: "response.output_item.done",
      output_index: outputIndexForWarning,
      item: completedItem,
    }));
    output.push({ sortIndex: outputIndexForWarning, item: completedItem });
  };

  emitDowngradeWarning();

  const maybeEmitToolAdded = (call) => {
    if (call.added || !call.name) return;
    if (call.outputIndex === null || call.outputIndex === undefined) {
      call.outputIndex = outputIndex++;
    traceLog("DEBUG_SSE_tool_assigned_index", { traceId: trace.traceId, responseId, callId: call.callId, name: call.name, outputIndex: call.outputIndex });
    }
    const item = responseToolItemFromChatCall(call, trace, "in_progress", "");
    clientRes.write(sse("response.output_item.added", {
      type: "response.output_item.added",
      output_index: call.outputIndex,
      item,
    }));
    call.added = true;
  };

  const maybeEmitReasoningAdded = () => {
    if (reasoningState.added) return;
    reasoningState.added = true;
    reasoningState.outputIndex = outputIndex++;
    traceLog("DEBUG_SSE_reasoning_assigned_index", { traceId: trace.traceId, responseId, outputIndex: reasoningState.outputIndex });
    clientRes.write(sse("response.output_item.added", {
      type: "response.output_item.added",
      output_index: reasoningState.outputIndex,
      item: responseReasoningItem("", "in_progress", reasoningState.id),
    }));
    clientRes.write(sse("response.reasoning_summary_part.added", {
      type: "response.reasoning_summary_part.added",
      item_id: reasoningState.id,
      output_index: reasoningState.outputIndex,
      summary_index: 0,
      part: { type: "summary_text", text: "" },
    }));
  };

  const emitReasoningDelta = (delta) => {
    if (!delta) return;
    maybeEmitReasoningAdded();
    reasoningState.text += delta;
    reasoningContent += delta;
  };

  const emitToolSummaryCommentary = (displaySummary, currentToolCalls) => {
    const text = String(displaySummary || "").trim();
    if (!text) return null;
    const itemId = uid("msg");
    const outputIndexForCommentary = outputIndex++;
    const item = responseToolSummaryCommentaryItem(text, "completed", itemId);
    const inProgressItem = { ...responseToolSummaryCommentaryItem("", "in_progress", itemId), content: [] };
    const part = { type: "output_text", text, annotations: [] };
    clientRes.write(sse("response.output_item.added", {
      type: "response.output_item.added",
      output_index: outputIndexForCommentary,
      item: inProgressItem,
    }));
    clientRes.write(sse("response.content_part.added", {
      type: "response.content_part.added",
      output_index: outputIndexForCommentary,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    }));
    clientRes.write(sse("response.output_text.delta", {
      type: "response.output_text.delta",
      output_index: outputIndexForCommentary,
      content_index: 0,
      delta: text,
    }));
    clientRes.write(sse("response.output_text.done", {
      type: "response.output_text.done",
      output_index: outputIndexForCommentary,
      content_index: 0,
      text,
    }));
    clientRes.write(sse("response.content_part.done", {
      type: "response.content_part.done",
      output_index: outputIndexForCommentary,
      content_index: 0,
      part,
    }));
    clientRes.write(sse("response.output_item.done", {
      type: "response.output_item.done",
      output_index: outputIndexForCommentary,
      item,
    }));
    output.push({ sortIndex: outputIndexForCommentary, item });
    traceLog("tool_summary_commentary_emitted", {
      traceId: trace?.traceId || null,
      clientId: client?.id || null,
      responseId,
      outputIndex: outputIndexForCommentary,
      summaryChars: text.length,
      toolCalls: (currentToolCalls || []).length,
      surface: TOOL_SUMMARY_SURFACE,
    });
    return item;
  };

  const finishReasoning = async () => {
    const _dbg_fr_start = Date.now(); traceLog("DEBUG_SSE_finishReasoning_START", { traceId: trace.traceId, responseId, textLen: reasoningState.text.length, added: reasoningState.added, done: reasoningState.done, outputIndex: reasoningState.outputIndex });
    fs.appendFileSync(LOG_DIR + "/debug_sse.log", JSON.stringify({event:"FINISH_REASONING_START",time:new Date().toISOString(),textLen:reasoningState.text.length,added:reasoningState.added,done:reasoningState.done})+ "\n");
    const currentToolCalls = Array.from(toolCalls.values());
    if (!reasoningState.added && shouldEmitMockSummaryForTools(currentToolCalls)) {
      maybeEmitReasoningAdded();
    }
    if (!reasoningState.added || reasoningState.done) return;
    const displaySummary = await createReasoningDisplaySummary({ rawReasoningContent: reasoningState.text, toolCalls: currentToolCalls, requestBody, trace, client });
    const emitAsCommentary = shouldEmitToolSummaryCommentary(currentToolCalls, displaySummary);
    const reasoningDisplaySummary = emitAsCommentary ? "" : displaySummary;
    const item = responseReasoningItem({ rawReasoningContent: reasoningState.text, displaySummary: reasoningDisplaySummary, status: "completed", id: reasoningState.id });
    if (reasoningDisplaySummary) {
    traceLog("DEBUG_SSE_emit_summary_delta", { traceId: trace.traceId, responseId, deltaLen: reasoningDisplaySummary.length });
      clientRes.write(sse("response.reasoning_summary_text.delta", { type: "response.reasoning_summary_text.delta", item_id: reasoningState.id, output_index: reasoningState.outputIndex, summary_index: 0, delta: reasoningDisplaySummary }));
    }
    traceLog("DEBUG_SSE_emit_summary_done", { traceId: trace.traceId, responseId });
    clientRes.write(sse("response.reasoning_summary_text.done", { type: "response.reasoning_summary_text.done", item_id: reasoningState.id, output_index: reasoningState.outputIndex, summary_index: 0, text: reasoningDisplaySummary }));
    clientRes.write(sse("response.output_item.done", { type: "response.output_item.done", output_index: reasoningState.outputIndex, item }));
    output.push({ sortIndex: reasoningState.outputIndex, item });
    if (emitAsCommentary) {
      emitToolSummaryCommentary(displaySummary, currentToolCalls);
    }
    traceLog("DEBUG_SSE_finishReasoning_END", { traceId: trace.traceId, responseId, elapsedMs: Date.now() - _dbg_fr_start, hasSummary: !!displaySummary, reasoningSummaryLen: (reasoningDisplaySummary||"").length, commentarySummaryLen: emitAsCommentary ? (displaySummary || "").length : 0, summarySurface: emitAsCommentary ? "commentary" : "reasoning" });
    reasoningState.done = true;
  };
  const finishTools = () => {
    traceLog("DEBUG_SSE_finishTools_START", { traceId: trace.traceId, responseId, toolCount: toolCalls.size, completed });
    fs.appendFileSync(LOG_DIR + "/debug_sse.log", JSON.stringify({event:"FINISH_TOOLS_START",time:new Date().toISOString(),toolCount:toolCalls.size,completed:completed})+ "\n");
    for (const [, call] of toolCalls) {
      if (call.done) continue;
      maybeEmitToolAdded(call);
      const item = responseToolItemFromChatCall(call, trace, "completed");
      if (item.type === "function_call") {
        clientRes.write(sse("response.function_call_arguments.done", {
          type: "response.function_call_arguments.done",
          output_index: call.outputIndex,
          call_id: call.callId,
          arguments: item.arguments || "{}",
        }));
      } else if (item.type === "custom_tool_call") {
        if (item.input) {
          clientRes.write(sse("response.custom_tool_call_input.delta", {
            type: "response.custom_tool_call_input.delta",
            output_index: call.outputIndex,
            call_id: call.callId,
            delta: item.input,
          }));
        }
        clientRes.write(sse("response.custom_tool_call_input.done", {
          type: "response.custom_tool_call_input.done",
          output_index: call.outputIndex,
          call_id: call.callId,
          input: item.input || "",
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

  const finishResponse = async () => {
    traceLog("DEBUG_SSE_finishResponse_START", { traceId: trace.traceId, responseId, sawDone, sawFinishReason, completed, finishReason });
    if (completed) return;
    completed = true;
    flushPendingContent();
    await finishReasoning();
    traceLog("DEBUG_SSE_about_to_call_finishTools", { traceId: trace.traceId, responseId, toolCount: toolCalls.size });
    finishTools();
    finishMessage();
    const ordered = output.sort((a, b) => a.sortIndex - b.sortIndex).map((entry) => entry.item);
    const translatedUsage = translateUsage(usage);
    const diagnostics = responseOutputDiagnostics(ordered, finishReason);
    clientRes.write(completedEvent(responseId, model, ordered, usage, previousResponseId, metadata));
    clientRes.end();
    const state = stateForClient(client);
    state.lastDeepSeekUsage = {
      time: nowIso(),
      traceId: trace?.traceId || null,
      responseId,
      ...translatedUsage,
    };
    compactMetrics.last_usage = {
      clientId: client?.id || null,
      ...state.lastDeepSeekUsage,
    };
    writeCompactSummary();
    storeResponse(client, responseId, {
      provider: UPSTREAM_MODE,
      input: options.storeInput || normalizeInputToArray(requestBody.input),
      output: ordered,
      previousResponseId: options.storePreviousResponseId !== undefined
        ? options.storePreviousResponseId
        : requestBody.previous_response_id || null,
      reasoningContent,
    });
    recordCompletionDiagnostics(trace, client, responseId, diagnostics);
    traceLog("responses_completed", {
      traceId: trace.traceId,
      clientId: client?.id || null,
      responseId,
      ...diagnostics,
      usage: translatedUsage,
    });
    bridgeLog("stored response", { clientId: client?.id || null, responseId, ...diagnostics });
  };

  const emitTextDelta = (delta) => {
    if (!delta) return;
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
    messageState.text += delta;
    clientRes.write(sse("response.output_text.delta", {
      type: "response.output_text.delta",
      output_index: messageState.outputIndex,
      content_index: 0,
      delta,
    }));
  };

  let contentMode = "undecided";
  let thinkBuffer = "";
  const processTextAfterThink = (text) => {
    const cleaned = String(text || "").replace(/^\s*\n?/, "");
    if (cleaned) emitTextDelta(cleaned);
  };
  const processContentDelta = (delta) => {
    if (!delta) return;
    if (contentMode === "text") {
      emitTextDelta(delta);
      return;
    }

    thinkBuffer += delta;
    if (contentMode === "undecided") {
      const trimmed = thinkBuffer.trimStart();
      if (!trimmed) return;
      if (THINK_OPEN_TAG.startsWith(trimmed) && trimmed.length < THINK_OPEN_TAG.length) return;
      if (trimmed.startsWith(THINK_OPEN_TAG)) {
        const leading = thinkBuffer.length - trimmed.length;
        thinkBuffer = thinkBuffer.slice(leading + THINK_OPEN_TAG.length);
        contentMode = "think";
      } else {
        contentMode = "text";
        const buffered = thinkBuffer;
        thinkBuffer = "";
        emitTextDelta(buffered);
        return;
      }
    }

    if (contentMode === "think") {
      const closeIndex = thinkBuffer.indexOf(THINK_CLOSE_TAG);
      if (closeIndex < 0) return;
      const reasoning = thinkBuffer.slice(0, closeIndex).trim();
      const remainder = thinkBuffer.slice(closeIndex + THINK_CLOSE_TAG.length);
      thinkBuffer = "";
      if (reasoning) emitReasoningDelta(reasoning);
      finishReasoning();
      contentMode = "text";
      processTextAfterThink(remainder);
    }
  };

  const flushPendingContent = () => {
    if (!thinkBuffer) return;
    if (contentMode === "think") {
      emitReasoningDelta(thinkBuffer.trim());
      thinkBuffer = "";
      finishReasoning();
      return;
    }
    emitTextDelta(thinkBuffer);
    thinkBuffer = "";
    contentMode = "text";
  };

  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;
  let sawFinishReason = false;

  try {
    for await (const chunk of upstreamRes.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
          traceLog("DEBUG_SSE_DONE_detected", { traceId: trace.traceId, responseId, completed });
          fs.appendFileSync(LOG_DIR + "/debug_sse.log", JSON.stringify({event:"DONE_DETECTED",time:new Date().toISOString(),completed:completed})+ "\n");
        if (data === "[DONE]") {
          sawDone = true;
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
            emitReasoningDelta(delta.reasoning_content);
          }
          const reasoningDelta = extractTextFromReasoningLike(delta.reasoning);
          if (reasoningDelta) {
            emitReasoningDelta(reasoningDelta);
          }
          const reasoningDetailsDelta = extractTextFromReasoningLike(delta.reasoning_details);
          if (reasoningDetailsDelta) {
            emitReasoningDelta(reasoningDetailsDelta);
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
                  reasoningContent,
                  responseId,
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
              if (reasoningContent) call.reasoningContent = reasoningContent;
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
                if (call.name && !isCustomResponseToolCall(call, trace) && restoredToolContext(call.name, trace)?.kind !== "tool_search") {
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
            processContentDelta(delta.content);
          }

          if (choice.finish_reason) {
            traceLog("DEBUG_SSE_finish_reason_detected", { traceId: trace.traceId, responseId, finishReason: choice.finish_reason, completed });
            fs.appendFileSync(LOG_DIR + "/debug_sse.log", JSON.stringify({event:"FINISH_REASON_DETECTED",time:new Date().toISOString(),reason:choice.finish_reason,completed:completed})+ "\n");
            finishReason = choice.finish_reason;
            sawFinishReason = true;
            flushPendingContent();
          }
        }
      }
    }
    if (!completed) {
      if (!sawDone && !sawFinishReason) {
        const error = new Error("Upstream stream ended before completion.");
        error.statusCode = 502;
        error.type = "upstream_stream_incomplete";
        throw error;
      }
      finishResponse();
    }
  } catch (error) {
    bridgeLog("stream translation failed", { error: error.message });
    traceLog("stream_translation_failed", {
      traceId: trace?.traceId || null,
      clientId: client?.id || null,
      responseId,
      status: error.statusCode || error.status || null,
      type: error.type || null,
      error: error.message,
    });
    if (!clientRes.destroyed && !completed) {
      clientRes.write(responseFailedEvent(responseId, model, error));
      clientRes.end();
    }
  }
}

async function chatCompletionToResponse(
  upstreamJson,
  requestBody,
  trace,
  client,
  reasoningAudit,
  repairInfo = null,
  responseIdOverride = null,
  repairNotices = [],
  storeOptions = {},
) {
  const responseId = responseIdOverride || uid("resp");
  const output = [];
  const choice = upstreamJson.choices?.[0];
  const message = choice?.message || {};
  const messageToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const state = stateForClient(client);

  if (reasoningAudit?.downgraded) {
    output.push(responseDowngradeWarningItem(reasoningAudit, "completed"));
  }
  const repairNoticeItem = responseReasoningRepairNoticeItem(repairNotices, "completed");
  if (repairNoticeItem) output.push(repairNoticeItem);
  const compactNoticeItem = responseCompactNoticeItem(storeOptions.compactInfo, "completed");
  if (compactNoticeItem) output.push(compactNoticeItem);

  if (message.reasoning_content || shouldEmitMockSummaryForTools(messageToolCalls)) {
    if (message.reasoning_content) {
      for (const toolCall of messageToolCalls) {
        state.reasoningByCallId.set(toolCall.id, message.reasoning_content);
      }
    }
    const displaySummary = await createReasoningDisplaySummary({
      rawReasoningContent: message.reasoning_content || "",
      toolCalls: messageToolCalls,
      requestBody,
      trace,
      client,
    });
    const emitAsCommentary = shouldEmitToolSummaryCommentary(messageToolCalls, displaySummary);
    output.push(responseReasoningItem({
      rawReasoningContent: message.reasoning_content || "",
      displaySummary: emitAsCommentary ? "" : displaySummary,
      status: "completed",
    }));
    if (emitAsCommentary) {
      output.push(responseToolSummaryCommentaryItem(displaySummary, "completed"));
      traceLog("tool_summary_commentary_emitted", {
        traceId: trace?.traceId || null,
        clientId: client?.id || null,
        responseId,
        outputIndex: output.length - 1,
        summaryChars: String(displaySummary || "").length,
        toolCalls: messageToolCalls.length,
        surface: TOOL_SUMMARY_SURFACE,
        streaming: false,
      });
    }
  }

  if (messageToolCalls.length > 0) {
    for (const toolCall of messageToolCalls) {
      output.push(responseToolItemFromChatCall({
        itemId: uid("fc"),
        callId: toolCall.id,
        name: toolCall.function?.name || "",
        arguments: toolCall.function?.arguments || "{}",
        reasoningContent: message.reasoning_content || "",
        responseId,
      }, trace, "completed"));
    }
  } else if (chatMessageVisibleContent(message)) {
    output.push({
      type: "message",
      id: uid("msg"),
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: chatMessageVisibleContent(message), annotations: [] }],
    });
  }

  const response = baseResponse(
    responseId,
    requestBody.model || upstreamJson.model || "deepseek-v4-pro",
    storeOptions.visiblePreviousResponseId !== undefined
      ? storeOptions.visiblePreviousResponseId
      : requestBody.previous_response_id || null,
    requestBody.metadata || {},
    "completed",
  );
  response.output = output;
  response.usage = translateUsage(upstreamJson.usage);
  const diagnostics = responseOutputDiagnostics(output, choice?.finish_reason || null);
  state.lastDeepSeekUsage = {
    time: nowIso(),
    traceId: trace?.traceId || null,
    responseId,
    ...response.usage,
  };
  compactMetrics.last_usage = {
    clientId: client?.id || null,
    ...state.lastDeepSeekUsage,
  };
  writeCompactSummary();

  storeResponse(client, responseId, {
    provider: UPSTREAM_MODE,
    input: storeOptions.storeInput || normalizeInputToArray(requestBody.input),
    output,
    previousResponseId: storeOptions.storePreviousResponseId !== undefined
      ? storeOptions.storePreviousResponseId
      : requestBody.previous_response_id || null,
    reasoningContent: message.reasoning_content || "",
    reasoningSource: repairInfo?.source || "model",
    repairReason: repairInfo?.repairReason || null,
    compactInfo: storeOptions.compactInfo || null,
  });

  recordCompletionDiagnostics(trace, client, responseId, diagnostics);
  traceLog("responses_completed", {
    traceId: trace.traceId,
    clientId: client?.id || null,
    responseId,
    ...diagnostics,
    usage: response.usage,
    reasoningSource: repairInfo?.source || (message.reasoning_content ? "model" : null),
    repairReason: repairInfo?.repairReason || null,
    compactInfo: storeOptions.compactInfo || null,
  });

  return response;
}

async function handleResponses(req, res) {
  const client = requireAuth(req, res);
  if (!client) return;
  const originalBody = await readJson(req);
  const trace = { traceId: originalBody.metadata?.bridge_case_id || uid("trace"), client };
  rememberTraceClient(trace.traceId, client);
  const prepared = await prepareRequestBodyForBridgeCompact(originalBody, client, trace);
  const body = prepared.body;
  const compactInfo = prepared.compactInfo;
  const {
    chatReq,
    toolContext,
    reasoningAudit,
    repairNotices: requestRepairNotices,
    toolHistoryRepairs,
  } = responsesToChatRequest(body, client);
  trace.toolContext = toolContext;
  const responseId = uid("resp");
  bridgeLog("received /v1/responses", {
    clientId: client.id,
    model: originalBody.model,
    stream: Boolean(originalBody.stream),
    inputShape: Array.isArray(originalBody.input) ? `array:${originalBody.input.length}` : typeof originalBody.input,
    tools: Array.isArray(originalBody.tools) ? originalBody.tools.length : 0,
    previous_response_id: originalBody.previous_response_id || null,
    compacted: Boolean(compactInfo),
  });
  bridgeLog("translated responses -> chat", {
    clientId: client.id,
    messages: chatReq.messages.length,
    tools: chatReq.tools?.length || 0,
    roles: chatReq.messages.map((message) => `${message.role}${message.tool_calls ? "(tool_calls)" : ""}`),
  });
  traceLog("responses_request", {
    traceId: trace.traceId,
    clientId: client.id,
    model: originalBody.model || null,
    stream: Boolean(originalBody.stream),
    previousResponseId: originalBody.previous_response_id || null,
    effectivePreviousResponseId: body.previous_response_id || null,
    inputShape: Array.isArray(originalBody.input) ? `array:${originalBody.input.length}` : typeof originalBody.input,
    effectiveInputShape: Array.isArray(body.input) ? `array:${body.input.length}` : typeof body.input,
    inputTypes: normalizeInputToArray(originalBody.input).map((item) => item.type || item.role || "unknown"),
    effectiveInputTypes: normalizeInputToArray(body.input).map((item) => item.type || item.role || "unknown"),
    responsesTools: summarizeResponsesTools(originalBody.tools || []),
    chatTools: summarizeChatTools(chatReq.tools || []),
    thinking: chatReq.thinking || null,
    reasoningEffort: chatReq.reasoning_effort || null,
    reasoningPolicy: reasoningAudit.policy,
    reasoningDowngraded: reasoningAudit.downgraded,
    downgradeReason: reasoningAudit.downgradeReason,
    reasoningSafety: reasoningAudit.safety,
    toolContext: summarizeToolContext(toolContext),
    messages: summarizeMessages(chatReq.messages),
    toolHistoryRepairs,
    toolChoiceForwarded: chatReq.tool_choice !== undefined,
    parallelToolCallsForwarded: chatReq.parallel_tool_calls !== undefined,
    streamOptions: chatReq.stream_options || null,
    compactInfo,
  });
  reasoningAuditLog({
    traceId: trace.traceId,
    clientId: client.id,
    model: originalBody.model || null,
    stream: Boolean(originalBody.stream),
    previousResponseId: originalBody.previous_response_id || null,
    inputShape: Array.isArray(originalBody.input) ? `array:${originalBody.input.length}` : typeof originalBody.input,
    inputTypes: normalizeInputToArray(originalBody.input).map((item) => item.type || item.role || "unknown"),
    responsesToolCount: Array.isArray(originalBody.tools) ? originalBody.tools.length : 0,
    chatToolCount: chatReq.tools?.length || 0,
    messageCount: chatReq.messages.length,
    policy: reasoningAudit.policy,
    thinking: reasoningAudit.thinking,
    reasoningEffort: reasoningAudit.reasoningEffort,
    downgraded: reasoningAudit.downgraded,
    downgradeReason: reasoningAudit.downgradeReason,
    assistantToolCallMessages: reasoningAudit.safety.assistantToolCallMessages,
    assistantToolCalls: reasoningAudit.safety.assistantToolCalls,
    missingReasoningMessages: reasoningAudit.safety.missingReasoningMessages,
    missingReasoningToolCalls: reasoningAudit.safety.missingReasoningToolCalls,
    missingSamples: reasoningAudit.safety.missingSamples,
  });

  const upstream = upstreamForMode();
  if (canUseHybridStream(chatReq, reasoningAudit, requestRepairNotices, compactInfo)) {
    const hybrid = await pipeHybridStreamIfPossible(
      upstream,
      chatReq,
      res,
      body,
      trace,
      client,
      reasoningAudit,
      responseId,
      {
        visiblePreviousResponseId: originalBody.previous_response_id || null,
        storeInput: compactInfo?.activeInput || normalizeInputToArray(body.input),
        storePreviousResponseId: compactInfo ? null : body.previous_response_id || null,
      },
    );
    if (!hybrid.ok) {
      bridgeLog("upstream error", { status: hybrid.status, body: String(hybrid.body || "").slice(0, 400) });
      sendJson(res, hybrid.status, { error: hybrid.error || upstreamErrorEnvelope(hybrid.status, {
        traceId: trace.traceId,
        responseId,
        message: hybrid.body || `Upstream error ${hybrid.status}`,
      }).error });
    }
    return;
  }

  const upstreamResult = await fetchChatCompletionWithReasoningRepair(upstream, chatReq, trace, client, responseId);

  if (!upstreamResult.ok) {
    bridgeLog("upstream error", { status: upstreamResult.status, body: String(upstreamResult.body || "").slice(0, 400) });
    sendJson(res, upstreamResult.status, { error: upstreamResult.error || upstreamErrorEnvelope(upstreamResult.status, {
      traceId: trace.traceId,
      responseId,
      message: upstreamResult.body || `Upstream error ${upstreamResult.status}`,
    }).error });
    return;
  }

  if (chatReq.stream) {
    const repairNotices = [...(requestRepairNotices || []), ...(upstreamResult.repairNotices || [])];
    const response = await chatCompletionToResponse(
      upstreamResult.upstreamJson,
      body,
      trace,
      client,
      reasoningAudit,
      upstreamResult.repairInfo,
      responseId,
      repairNotices,
      {
        visiblePreviousResponseId: originalBody.previous_response_id || null,
        storeInput: compactInfo?.activeInput || normalizeInputToArray(body.input),
        storePreviousResponseId: compactInfo ? null : body.previous_response_id || null,
        compactInfo,
      },
    );
    bridgeLog("returned stream response", {
      id: response.id,
      clientId: client.id,
      ...responseOutputDiagnostics(response.output, upstreamResult.upstreamJson?.choices?.[0]?.finish_reason || null),
    });
    writeCompletedResponseAsSse(res, response);
    return;
  }

  const repairNotices = [...(requestRepairNotices || []), ...(upstreamResult.repairNotices || [])];
  const response = await chatCompletionToResponse(
    upstreamResult.upstreamJson,
    body,
    trace,
    client,
    reasoningAudit,
    upstreamResult.repairInfo,
    responseId,
    repairNotices,
    {
      visiblePreviousResponseId: originalBody.previous_response_id || null,
      storeInput: compactInfo?.activeInput || normalizeInputToArray(body.input),
      storePreviousResponseId: compactInfo ? null : body.previous_response_id || null,
      compactInfo,
    },
  );
  bridgeLog("returned non-stream response", {
    id: response.id,
    clientId: client.id,
    ...responseOutputDiagnostics(response.output, upstreamResult.upstreamJson?.choices?.[0]?.finish_reason || null),
  });
  sendJson(res, 200, response);
}

async function handleResponsesCompact(req, res) {
  const client = requireAuth(req, res);
  if (!client) return;
  const body = await readJson(req);
  const trace = { traceId: body.metadata?.bridge_case_id || uid("trace"), client };
  rememberTraceClient(trace.traceId, client);
  const responseId = uid("resp");
  compactEventLog("compact_endpoint_request", {
    traceId: trace.traceId,
    clientId: client.id,
    responseId: body.response_id || null,
    previousResponseId: body.previous_response_id || null,
    inputShape: Array.isArray(body.input) ? `array:${body.input.length}` : typeof body.input,
  });

  let items = [];
  if (body.response_id) {
    items = resolveResponseChain(client, body.response_id);
  } else if (body.previous_response_id) {
    items = resolveResponseChain(client, body.previous_response_id);
  }
  const current = normalizeInputToArray(body.input);
  if (current.length > 0) items = [...items, ...current];

  if (items.length === 0) {
    sendJson(res, 400, {
      error: {
        message: "Bridge compact failed: no known response history or input was available.",
      },
    });
    return;
  }

  const beforeEstimate = estimateRequestTokens(body, items);
  const compactRecord = await createCompactionRecord(client, body, trace, items, "codex_compact_endpoint", {
    sourceResponseId: body.response_id || null,
    previousResponseId: body.previous_response_id || null,
    beforeEstimate,
  });
  const output = [compactRecord.item];
  const response = baseResponse(
    responseId,
    body.model || compactRecord.record.summaryModel || "deepseek-v4-pro",
    body.previous_response_id || null,
    body.metadata || {},
    "completed",
  );
  response.output = output;
  response.usage = compactRecord.record.summaryTokens || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

  storeResponse(client, responseId, {
    provider: UPSTREAM_MODE,
    input: [],
    output,
    previousResponseId: null,
    reasoningContent: "",
    compactInfo: {
      compactionId: compactRecord.record.compactionId,
      encryptedContent: compactRecord.record.encryptedContent,
      beforeEstimate,
      afterEstimate: estimateTokensForValue(compactRecord.record.summary),
      sourceItems: items.length,
      tailItems: 0,
      endpoint: true,
    },
  });

  compactEventLog("compact_endpoint_created", {
    traceId: trace.traceId,
    clientId: client.id,
    responseId,
    compactionId: compactRecord.record.compactionId,
    beforeEstimate,
    afterEstimate: estimateTokensForValue(compactRecord.record.summary),
    sourceItems: items.length,
  });

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
      url: chatCompletionsUrlFromBase(DEEPSEEK_BASE_URL),
      key: DEEPSEEK_API_KEY,
    };
  }
  return {
    url: `http://127.0.0.1:${MOCK_UPSTREAM_PORT}/v1/chat/completions`,
    key: "mock-upstream-key",
  };
}

function chatCompletionsUrlFromBase(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "https://api.deepseek.com/v1/chat/completions";
  const lower = trimmed.toLowerCase();
  if (lower.endsWith("/chat/completions")) return trimmed;
  if (lower.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

async function fetchSummaryChatCompletion(upstream, chatReq, timeoutMs) {
  const body = JSON.stringify(chatReq);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || REASONING_SUMMARY_TIMEOUT_MS);
  try {
    const res = await fetch(upstream.url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${upstream.key}` }, body, signal: controller.signal });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { ok: res.ok, status: res.status, text, json };
  } catch (error) {
    return { ok: false, status: error.name === "AbortError" ? 504 : 502, text: error.message, json: null };
  } finally { clearTimeout(timer); }
}

function truncateText(text, maxLen) { const s = String(text || ""); return s.length <= maxLen ? s : s.slice(0, maxLen) + "..."; }

function isMockReasoningSummaryMode() {
  return REASONING_SUMMARY_MODE === "mock";
}

function toolCallDisplayName(toolCall) {
  return toolCall?.name || toolCall?.function?.name || toolCall?.tool_name || "";
}

function shouldEmitMockSummaryForTools(toolCalls) {
  return (
    isMockReasoningSummaryMode() &&
    Array.isArray(toolCalls) &&
    toolCalls.some((toolCall) => Boolean(toolCall && (toolCall.id || toolCall.callId || toolCallDisplayName(toolCall))))
  );
}

function hasReasoningSummaryToolCalls(toolCalls) {
  return (
    Array.isArray(toolCalls) &&
    toolCalls.some((toolCall) => Boolean(toolCall && (toolCall.id || toolCall.callId || toolCallDisplayName(toolCall))))
  );
}

function codexReasoningSummaryHasVisibleBody(text) {
  const s = String(text || "").trim();
  const open = s.indexOf("**");
  if (open < 0) return false;
  const afterOpen = s.slice(open + 2);
  const close = afterOpen.indexOf("**");
  if (close < 0) return false;
  const afterCloseIndex = open + 2 + close + 2;
  return s.slice(afterCloseIndex).trim().length > 0;
}

function codexReasoningSummaryTitle(toolCalls, fallback = "整理执行思路") {
  const names = Array.from(new Set((toolCalls || []).map(toolCallDisplayName).filter(Boolean)));
  if (names.length === 1) return `准备调用 ${names[0]}`;
  if (names.length > 1) return "规划工具调用";
  return fallback;
}

function formatCodexVisibleReasoningSummary(summary, { toolCalls = [], title = "" } = {}) {
  const body = String(summary || "").replace(/\r\n/g, "\n").trim();
  if (!body) return "";
  if (codexReasoningSummaryHasVisibleBody(body)) return body;
  return `**${title || codexReasoningSummaryTitle(toolCalls)}**\n\n${body}`;
}

function toolSummarySurfaceIsCommentary() {
  return TOOL_SUMMARY_SURFACE === "commentary" || TOOL_SUMMARY_SURFACE === "agent_message";
}

function shouldEmitToolSummaryCommentary(toolCalls, displaySummary) {
  return (
    toolSummarySurfaceIsCommentary() &&
    hasReasoningSummaryToolCalls(toolCalls) &&
    Boolean(String(displaySummary || "").trim())
  );
}

function responseToolSummaryCommentaryItem(text, status = "completed", id = uid("msg")) {
  return responseMessageItem(
    text,
    status,
    id,
    {
      bridge_ui_only: true,
      bridge_tool_summary_commentary: true,
    },
    "commentary",
  );
}

function summaryThinkingEnabled() {
  return !/^(0|false|off|disabled|none)$/i.test(REASONING_SUMMARY_THINKING);
}

function normalizeSummaryText(text) {
  return String(text || "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\u2026/g, "...");
}

function summaryChatRequestOptions() {
  if (!summaryThinkingEnabled()) {
    return { thinking: { type: "disabled" } };
  }
  const options = { thinking: { type: "enabled" } };
  if (REASONING_SUMMARY_REASONING_EFFORT) {
    options.reasoning_effort = REASONING_SUMMARY_REASONING_EFFORT;
  }
  return options;
}

async function createReasoningDisplaySummary({ rawReasoningContent, toolCalls, requestBody, trace, client }) {
  const hasToolCalls = hasReasoningSummaryToolCalls(toolCalls);
  if (shouldEmitMockSummaryForTools(toolCalls)) {
    const displaySummary = formatCodexVisibleReasoningSummary(MOCK_REASONING_SUMMARY, {
      toolCalls,
      title: "Codex DeepSeek mock summary",
    });
    traceLog("reasoning_display_summary_mock", {
      traceId: trace?.traceId || null,
      clientId: client?.id || null,
      summaryChars: displaySummary.length,
      toolCalls: (toolCalls || []).length,
    });
    return displaySummary;
  }
  if (REASONING_DISPLAY === "none") return "";
  if (REASONING_DISPLAY === "status") {
    const tc = (toolCalls || []).map(t=>toolCallDisplayName(t)||"unknown").join(", ");
    return formatCodexVisibleReasoningSummary(
      tc ? `准备使用工具：${tc}` : `整理执行思路（${(rawReasoningContent||"").length} 字符）`,
      { toolCalls, title: codexReasoningSummaryTitle(toolCalls, "整理执行思路") },
    );
  }
  if (REASONING_DISPLAY === "raw") {
    return formatCodexVisibleReasoningSummary(
      truncateText(rawReasoningContent, REASONING_SUMMARY_MAX_RAW_CHARS),
      { toolCalls, title: codexReasoningSummaryTitle(toolCalls, "原始推理") },
    );
  }
  if (!hasToolCalls) {
    traceLog("reasoning_display_summary_skipped_no_tool_call", {
      traceId: trace?.traceId || null,
      clientId: client?.id || null,
      rawChars: (rawReasoningContent || "").length,
    });
    return "";
  }
  if (!rawReasoningContent || !rawReasoningContent.trim()) return "";
  const tcs = (toolCalls || []).map(t=>({
    name: toolCallDisplayName(t) || "unknown",
    arguments_summary: truncateText(String(t.arguments || t.function?.arguments || "{}"), REASONING_SUMMARY_MAX_TOOL_ARG_CHARS),
  }));
  const lastUser = (()=>{ const inp=requestBody?.input; if(typeof inp==="string") return inp; if(Array.isArray(inp)){ const l=inp[inp.length-1]; if(l?.content?.[0]?.text) return l.content[0].text; if(typeof l?.content==="string") return l.content; } return ""; })();
  const summaryInput = JSON.stringify({ raw_reasoning_content: truncateText(rawReasoningContent, REASONING_SUMMARY_MAX_RAW_CHARS), tool_calls: tcs, latest_user_request: truncateText(lastUser, 500) });
  const summaryPrompt =
    "请根据输入包生成 Codex CLI 工具调用前显示的进展摘要。\n" +
    "必须只输出简体中文，并严格使用下面的 Markdown 形态：\n" +
    "**动作标题**\n\n" +
    "- 当前事项：说明即将处理的具体任务和原因。\n" +
    "- 依据线索：说明已知约束、用户要求、文件线索或工具参数的高层摘要。\n" +
    "- 下一步：说明即将调用工具要验证、读取、修改或执行什么。\n\n" +
    "要求：\n" +
    "- 只使用简体中文；工具名、文件名、配置项、代码标识可以保留原文。\n" +
    "- 采用事项导向表达，不使用第一人称，也不要写“助手”“模型”“the assistant”“I”“we”。\n" +
    "- 必须输出完整标题和完整三条 bullet；每条 bullet 都要是完整句子，不能输出空 bullet 或半截 bullet。\n" +
    "- 保留足够逻辑，让用户知道为什么要调用工具、准备用工具确认什么，不要只复述工具名。\n" +
    "- 不要复制完整命令、完整文件内容、密钥、长参数或隐藏推理原文。\n" +
    "- 除非输入明确说明结果已经发生，否则不要声称工具已成功、补丁已应用或测试已通过。\n" +
    "- 将推理综合成用户可见的操作摘要；不要逐字暴露 hidden chain-of-thought。\n" +
    "- 不要调用工具，不要在 Markdown 摘要之外添加任何文字。\n\n" +
    `Input package: ${summaryInput}`;
  const chatReq = {
    model: REASONING_SUMMARY_MODEL,
    messages: [
      { role: "system", content: "你只编写 Codex CLI 用户可见的简体中文工具调用前摘要。摘要必须事项导向、逻辑清楚，并且不能逐字泄露隐藏推理。" },
      { role: "user", content: summaryPrompt },
    ],
    stream: false, max_tokens: REASONING_SUMMARY_MAX_TOKENS, temperature: 0,
    ...summaryChatRequestOptions(),
  };
  try {
    const upstream = upstreamForMode();
    const result = await fetchSummaryChatCompletion(upstream, chatReq, REASONING_SUMMARY_TIMEOUT_MS);
    if (result.ok && result.json) {
      const content = result.json.choices?.[0]?.message?.content || "";
      const summary = formatCodexVisibleReasoningSummary(normalizeSummaryText(content), {
        toolCalls,
        title: codexReasoningSummaryTitle(toolCalls),
      });
      if (summary) {
        traceLog("reasoning_display_summary_created", { traceId: trace?.traceId||null, clientId: client?.id||null, responseId: uid("reasoning_summary_chat"), model: result.json.model||REASONING_SUMMARY_MODEL, rawChars: (rawReasoningContent||"").length, summaryChars: summary.length, toolCalls: tcs.length });
        return summary;
      }
    }
  } catch(e) { bridgeLog("reasoning summary failed", { error: e.message }); }
  const tc2 = (toolCalls||[]).map(t=>toolCallDisplayName(t)||"unknown").join(", ");
  const fallbackSummary = tc2 ? `规划工具调用：${tc2}` : ((rawReasoningContent||"").length > 0 ? `整理执行思路（${(rawReasoningContent||"").length} 字符）` : "");
  return formatCodexVisibleReasoningSummary(fallbackSummary, {
    toolCalls,
    title: codexReasoningSummaryTitle(toolCalls),
  });
}

function createBridgeServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === "GET" && url.pathname === "/health") {
        const authClients = allAuthClients();
        sendJson(res, 200, {
          status: "ok",
          mode: UPSTREAM_MODE,
          upstream_base_url: DEEPSEEK_BASE_URL,
          reasoning_summary_mode: REASONING_SUMMARY_MODE || "v4flash",
          mock_reasoning_summary: isMockReasoningSummaryMode() ? MOCK_REASONING_SUMMARY : null,
          reasoning_summary_model: REASONING_SUMMARY_MODEL,
          reasoning_summary_thinking: summaryThinkingEnabled() ? "enabled" : "disabled",
          reasoning_summary_reasoning_effort: summaryThinkingEnabled() ? REASONING_SUMMARY_REASONING_EFFORT : null,
          reasoning_summary_max_tokens: REASONING_SUMMARY_MAX_TOKENS,
          tool_summary_surface: TOOL_SUMMARY_SURFACE || "reasoning",
          registry_enabled: Boolean(PROXY_KEYS_FILE),
          uptime_sec: Math.floor((Date.now() - START_TIME) / 1000),
          trace_enabled: TRACE_ENABLED,
          max_request_bytes: BRIDGE_MAX_REQUEST_BYTES,
          retry_count: UPSTREAM_RETRY_COUNT,
          timeout_ms: UPSTREAM_TIMEOUT_MS,
          auth_clients: authClients.length,
          active_clients: clientState.size,
          clients: authClients.map(publicClientInfo),
          completion: {
            responses: completionMetrics.responses,
            terminal_kinds: completionMetrics.terminal_kinds,
            last: completionMetrics.last,
          },
          reasoning_audit: {
            requests: reasoningMetrics.requests,
            thinking_enabled: reasoningMetrics.thinking_enabled,
            thinking_disabled: reasoningMetrics.thinking_disabled,
            downgraded: reasoningMetrics.downgraded,
            policies: reasoningMetrics.policies,
            events: reasoningMetrics.events,
            upstream_missing_reasoning: reasoningMetrics.upstream_missing_reasoning,
            upstream_repaired: reasoningMetrics.upstream_repaired,
            upstream_retried: reasoningMetrics.upstream_retried,
            upstream_retry_recovered: reasoningMetrics.upstream_retry_recovered,
            upstream_synthesized_after_retries: reasoningMetrics.upstream_synthesized_after_retries,
            codex_history_repaired: reasoningMetrics.codex_history_repaired,
            codex_missing_reasoning_total: reasoningMetrics.codex_missing_reasoning_total,
            deepseek_missing_reasoning_total: reasoningMetrics.deepseek_missing_reasoning_total,
            last_request: reasoningMetrics.last_request,
            last_downgrade: reasoningMetrics.last_downgrade,
            audit_log: REASONING_AUDIT_LOG,
            audit_text_log: REASONING_AUDIT_TEXT_LOG,
            summary_file: REASONING_SUMMARY_JSON,
            reasoning_store: REASONING_STORE_FILE,
          },
          compact: {
            preflight_checked: compactMetrics.preflight_checked,
            preflight_skipped: compactMetrics.preflight_skipped,
            preflight_created: compactMetrics.preflight_created,
            endpoint_requests: compactMetrics.endpoint_requests,
            endpoint_created: compactMetrics.endpoint_created,
            active_chain_replacements: compactMetrics.active_chain_replacements,
            resolved: compactMetrics.resolved,
            unknown_external: compactMetrics.unknown_external,
            missing_store: compactMetrics.missing_store,
            summary_failed: compactMetrics.summary_failed,
            events: compactMetrics.events,
            last_compact: compactMetrics.last_compact,
            last_usage: compactMetrics.last_usage,
            trigger_tokens: BRIDGE_COMPACT_TRIGGER_TOKENS,
            target_tokens: BRIDGE_COMPACT_TARGET_TOKENS,
            tail_tokens: BRIDGE_COMPACT_TAIL_TOKENS,
            audit_log: COMPACT_AUDIT_LOG,
            audit_text_log: COMPACT_AUDIT_TEXT_LOG,
            summary_file: COMPACT_SUMMARY_JSON,
            compaction_store: COMPACTION_STORE_FILE,
          },
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
      if (req.method === "POST" && (url.pathname === "/v1/responses/compact" || url.pathname === "/responses/compact")) {
        await handleResponsesCompact(req, res);
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

function chooseMockTool(tools = [], toolChoice = null) {
  const candidates = tools
    .filter((tool) => tool.type === "function" && tool.function?.name)
    .map((tool) => tool.function);
  if (candidates.length === 0) return null;
  const chosenName = toolChoice?.type === "function" ? toolChoice.function?.name : "";
  if (chosenName) {
    const chosen = candidates.find((tool) => tool.name === chosenName);
    if (chosen) return chosen;
  }
  const forcedName = process.env.MOCK_FORCE_TOOL_NAME || "";
  if (forcedName) {
    const forced = candidates.find((tool) => tool.name === forcedName || new RegExp(forcedName, "i").test(tool.name));
    if (forced) return forced;
  }
  return (
    candidates.find((tool) => /shell|command|exec|terminal|run/i.test(tool.name)) ||
    candidates.find((tool) => /tool_search/i.test(tool.name)) ||
    candidates.find((tool) => /search/i.test(tool.name)) ||
    candidates.find((tool) => !/apply_patch|patch/i.test(tool.name)) ||
    candidates[0]
  );
}

function argsForTool(tool, commandTextOverride = null) {
  const schema = tool?.parameters || {};
  const properties = schema.properties || {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const args = {};
  const commandText = commandTextOverride || "echo CODEX_DEEPSEEK_TOOL_OK";

  if (properties.command) args.command = commandText;
  if (properties.cmd) args.cmd = commandText;
  if (properties.query) args.query = "CODEX_DEEPSEEK_TOOL_SEARCH_QUERY";
  if (properties.max_results) args.max_results = 3;
  if (properties.limit) args.limit = 3;

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
  const promptTokens = Math.max(0, MOCK_PROMPT_TOKENS);
  const completionTokens = Math.max(0, MOCK_COMPLETION_TOKENS);
  return {
    id: uid("chatcmpl"),
    object: "chat.completion",
    created: unixNow(),
    model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

function writeChatSse(res, chunk) {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

function mockUsage() {
  const promptTokens = Math.max(0, MOCK_PROMPT_TOKENS);
  const completionTokens = Math.max(0, MOCK_COMPLETION_TOKENS);
  return { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens };
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

function chatMessageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part === "string" ? part : part?.text || ""))
    .join("\n");
}

function mockRequestText(body) {
  return (body.messages || []).map(chatMessageText).join("\n");
}

function mockHasRepairInstruction(body) {
  return /Bridge protocol requirement: thinking mode is enabled/i.test(mockRequestText(body));
}

function mockToolCallMessage(tool, callId, args, reasoningContent = "phase1 mock reasoning") {
  const message = {
    role: "assistant",
    content: null,
    tool_calls: [{
      id: callId,
      type: "function",
      function: { name: tool.name, arguments: args },
    }],
  };
  if (reasoningContent !== null) message.reasoning_content = reasoningContent;
  return message;
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
    const tool = chooseMockTool(body.tools || [], body.tool_choice);
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

  if (fault === "missing-reasoning-tool") {
    const tool = chooseMockTool(body.tools || [], body.tool_choice);
    if (!tool) {
      sendJson(res, 200, chatResponseJson(model, { role: "assistant", content: mockText() }, "stop"));
      return true;
    }
    sendJson(res, 200, chatResponseJson(model, mockToolCallMessage(tool, uid("call"), argsForTool(tool), null), "tool_calls"));
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

  const requestText = mockRequestText(body);
  if (/Create a continuation summary for a coding agent/i.test(requestText)) {
    const summary = `MOCK_COMPACT_SUMMARY items=${(requestText.match(/\n\[/g) || []).length}`;
    sendJson(res, 200, chatResponseJson(model, { role: "assistant", content: summary }, "stop"));
    return;
  }

  if (/MOCK_REASONING_DETAILS/i.test(requestText)) {
    if (stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      writeChatSse(res, {
        id: uid("chatcmpl"),
        object: "chat.completion.chunk",
        created: unixNow(),
        model,
        choices: [{ index: 0, delta: { role: "assistant", reasoning_details: [{ text: "phase1 mock reasoning details" }] }, finish_reason: null }],
      });
      writeChatSse(res, {
        id: uid("chatcmpl"),
        object: "chat.completion.chunk",
        created: unixNow(),
        model,
        choices: [{ index: 0, delta: { content: "reasoning details visible answer" }, finish_reason: null }],
      });
      writeChatSse(res, {
        id: uid("chatcmpl"),
        object: "chat.completion.chunk",
        created: unixNow(),
        model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: mockUsage(),
      });
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    sendJson(res, 200, chatResponseJson(model, {
      role: "assistant",
      content: "reasoning details visible answer",
      reasoning_details: [{ text: "phase1 mock reasoning details" }],
    }, "stop"));
    return;
  }

  if (/MOCK_INLINE_THINK/i.test(requestText)) {
    if (stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      for (const part of ["<think>\nphase1 ", "mock inline think\n</think>\n\n", "inline visible ", "answer"]) {
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
        usage: mockUsage(),
      });
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    sendJson(res, 200, chatResponseJson(model, {
      role: "assistant",
      content: "<think>\nphase1 mock inline think\n</think>\n\ninline visible answer",
    }, "stop"));
    return;
  }

  const hasForcedToolChoice = body.tool_choice?.type === "function" && body.tool_choice?.function?.name;
  if (hasToolMessage(body.messages) && !hasForcedToolChoice) {
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
      usage: mockUsage(),
    });
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  const tool = chooseMockTool(body.tools || [], body.tool_choice);
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
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    });
    const parts = ["No callable function tool was exposed. ", "CODEX_DEEPSEEK_", "PHASE1_", "DONE"];
    for (const part of parts) {
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
      usage: mockUsage(),
    });
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  const callId = uid("call");
  const wantsMissingReasoning = /MOCK_UPSTREAM_MISSING_REASONING/i.test(requestText);
  const wantsReadOnlyMissing = /MOCK_UPSTREAM_MISSING_REASONING_READONLY/i.test(requestText);
  const stubbornMissing = /MOCK_UPSTREAM_MISSING_REASONING_ALWAYS/i.test(requestText);
  const repairInstruction = mockHasRepairInstruction(body);
  const args = argsForTool(tool, wantsReadOnlyMissing ? "Get-Content README.md" : null);
  mockLog("returning tool_call", { tool: tool.name, args });

  if (wantsMissingReasoning && (!repairInstruction || stubbornMissing)) {
    if (!stream) {
      sendJson(res, 200, chatResponseJson(
        model,
        mockToolCallMessage(tool, callId, args, null),
        "tool_calls",
      ));
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
    const midpointForMissing = Math.max(1, Math.floor(args.length / 2));
    for (const part of [args.slice(0, midpointForMissing), args.slice(midpointForMissing)]) {
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
      usage: mockUsage(),
    });
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

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
    usage: mockUsage(),
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
  retryCount: UPSTREAM_RETRY_COUNT,
  timeoutMs: UPSTREAM_TIMEOUT_MS,
  timeoutDisabled: !UPSTREAM_TIMEOUT_MS || UPSTREAM_TIMEOUT_MS <= 0,
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
