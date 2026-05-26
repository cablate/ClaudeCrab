// B59 hook payload probe for @anthropic-ai/claude-agent-sdk 0.2.119.
//
// Purpose:
// - Verify actual callback payload shapes in ClaudeCab's patched V2 path.
// - Confirm whether PostToolUse uses `tool_response` or `tool_output`.
// - Confirm whether PostToolUseFailure, PostToolBatch, and FileChanged fire.
//
// Privacy:
// - Records metadata only: keys, types, lengths, tool names, ids.
// - Does not persist raw prompts, command output, file contents, or tool results.
//
// Run:
//   node docs/upgrades/tests/test-hook-payload-v0.2.119.mjs
//   $env:B59_SDK_MODULE='.cache/b59-sdk-patch-lab-YYYYMMDD-HHMMSS/claude-agent-sdk/sdk.mjs'; node docs/upgrades/tests/test-hook-payload-v0.2.119.mjs
//   $env:B59_PRETOOL_DECISION='none'; node docs/upgrades/tests/test-hook-payload-v0.2.119.mjs
//   $env:B59_ALLOWED_TOOLS='none'; node docs/upgrades/tests/test-hook-payload-v0.2.119.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const probeRoot = path.join(repoRoot, '.cache', 'b59-hook-payload');
const resultPath = path.join(probeRoot, 'result.json');
const writeTarget = path.join(probeRoot, 'b59-filechanged.txt');
const cliPath =
  process.env.CLAUDE_CLI_PATH?.trim() ||
  'C:/Users/User/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code-win32-x64/claude.exe';
const sdkModuleInput = process.env.B59_SDK_MODULE?.trim();
const sdkModule = sdkModuleInput
  ? await import(pathToFileURL(path.resolve(repoRoot, sdkModuleInput)).href)
  : await import('@anthropic-ai/claude-agent-sdk');
const { unstable_v2_createSession } = sdkModule;
const preToolDecision = process.env.B59_PRETOOL_DECISION?.trim() ?? 'allow';
const allowedToolsMode = process.env.B59_ALLOWED_TOOLS?.trim() ?? 'allow';
const allowedTools = allowedToolsMode === 'none' ? undefined : ['Bash', 'Write'];

await fs.mkdir(probeRoot, { recursive: true });
await fs.rm(resultPath, { force: true });
await fs.rm(writeTarget, { force: true });

const events = [];

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function summarizeValue(value) {
  const t = typeOf(value);
  if (t === 'string') return { type: t, length: value.length };
  if (t === 'array') return { type: t, length: value.length };
  if (t === 'object') return { type: t, keys: Object.keys(value).sort() };
  return { type: t };
}

function summarizeHookInput(input, toolUseID) {
  const obj = input && typeof input === 'object' ? input : {};
  const toolInput = obj.tool_input;
  const toolResponse = obj.tool_response;
  const toolOutput = obj.tool_output;
  const toolCalls = obj.tool_calls;

  return {
    event: obj.hook_event_name,
    toolUseID,
    topKeys: Object.keys(obj).sort(),
    sessionIdPresent: typeof obj.session_id === 'string' && obj.session_id.length > 0,
    cwdPresent: typeof obj.cwd === 'string' && obj.cwd.length > 0,
    transcriptPathPresent: typeof obj.transcript_path === 'string' && obj.transcript_path.length > 0,
    agentIdPresent: typeof obj.agent_id === 'string' && obj.agent_id.length > 0,
    agentTypePresent: typeof obj.agent_type === 'string' && obj.agent_type.length > 0,
    toolName: obj.tool_name,
    toolInput: summarizeValue(toolInput),
    hasToolResponse: Object.prototype.hasOwnProperty.call(obj, 'tool_response'),
    toolResponse: summarizeValue(toolResponse),
    hasToolOutput: Object.prototype.hasOwnProperty.call(obj, 'tool_output'),
    toolOutput: summarizeValue(toolOutput),
    error: summarizeValue(obj.error),
    durationMs: obj.duration_ms,
    filePathPresent: typeof obj.file_path === 'string' && obj.file_path.length > 0,
    fileEvent: obj.event,
    toolCalls: Array.isArray(toolCalls)
      ? toolCalls.map(call => ({
          toolName: call?.tool_name,
          toolUseIDPresent: typeof call?.tool_use_id === 'string' && call.tool_use_id.length > 0,
          toolInput: summarizeValue(call?.tool_input),
          hasToolResponse: Object.prototype.hasOwnProperty.call(call ?? {}, 'tool_response'),
          toolResponse: summarizeValue(call?.tool_response),
        }))
      : summarizeValue(toolCalls),
  };
}

function record(input, toolUseID) {
  const summary = summarizeHookInput(input, toolUseID);
  events.push(summary);
  console.log('[hook]', JSON.stringify(summary));
}

const hook = async (input, toolUseID) => {
  record(input, toolUseID);

  if (input?.hook_event_name === 'PreToolUse' && preToolDecision === 'allow') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'B59 hook payload probe auto-allow',
      },
    };
  }

  if (input?.hook_event_name === 'SessionStart') {
    return {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        watchPaths: [probeRoot],
      },
    };
  }

  if (input?.hook_event_name === 'FileChanged') {
    return {
      hookSpecificOutput: {
        hookEventName: 'FileChanged',
        watchPaths: [probeRoot],
      },
    };
  }

  return {};
};

console.log('[b59] repoRoot:', repoRoot);
console.log('[b59] probeRoot:', probeRoot);
console.log('[b59] cliPath:', cliPath);
console.log('[b59] sdkModule:', sdkModuleInput || '@anthropic-ai/claude-agent-sdk');
console.log('[b59] preToolDecision:', preToolDecision);
console.log('[b59] allowedToolsMode:', allowedToolsMode);

const session = unstable_v2_createSession({
  pathToClaudeCodeExecutable: cliPath,
  cwd: probeRoot,
  model: process.env.B59_MODEL ?? 'haiku',
  settingSources: [],
  maxTurns: 8,
  tools: ['Bash', 'Write'],
  ...(allowedTools ? { allowedTools } : {}),
  canUseTool: async (toolName, input, options) => {
    events.push({
      event: 'canUseTool',
      toolName,
      toolUseIDPresent: typeof options?.toolUseID === 'string' && options.toolUseID.length > 0,
      input: summarizeValue(input),
      inputKeys: input && typeof input === 'object' ? Object.keys(input).sort() : [],
    });
    return {
      behavior: 'allow',
      updatedInput: input,
      toolUseID: options.toolUseID,
    };
  },
  hooks: {
    SessionStart: [{ matcher: '', hooks: [hook], timeout: 30 }],
    PreToolUse: [{ matcher: '', hooks: [hook], timeout: 30 }],
    PostToolUse: [{ matcher: '', hooks: [hook], timeout: 30 }],
    PostToolUseFailure: [{ matcher: '', hooks: [hook], timeout: 30 }],
    PostToolBatch: [{ matcher: '', hooks: [hook], timeout: 30 }],
    FileChanged: [{ matcher: '', hooks: [hook], timeout: 30 }],
  },
  systemPrompt: {
    type: 'preset',
    preset: 'claude_code',
    append: [
      'You are running a deterministic SDK hook payload probe.',
      'Do not inspect the repository.',
      'Use only the allowed Bash and Write tools.',
      'Do not include command outputs in your final answer.',
      'Complete these steps:',
      '1. Run Bash command: node -e "console.log(\'B59_SUCCESS\')"',
      '2. Run Bash command: node -e "process.exit(7)"',
      `3. Use Write to create this exact file: ${writeTarget}`,
      '4. The file content should be: B59_FILE_CHANGED',
      '5. Final answer must be exactly: B59_DONE',
    ].join('\n'),
  },
});

let sawResult = false;
let assistantText = '';
const startedAt = Date.now();
const timeoutMs = Number(process.env.B59_TIMEOUT_MS ?? 90_000);

try {
  await session.send([
    'Run the B59 hook payload probe now.',
    'You must use tools. Do not merely describe the steps.',
    'Use Bash for this exact command: node -e "console.log(\'B59_SUCCESS\')"',
    'Then use Bash for this exact command: node -e "process.exit(7)"',
    `Then use Write to create this exact file: ${writeTarget}`,
    'The file content must be exactly: B59_FILE_CHANGED',
    'After all tool calls finish, final answer exactly: B59_DONE',
  ].join('\n'));

  for await (const msg of session.stream()) {
    const elapsed = Date.now() - startedAt;
    console.log('[stream]', JSON.stringify({ elapsedMs: elapsed, type: msg.type, subtype: msg.subtype }));

    if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          assistantText += block.text;
        }
      }
    }

    if (msg.type === 'result') {
      sawResult = true;
      break;
    }

    if (elapsed > timeoutMs) {
      throw new Error(`B59 probe timed out after ${timeoutMs}ms`);
    }
  }
} finally {
  session.close();
}

const result = {
  sdkVersion: '0.2.119',
  sawResult,
  assistantTextLength: assistantText.length,
  assistantTextHasDoneMarker: assistantText.includes('B59_DONE'),
  eventCount: events.length,
  events,
  observed: {
    canUseTool: events.some(e => e.event === 'canUseTool'),
    sessionStart: events.some(e => e.event === 'SessionStart'),
    preToolUse: events.some(e => e.event === 'PreToolUse'),
    postToolUse: events.some(e => e.event === 'PostToolUse'),
    postToolUseHasToolResponse: events.some(e => e.event === 'PostToolUse' && e.hasToolResponse),
    postToolUseHasToolOutput: events.some(e => e.event === 'PostToolUse' && e.hasToolOutput),
    postToolUseFailure: events.some(e => e.event === 'PostToolUseFailure'),
    postToolBatch: events.some(e => e.event === 'PostToolBatch'),
    fileChanged: events.some(e => e.event === 'FileChanged'),
  },
};

await fs.writeFile(resultPath, JSON.stringify(result, null, 2), 'utf8');

console.log('[b59] resultPath:', resultPath);
console.log('[b59] observed:', JSON.stringify(result.observed, null, 2));

if (!result.observed.postToolUse) {
  console.error('[b59] FAIL: PostToolUse did not fire.');
  process.exit(2);
}

if (!result.observed.postToolUseHasToolResponse) {
  console.error('[b59] FAIL: PostToolUse fired but did not include tool_response.');
  process.exit(3);
}

console.log('[b59] PASS: PostToolUse payload includes tool_response.');
