/**
 * Canonical event_type registry ??AI-grepable taxonomy for logs.
 *
 * Rules:
 * 1. Dot-namespaced (`<category>.<event>`). Glob-friendly.
 * 2. snake_case after the dot.
 * 3. Add new events HERE first; don't inline string literals at call sites.
 * 4. Never rename an existing event_type without migrating grep commands
 *    in ops docs.
 *
 * Categories:
 *   adapter.*      per-platform adapter lifecycle
 *   platform.*     platform-side abnormalities
 *   message.*      user message ingestion -> completion
 *   agent.*        Claude agent SDK query
 *   sdk.*          Claude Agent SDK internals (CLI, stream, hooks, diag)
 *   session.*      conversation session state + length-handoff guard
 *   orchestrator.* PlatformOrchestrator lifecycle & dispatch
 *   schedule.*     cron / scheduled job
 *   governance.*   workspace governance (hard blocks + telemetry)
 *   prompt.*       runtime prompt mutation observability
 *   cache.*        AI-query caching observability
 */
export const EventType = {
  // adapter.*
  ADAPTER_INIT_BEGIN: 'adapter.init_begin',
  ADAPTER_INIT_COMPLETE: 'adapter.init_complete',
  ADAPTER_INIT_ERROR: 'adapter.init_error',
  ADAPTER_START_BEGIN: 'adapter.start_begin',
  ADAPTER_STARTED: 'adapter.started',
  ADAPTER_START_ERROR: 'adapter.start_error',
  ADAPTER_STOP_BEGIN: 'adapter.stop_begin',
  ADAPTER_STOP_ERROR: 'adapter.stop_error',
  ADAPTER_DISPOSE_BEGIN: 'adapter.dispose_begin',
  ADAPTER_DISPOSE_COMPLETE: 'adapter.dispose_complete',
  ADAPTER_DISPOSE_ERROR: 'adapter.dispose_error',
  ADAPTER_MESSAGE_INGRESS: 'adapter.message_ingress',
  ADAPTER_MESSAGE_REJECTED: 'adapter.message_rejected',
  ADAPTER_MESSAGE_ERROR: 'adapter.message_error',
  ADAPTER_SEND_ERROR: 'adapter.send_error',

  // platform.*
  PLATFORM_API_ERROR: 'platform.api_error',

  // message.*
  MESSAGE_PROCESSING_START: 'message.processing_start',
  MESSAGE_PROCESSING_COMPLETE: 'message.processing_complete',
  MESSAGE_DUPLICATE_SKIPPED: 'message.duplicate_skipped',
  MESSAGE_RACE_PREVENTED: 'message.race_prevented',
  MESSAGE_ERROR: 'message.error',

  // agent.*
  AGENT_QUERY_COMPLETE: 'agent.query_complete',

  // sdk.* - Claude Agent SDK internals (CLI override, stream orphan handling, diag)
  SDK_CLI_OVERRIDE: 'sdk.cli_override',
  SDK_CLI_BUNDLED: 'sdk.cli_bundled',
  SDK_CLI_RESOLVED: 'sdk.cli_resolved',
  SDK_CLI_MISSING: 'sdk.cli_missing',
  SDK_RATE_LIMIT: 'sdk.rate_limit',          // top-level msg.type === 'rate_limit_event'
  SDK_API_RETRY: 'sdk.api_retry',            // system/api_retry (0.2.77+)
  SDK_MEMORY_RECALL: 'sdk.memory_recall',    // system/memory_recall (0.2.105+)
  SDK_STATUS: 'sdk.status',                  // system/status with status=requesting (0.2.108+)
  SDK_HOOK_STARTED: 'sdk.hook_started',      // system/hook_started (0.2.89+ with includeHookEvents)
  SDK_HOOK_PROGRESS: 'sdk.hook_progress',    // system/hook_progress (0.2.89+)
  SDK_HOOK_RESPONSE: 'sdk.hook_response',    // system/hook_response (0.2.89+)
  SDK_MIRROR_ERROR: 'sdk.mirror_error',      // SDKMirrorErrorMessage (0.2.113+ sessionStore)
  SDK_KEEPALIVE_CACHE_MISS: 'sdk.keepalive_cache_miss', // V2 cache keepalive ping saw 0 cache reads (TTL expired)

  // Callback hook entry markers - SDK programmatic hooks don't emit
  // hook_started/hook_response stream events (those are only for CLI-registered
  // settings.json / plugin hooks). These tell us our JS callbacks actually ran.
  SDK_HOOK_CB_POST_TOOL_USE: 'sdk.hook_cb.post_tool_use',
  SDK_HOOK_CB_POST_TOOL_USE_FAILURE: 'sdk.hook_cb.post_tool_use_failure',
  SDK_HOOK_CB_PRE_COMPACT: 'sdk.hook_cb.pre_compact',

  // session.guard.* - session-length-handoff-guard events
  SESSION_GUARD_TOKEN_LENGTH: 'session.guard_token_length',
  SESSION_GUARD_TOKEN_SWITCH: 'session.guard_token_switch',
  SESSION_GUARD_TOKEN_CONTINUE: 'session.guard_token_continue',
  SESSION_GUARD_CACHE_TTL: 'session.guard_cache_ttl',
  SESSION_GUARD_CACHE_TTL_SWITCH: 'session.guard_cache_ttl_switch',
  SESSION_GUARD_CACHE_TTL_CONTINUE: 'session.guard_cache_ttl_continue',
  SESSION_GUARD_RESUME: 'session.guard_resume',

  // session.*
  SESSION_CREATED: 'session.created',
  SESSION_RESTORED: 'session.restored',
  SESSION_DISPOSED: 'session.disposed',
  SESSION_PURGED: 'session.purged',
  SESSION_STATE_TRANSITION: 'session.state_transition',
  SESSION_DEDUP_EVICTED: 'session.dedup_evicted',
  SESSION_RESTORE_BEGIN: 'session.restore_begin',
  SESSION_RESTORE_SKIPPED: 'session.restore_skipped',
  SESSION_MANAGER_STARTED: 'session.manager_started',
  SESSION_MANAGER_STOPPED: 'session.manager_stopped',
  SESSION_MANAGER_DISPOSED: 'session.manager_disposed',
  SESSION_ERROR: 'session.error',
  SESSION_ADMIN_CLOSE: 'session.admin_close',

  // orchestrator.* - PlatformOrchestrator lifecycle & dispatch
  ORCHESTRATOR_ADAPTER_START: 'orchestrator.adapter_start',
  ORCHESTRATOR_ADAPTER_STOP: 'orchestrator.adapter_stop',
  ORCHESTRATOR_ADAPTER_FAILED: 'orchestrator.adapter_failed',
  ORCHESTRATOR_START_ALL_COMPLETE: 'orchestrator.start_all_complete',
  ORCHESTRATOR_STOP_ALL_COMPLETE: 'orchestrator.stop_all_complete',
  ORCHESTRATOR_NO_ADAPTER: 'orchestrator.no_adapter',

  // schedule.*
  SCHEDULE_FIRED: 'schedule.fired',
  SCHEDULE_ERROR: 'schedule.error',
  SCHEDULE_LOADED: 'schedule.loaded',
  SCHEDULE_SKIPPED: 'schedule.skipped',
  SCHEDULE_MANAGER_STARTED: 'schedule.manager_started',
  SCHEDULE_MANAGER_DISPOSED: 'schedule.manager_disposed',
  SCHEDULE_REGISTERED: 'schedule.registered',
  SCHEDULE_UNREGISTERED: 'schedule.unregistered',
  SCHEDULE_PAUSED: 'schedule.paused',
  SCHEDULE_RESUMED: 'schedule.resumed',
  SCHEDULE_AUTO_PAUSED: 'schedule.auto_paused',
  SCHEDULE_CREATED: 'schedule.created',
  SCHEDULE_DELETED: 'schedule.deleted',
  SCHEDULE_RELOADED: 'schedule.reloaded',
  SCHEDULE_FILE_CHANGE: 'schedule.file_change',
  SCHEDULE_WATCHER_STARTED: 'schedule.watcher_started',
  SCHEDULE_WATCHER_ERROR: 'schedule.watcher_error',

  // governance.* - workspace governance (hard blocks + passive telemetry)
  GOVERNANCE_LARGE_READ: 'governance.large_read',
  GOVERNANCE_HIGH_COST_EXPLORATION: 'governance.high_cost_exploration',
  GOVERNANCE_BROAD_SEARCH: 'governance.broad_search',
  GOVERNANCE_ARCHIVE_PATH_ACCESS: 'governance.archive_path_access',
  GOVERNANCE_COMMAND_FAILURE: 'governance.command_failure',
  GOVERNANCE_GOVERNED_FILE_CHANGED: 'governance.governed_file_changed',
  GOVERNANCE_VALIDATOR_NEEDED: 'governance.validator_needed',
  GOVERNANCE_VALIDATOR_OBSERVED: 'governance.validator_observed',
  GOVERNANCE_HARD_BLOCK: 'governance.hard_block',

  // prompt.* - runtime prompt mutation/decoration observability
  PROMPT_DECORATION: 'prompt.decoration',

  // adapter.discord.* - Discord service events (reuse adapter.* prefix)
  ADAPTER_DISCORD_DASHBOARD_STARTED: 'adapter.discord_dashboard_started',
  ADAPTER_DISCORD_DASHBOARD_RECOVERED: 'adapter.discord_dashboard_recovered',
  ADAPTER_DISCORD_DASHBOARD_CREATED: 'adapter.discord_dashboard_created',
  ADAPTER_DISCORD_DASHBOARD_EDIT_FAILED: 'adapter.discord_dashboard_edit_failed',
  ADAPTER_DISCORD_DASHBOARD_UPDATE_ERROR: 'adapter.discord_dashboard_update_error',
  ADAPTER_DISCORD_COST_REPORT: 'adapter.discord_cost_report',
  ADAPTER_DISCORD_COST_REPORT_SENT: 'adapter.discord_cost_report_sent',
  ADAPTER_DISCORD_COST_REPORT_ERROR: 'adapter.discord_cost_report_error',
  ADAPTER_DISCORD_CACHE_ANOMALY_REPORT: 'adapter.discord_cache_anomaly_report',
  ADAPTER_DISCORD_CACHE_ANOMALY_REPORT_SENT: 'adapter.discord_cache_anomaly_report_sent',
  ADAPTER_DISCORD_CACHE_ANOMALY_REPORT_ERROR: 'adapter.discord_cache_anomaly_report_error',

  // cache.* - AI-query caching observability (Anthropic prompt cache + SDK session)
  CACHE_ANOMALY_PER_TURN: 'cache.anomaly_per_turn',
  CACHE_EFFICIENCY_SNAPSHOT: 'cache.efficiency_snapshot',
  CACHE_EFFICIENCY_WARN: 'cache.efficiency_warn',
  CACHE_KEEPALIVE_PING: 'cache.keepalive_ping',
  CACHE_QUERY_ANOMALY: 'cache.query_anomaly',
} as const;
