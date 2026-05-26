export type GovernanceSeverity = 'info' | 'warn' | 'action_required';

export type GovernancePathCategory =
  | 'project_card'
  | 'project_plan'
  | 'layer_contract'
  | 'foundation_policy'
  | 'foundation_checklist'
  | 'foundation_hook'
  | 'hook_prompt'
  | 'foundation_skill'
  | 'local_skill'
  | 'startup_context'
  | 'memory_note'
  | 'validator'
  | 'runtime_source'
  | 'output_uploads'
  | 'archive'
  | 'unknown';

export type GovernanceRecommendedCheck =
  | 'agent-workspace-validator'
  | 'typecheck'
  | 'test'
  | 'manual-review'
  | 'none';

export interface GovernancePathClassification {
  readonly category: GovernancePathCategory;
  readonly normalizedPath: string;
  readonly governed: boolean;
  readonly validatorRelevant: boolean;
  readonly recommendedCheck: GovernanceRecommendedCheck;
}

export interface GovernanceTelemetryEvent {
  readonly eventType: string;
  readonly severity: GovernanceSeverity;
  readonly category: GovernancePathCategory;
  readonly count?: number;
  readonly threshold?: number;
  readonly path?: string;
  readonly recommendation?: string;
}

export interface GovernanceSessionSummary {
  readonly changedCategories: GovernancePathCategory[];
  readonly recommendedChecks: GovernanceRecommendedCheck[];
  readonly touchedPathCount: number;
  readonly validatorNeeded: boolean;
  readonly validatorObserved: boolean;
  readonly commandFailureCount: number;
  readonly broadSearchCount: number;
  /** Exploration performed by the main assistant context. */
  readonly explorationToolCounts: Record<string, number>;
  /** Exploration performed inside SDK subagents. Informational only. */
  readonly subagentExplorationToolCounts: Record<string, number>;
  /** Main-context tool output size telemetry. */
  readonly explorationOutputChars: Record<string, number>;
  /** Subagent tool output size telemetry. Informational only. */
  readonly subagentExplorationOutputChars: Record<string, number>;
  readonly largeToolResponseCounts: Record<string, number>;
  readonly scoutDelegationCount: number;
  readonly archiveAccessCount: number;
  /**
   * True when this turn produced enough durable state/activity signals that
   * the assistant must make an explicit memory-routing decision before answering.
   * This is not the same as "memory write is mandatory".
   */
  readonly memoryCheckpointNeeded: boolean;
  /** True when this turn touched vector/file memory destinations. */
  readonly memoryObserved: boolean;
  /** True when this turn touched dated daily memory under agents/<role>/memory/. */
  readonly dailyMemoryObserved: boolean;
  readonly actionRequired: boolean;
}

export interface GovernanceSessionState {
  readonly changedCategories: Set<GovernancePathCategory>;
  readonly touchedPaths: GovernancePathClassification[];
  readonly visibleEventKeys: Set<string>;
  validatorNeeded: boolean;
  validatorObserved: boolean;
  commandFailureCount: number;
  broadSearchCount: number;
  explorationToolCounts: Record<string, number>;
  subagentExplorationToolCounts: Record<string, number>;
  explorationOutputChars: Record<string, number>;
  subagentExplorationOutputChars: Record<string, number>;
  largeToolResponseCounts: Record<string, number>;
  scoutDelegationCount: number;
  archiveAccessCount: number;
  memoryObserved: boolean;
  dailyMemoryObserved: boolean;
  memoryTouchCount: number;
  summaryLogged: boolean;
}

const AGENT_SEGMENT = '(general|coder)';
const AGENT_LAYER_SEGMENT = '(projects|plans|knowledge|output|uploads|memory|schedules)';
const STARTUP_CONTEXT_FILES = new Set([
  'ACTIVE.md',
  'CLAUDE.md',
  'MEMORY.md',
  'USER.md',
  'growth-profile.md',
]);

function normalizeWorkspacePath(rawPath: string): string {
  return rawPath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

function pathResult(
  category: GovernancePathCategory,
  normalizedPath: string,
  recommendedCheck: GovernanceRecommendedCheck,
): GovernancePathClassification {
  return {
    category,
    normalizedPath,
    governed: category !== 'unknown',
    validatorRelevant: recommendedCheck === 'agent-workspace-validator',
    recommendedCheck,
  };
}

export function classifyWorkspacePath(rawPath: string): GovernancePathClassification {
  const normalizedPath = normalizeWorkspacePath(rawPath);

  if (/(^|\/)_archive(\/|$)/.test(normalizedPath)) {
    return pathResult('archive', normalizedPath, 'manual-review');
  }

  if (new RegExp(`^agents/${AGENT_SEGMENT}/projects/[^/]+/README\\.md$`).test(normalizedPath)) {
    return pathResult('project_card', normalizedPath, 'agent-workspace-validator');
  }

  if (new RegExp(`^agents/${AGENT_SEGMENT}/projects/[^/]+/planning/`).test(normalizedPath)) {
    return pathResult('project_plan', normalizedPath, 'agent-workspace-validator');
  }

  if (new RegExp(`^agents/${AGENT_SEGMENT}/${AGENT_LAYER_SEGMENT}/README\\.md$`).test(normalizedPath)) {
    return pathResult('layer_contract', normalizedPath, 'agent-workspace-validator');
  }

  if (new RegExp(`^agents/${AGENT_SEGMENT}/memory/`).test(normalizedPath)) {
    return pathResult('memory_note', normalizedPath, 'none');
  }

  if (normalizedPath === 'agents/_foundation/workspace-policy.md') {
    return pathResult('foundation_policy', normalizedPath, 'agent-workspace-validator');
  }

  if (normalizedPath.startsWith('agents/_foundation/checklists/')) {
    return pathResult('foundation_checklist', normalizedPath, 'agent-workspace-validator');
  }

  if (/^agents\/_foundation\/hooks\/prompts\/[^/]+\.md$/.test(normalizedPath)) {
    return pathResult('hook_prompt', normalizedPath, 'agent-workspace-validator');
  }

  if (normalizedPath.startsWith('agents/_foundation/hooks/')) {
    return pathResult('foundation_hook', normalizedPath, 'agent-workspace-validator');
  }

  if (normalizedPath.startsWith('agents/_foundation/skills/')) {
    return pathResult('foundation_skill', normalizedPath, 'agent-workspace-validator');
  }

  if (new RegExp(`^agents/${AGENT_SEGMENT}/\\.claude/skills/`).test(normalizedPath)) {
    return pathResult('local_skill', normalizedPath, 'agent-workspace-validator');
  }

  const startupMatch = new RegExp(`^agents/${AGENT_SEGMENT}/([^/]+)$`).exec(normalizedPath);
  if (startupMatch?.[2] !== undefined && STARTUP_CONTEXT_FILES.has(startupMatch[2])) {
    return pathResult('startup_context', normalizedPath, 'agent-workspace-validator');
  }

  if (/^scripts\/validate-(agent-workspace|external-repos)\.mjs$/.test(normalizedPath)) {
    return pathResult('validator', normalizedPath, 'agent-workspace-validator');
  }

  if (normalizedPath.startsWith('src/')) {
    return pathResult('runtime_source', normalizedPath, 'typecheck');
  }

  if (new RegExp(`^agents/${AGENT_SEGMENT}/(output|uploads)/`).test(normalizedPath)) {
    return pathResult('output_uploads', normalizedPath, 'none');
  }

  return pathResult('unknown', normalizedPath, 'none');
}

export function isValidatorCommand(command: string): boolean {
  return /\bvalidate:(agent-workspace|external-repos)\b/.test(command) ||
    /\bscripts[\\/](validate-agent-workspace|validate-external-repos)\.mjs\b/.test(command);
}

export function isBroadSearchCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!/^(rg|grep|Get-ChildItem|gci)\b/i.test(trimmed)) return false;
  return !/\s(agents\/(general|coder)|src|scripts|tests|docs|openspec)\b/i.test(trimmed) &&
    !/\s-Path\s+\S+/i.test(trimmed);
}

export function createGovernanceSessionState(): GovernanceSessionState {
  return {
    changedCategories: new Set<GovernancePathCategory>(),
    touchedPaths: [],
    visibleEventKeys: new Set<string>(),
    validatorNeeded: false,
    validatorObserved: false,
    commandFailureCount: 0,
    broadSearchCount: 0,
    explorationToolCounts: {},
    subagentExplorationToolCounts: {},
    explorationOutputChars: {},
    subagentExplorationOutputChars: {},
    largeToolResponseCounts: {},
    scoutDelegationCount: 0,
    archiveAccessCount: 0,
    memoryObserved: false,
    dailyMemoryObserved: false,
    memoryTouchCount: 0,
    summaryLogged: false,
  };
}

function isMemoryPath(rawPathOrCommand: string): boolean {
  const normalized = normalizeWorkspacePath(rawPathOrCommand);
  return new RegExp(`agents/${AGENT_SEGMENT}/memory/`).test(normalized) ||
    new RegExp(`agents/${AGENT_SEGMENT}/(MEMORY|USER)\\.md`).test(normalized) ||
    /\bmemory_store\b/.test(rawPathOrCommand);
}

function isDailyMemoryPath(rawPathOrCommand: string): boolean {
  const normalized = normalizeWorkspacePath(rawPathOrCommand);
  return new RegExp(`agents/${AGENT_SEGMENT}/memory/\\d{4}-\\d{2}-\\d{2}\\.md`).test(normalized) ||
    /\bmemory\/\d{4}-\d{2}-\d{2}\.md\b/.test(normalized);
}

export function extractToolTargetPaths(toolName: string, toolInput: Record<string, unknown>): string[] {
  if (!['Write', 'Edit', 'MultiEdit'].includes(toolName)) return [];

  const pathValue = toolInput.file_path ?? toolInput.filePath;
  return typeof pathValue === 'string' && pathValue.length > 0 ? [pathValue] : [];
}

export function recordPathTouch(
  state: GovernanceSessionState,
  rawPath: string,
): GovernancePathClassification {
  const classification = classifyWorkspacePath(rawPath);
  state.touchedPaths.push(classification);

  if (classification.governed) {
    state.changedCategories.add(classification.category);
  }
  if (classification.validatorRelevant) {
    state.validatorNeeded = true;
  }
  if (classification.category === 'archive') {
    state.archiveAccessCount++;
  }
  if (classification.category === 'memory_note' || isMemoryPath(rawPath)) {
    state.memoryObserved = true;
    state.memoryTouchCount++;
  }
  if (classification.category === 'memory_note' || isDailyMemoryPath(rawPath)) {
    state.dailyMemoryObserved = true;
  }

  return classification;
}

export function recordBashCommand(
  state: GovernanceSessionState,
  command: string,
): { validatorObserved: boolean; broadSearch: boolean } {
  const validatorObserved = isValidatorCommand(command);
  const broadSearch = isBroadSearchCommand(command);

  if (validatorObserved) {
    state.validatorObserved = true;
  }
  if (broadSearch) {
    state.broadSearchCount++;
  }
  if (isMemoryPath(command)) {
    state.memoryObserved = true;
    state.memoryTouchCount++;
  }
  if (isDailyMemoryPath(command)) {
    state.dailyMemoryObserved = true;
  }

  return { validatorObserved, broadSearch };
}

export function recordExplorationTool(state: GovernanceSessionState, toolName: string): number {
  const nextCount = (state.explorationToolCounts[toolName] ?? 0) + 1;
  state.explorationToolCounts[toolName] = nextCount;
  return nextCount;
}

export function recordSubagentExplorationTool(state: GovernanceSessionState, toolName: string): number {
  const nextCount = (state.subagentExplorationToolCounts[toolName] ?? 0) + 1;
  state.subagentExplorationToolCounts[toolName] = nextCount;
  return nextCount;
}

export function getTotalExplorationToolCount(state: GovernanceSessionState): number {
  return Object.values(state.explorationToolCounts).reduce((sum, count) => sum + count, 0);
}

export function getTotalSubagentExplorationToolCount(state: GovernanceSessionState): number {
  return Object.values(state.subagentExplorationToolCounts).reduce((sum, count) => sum + count, 0);
}

export function recordExplorationOutputSize(
  state: GovernanceSessionState,
  toolName: string,
  charCount: number,
  largeThreshold: number,
): { totalChars: number; large: boolean; largeCount: number } {
  const safeCharCount = Math.max(0, Math.trunc(charCount));
  const totalChars = (state.explorationOutputChars[toolName] ?? 0) + safeCharCount;
  state.explorationOutputChars[toolName] = totalChars;

  const large = safeCharCount >= largeThreshold;
  if (large) {
    state.largeToolResponseCounts[toolName] = (state.largeToolResponseCounts[toolName] ?? 0) + 1;
  }

  return {
    totalChars,
    large,
    largeCount: state.largeToolResponseCounts[toolName] ?? 0,
  };
}

export function recordSubagentExplorationOutputSize(
  state: GovernanceSessionState,
  toolName: string,
  charCount: number,
): { totalChars: number } {
  const safeCharCount = Math.max(0, Math.trunc(charCount));
  const totalChars = (state.subagentExplorationOutputChars[toolName] ?? 0) + safeCharCount;
  state.subagentExplorationOutputChars[toolName] = totalChars;

  return { totalChars };
}

export function recordScoutDelegation(state: GovernanceSessionState): number {
  state.scoutDelegationCount++;
  return state.scoutDelegationCount;
}

export function recordCommandFailure(state: GovernanceSessionState): void {
  state.commandFailureCount++;
}

export function summarizeGovernanceSession(state: GovernanceSessionState): GovernanceSessionSummary {
  const recommendedChecks = new Set<GovernanceRecommendedCheck>();
  for (const touchedPath of state.touchedPaths) {
    if (touchedPath.recommendedCheck !== 'none') {
      recommendedChecks.add(touchedPath.recommendedCheck);
    }
  }

  const totalMainExploration = getTotalExplorationToolCount(state);
  const totalSubagentExploration = getTotalSubagentExplorationToolCount(state);
  const totalMainOutputChars = Object.values(state.explorationOutputChars).reduce((sum, count) => sum + count, 0);
  const totalSubagentOutputChars = Object.values(state.subagentExplorationOutputChars).reduce((sum, count) => sum + count, 0);
  const memoryCheckpointNeeded =
    state.changedCategories.size > 0 ||
    state.validatorNeeded ||
    state.commandFailureCount > 0 ||
    state.broadSearchCount > 0 ||
    state.archiveAccessCount > 0 ||
    state.scoutDelegationCount > 0 ||
    totalMainExploration > 0 ||
    totalSubagentExploration > 0 ||
    totalMainOutputChars > 0 ||
    totalSubagentOutputChars > 0;

  return {
    changedCategories: [...state.changedCategories].sort(),
    recommendedChecks: [...recommendedChecks].sort(),
    touchedPathCount: state.touchedPaths.length,
    validatorNeeded: state.validatorNeeded,
    validatorObserved: state.validatorObserved,
    commandFailureCount: state.commandFailureCount,
    broadSearchCount: state.broadSearchCount,
    explorationToolCounts: { ...state.explorationToolCounts },
    subagentExplorationToolCounts: { ...state.subagentExplorationToolCounts },
    explorationOutputChars: { ...state.explorationOutputChars },
    subagentExplorationOutputChars: { ...state.subagentExplorationOutputChars },
    largeToolResponseCounts: { ...state.largeToolResponseCounts },
    scoutDelegationCount: state.scoutDelegationCount,
    archiveAccessCount: state.archiveAccessCount,
    memoryCheckpointNeeded,
    memoryObserved: state.memoryObserved,
    dailyMemoryObserved: state.dailyMemoryObserved,
    actionRequired: state.validatorNeeded && !state.validatorObserved,
  };
}

function formatExplorationCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return 'none';
  return entries.map(([tool, count]) => `${tool}:${count}`).join(', ');
}

function formatCharCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return 'none';
  return entries.map(([tool, count]) => `${tool}:${count}ch`).join(', ');
}

export function buildExecutionQualityContext(summary: GovernanceSessionSummary): string {
  const changedCategories = summary.changedCategories.length > 0
    ? summary.changedCategories.join(', ')
    : 'none';
  const recommendedChecks = summary.recommendedChecks.length > 0
    ? summary.recommendedChecks.join(', ')
    : 'none';
  const validatorStatus = summary.validatorNeeded
    ? summary.validatorObserved ? 'needed_and_observed' : 'needed_but_not_observed'
    : 'not_needed';
  const subagentExplore = formatExplorationCounts(summary.subagentExplorationToolCounts);
  const subagentOutput = formatCharCounts(summary.subagentExplorationOutputChars);

  return [
    'Runtime facts:',
    `changed=${changedCategories}; touched=${summary.touchedPathCount}; checks=${recommendedChecks}; validator=${validatorStatus}; failures=${summary.commandFailureCount}; archive=${summary.archiveAccessCount}; explore=${formatExplorationCounts(summary.explorationToolCounts)}; subExplore=${subagentExplore}; scout=${summary.scoutDelegationCount}; output=${formatCharCounts(summary.explorationOutputChars)}; subOutput=${subagentOutput}; large=${formatExplorationCounts(summary.largeToolResponseCounts)}`,
    'PASS only if missing validator, failures, archive duties, and high-cost exploration concerns are resolved or reported.',
  ].join('\n');
}

export function buildWorkspaceStateContext(summary: GovernanceSessionSummary): string {
  const hasStateDuty = summary.validatorNeeded || summary.archiveAccessCount > 0 || summary.memoryCheckpointNeeded || summary.memoryObserved;
  if (!hasStateDuty) return '';

  const recommendedChecks = summary.recommendedChecks.length > 0
    ? summary.recommendedChecks.join(', ')
    : 'none';
  const validatorStatus = summary.validatorNeeded
    ? summary.validatorObserved ? 'needed_and_observed' : 'needed_but_not_observed'
    : 'not_needed';
  const memoryStatus = summary.memoryCheckpointNeeded
    ? summary.memoryObserved ? 'checkpoint_needed_and_memory_observed' : 'checkpoint_needed_but_not_observed'
    : summary.memoryObserved ? 'memory_observed' : 'not_needed';
  const dailyStatus = summary.dailyMemoryObserved ? 'observed' : 'not_observed';

  return [
    'State facts:',
    `checks=${recommendedChecks}; validator=${validatorStatus}; memory=${memoryStatus}; daily=${dailyStatus}; archive=${summary.archiveAccessCount}`,
    'Before PASS: if memory=checkpoint_needed_but_not_observed, write the smallest useful daily/vector/MEMORY/USER note or reply `No memory update needed: <reason>`.',
    'Before PASS: run/report `npm run validate:agent-workspace -- --warn-only` when validator is needed; archive requires Cab approval + dated reason.',
  ].join('\n');
}

export function buildGovernanceTouchMessage(classification: GovernancePathClassification): string {
  if (classification.category === 'archive') {
    return `archive touched -> Cab approval required: ${classification.normalizedPath}`;
  }

  if (classification.recommendedCheck === 'agent-workspace-validator') {
    return `touched ${classification.category} -> validator required`;
  }

  if (classification.recommendedCheck === 'typecheck') {
    return `touched ${classification.category} -> typecheck recommended`;
  }

  if (classification.recommendedCheck === 'manual-review') {
    return `touched ${classification.category} -> manual review required`;
  }

  return `touched ${classification.category}`;
}

export function buildGovernanceVisibilitySummary(summary: GovernanceSessionSummary): string {
  const changedCategories = summary.changedCategories.length > 0
    ? summary.changedCategories.join(', ')
    : 'none';

  if (summary.actionRequired) {
    return `validator required but not observed: ${changedCategories}`;
  }

  if (summary.validatorNeeded && summary.validatorObserved) {
    return `validator observed: ${changedCategories}`;
  }

  if (summary.archiveAccessCount > 0) {
    return `archive touched -> Cab approval record needed`;
  }

  if (summary.commandFailureCount > 0) {
    return `command failures observed: ${summary.commandFailureCount}`;
  }

  const exploration = formatExplorationCounts(summary.explorationToolCounts);
  if (exploration !== 'none') {
    return `main explore: ${exploration}; scout=${summary.scoutDelegationCount}`;
  }

  const subagentExploration = formatExplorationCounts(summary.subagentExplorationToolCounts);
  if (subagentExploration !== 'none') {
    return `subagent explore: ${subagentExploration}; scout=${summary.scoutDelegationCount}`;
  }

  if (summary.broadSearchCount > 0) {
    return `broad search observed: ${summary.broadSearchCount}`;
  }

  if (summary.memoryCheckpointNeeded && !summary.memoryObserved) {
    return 'memory checkpoint needed but not observed';
  }

  if (summary.touchedPathCount > 0) {
    return `governed changes not required; touched=${summary.touchedPathCount}`;
  }

  return 'no governed changes';
}
