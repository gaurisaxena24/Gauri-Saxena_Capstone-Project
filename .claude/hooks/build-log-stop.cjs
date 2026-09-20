#!/usr/bin/env node
// Stop hook: appends one line per Claude Code turn to the end of BUILD_LOG.md (its "Automatic
// per-turn token usage log" section) with the actual token usage for that turn, read from the
// session transcript.
//
// Why dedup by response id: Claude Code's transcript writes one JSONL line
// per CONTENT BLOCK of a single API response (one line for a thinking block,
// one for the text block, one per tool_use block, etc). Every one of those
// lines repeats the *same* `message.usage` object for that whole response.
// Summing usage across all lines therefore multiplies each response's real
// token count by however many content blocks it had. To get the true count
// we sum usage once per unique response id (message.id, falling back to
// requestId, falling back to uuid) and ignore repeats.
'use strict';

const fs = require('fs');
const path = require('path');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function timestamp(date) {
  const now = date || new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

// Sums cache-creation tokens whether the transcript reports them as a flat
// `cache_creation_input_tokens` field or only as a nested `cache_creation`
// object ({ephemeral_1h_input_tokens, ephemeral_5m_input_tokens, ...}) —
// transcript shape has changed before and may change again.
function cacheCreationTokens(usage) {
  if (typeof usage.cache_creation_input_tokens === 'number') {
    return usage.cache_creation_input_tokens;
  }
  const cc = usage.cache_creation;
  if (cc && typeof cc === 'object') {
    return Object.values(cc).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
  }
  return 0;
}

function extractUsage(entry) {
  // Normal shape: {type: "assistant", message: {id, usage: {...}}}
  // Defensive fallback for a hypothetical flatter shape: {type: "assistant", usage: {...}}
  if (!entry || entry.type !== 'assistant') return null;
  const usage = (entry.message && entry.message.usage) || entry.usage;
  if (!usage || typeof usage !== 'object') return null;
  const id = (entry.message && entry.message.id) || entry.requestId || entry.uuid;
  return { id, usage };
}

// Reads a slice of raw JSONL lines (strings) and returns the deduplicated
// token summary for that slice. Exported so both this hook and manual
// backfill/audit work (e.g. by super-agent, this project's one agent) use one
// authoritative implementation instead of a second copy of the math.
function summarizeUsage(rawLines) {
  const seen = new Map(); // response id -> usage object
  let assistantLineCount = 0;

  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || entry.type !== 'assistant') continue;
    assistantLineCount++;
    const extracted = extractUsage(entry);
    if (!extracted || !extracted.id) continue;
    if (!seen.has(extracted.id)) seen.set(extracted.id, extracted.usage);
  }

  let inputTokens = 0;
  let outputTokens = 0;
  for (const usage of seen.values()) {
    inputTokens += (usage.input_tokens || 0) + cacheCreationTokens(usage) + (usage.cache_read_input_tokens || 0);
    outputTokens += usage.output_tokens || 0;
  }

  return {
    uniqueResponses: seen.size,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    hadAssistantActivity: assistantLineCount > 0,
    hadUsageData: seen.size > 0,
  };
}

function formatEntry(summary, date) {
  const stamp = timestamp(date);
  if (!summary.hadUsageData) {
    return `- ${stamp} - unknown tokens (transcript had assistant activity but no usage data)\n`;
  }
  return `- ${stamp} - ${summary.totalTokens} tokens (input: ${summary.inputTokens}, output: ${summary.outputTokens})\n`;
}

function runHook() {
  let input = {};
  try {
    input = JSON.parse(readStdin() || '{}');
  } catch {
    return;
  }

  const transcriptPath = input.transcript_path;
  const sessionId = input.session_id || 'unknown';
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return;

  const repoRoot = path.resolve(__dirname, '..', '..');
  const stateDir = path.join(repoRoot, '.claude', 'build-log-state');
  fs.mkdirSync(stateDir, { recursive: true });
  const stateFile = path.join(stateDir, `${sessionId}.txt`);

  let lastLine = 0;
  if (fs.existsSync(stateFile)) {
    const parsed = parseInt(fs.readFileSync(stateFile, 'utf8').trim(), 10);
    if (!Number.isNaN(parsed)) lastLine = parsed;
  }

  const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
  if (lines.length <= lastLine) return; // nothing new since the last run — never double count

  const newLines = lines.slice(lastLine);
  fs.writeFileSync(stateFile, String(lines.length));

  const summary = summarizeUsage(newLines);
  if (!summary.hadAssistantActivity) return; // Stop fired with no new model turn (e.g. a no-op) — nothing to log

  // BUILD_LOG.md is the single canonical build log (merged from the old, separate build-log.md on
  // 2026-09-20 — see the "Automatic per-turn token usage log" section at the end of that file).
  // This hook only ever appends, and that section is deliberately kept last in the file so a plain
  // end-of-file append always lands in the right place.
  const buildLogPath = path.join(repoRoot, 'BUILD_LOG.md');
  if (!fs.existsSync(buildLogPath)) {
    fs.writeFileSync(buildLogPath, '## Automatic per-turn token usage log\n\n');
  }
  fs.appendFileSync(buildLogPath, formatEntry(summary));
}

if (require.main === module) {
  runHook();
}

module.exports = { summarizeUsage, formatEntry, extractUsage, cacheCreationTokens, timestamp };
