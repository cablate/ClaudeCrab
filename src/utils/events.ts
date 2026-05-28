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
 *   lifecycle.*   process-level (startup, shutdown, heartbeat)
 *   instance.*    singleton-guard events (lock acquired/failed/violation)
 *   adapter.*     per-platform adapter lifecycle
 *   platform.*    platform-side abnormalities
 *   message.*     user message ingestion ??completion
 *   agent.*       Claude agent SDK query / tool / subagent
 *   query.*       lower-level SDK streaming details
 *   session.*     conversation session state
 *   schedule.*    cron / scheduled job
 *   (budget.* removed)
 *   governance.*  workspace governance telemetry (metadata only)
 *   persistence.* DB / repo events
 *   error.*       uncategorized errors (prefer a specific category where possible)
 */
export const EventType = {
  // lifecycle.*
  LIFECYCLE_STARTUP_BANNER: 'lifecycle.startup_banner',
  LIFECYCLE_STARTUP_COMPLETE: 'lifecycle.startup_complete',
  LIFECYCLE_HEARTBEAT: 'lifecycle.heartbeat',
  LIFECYCLE_HEARTBEAT_DISABLED: 'lifecycle.heartbeat_disabled',
  LIFECYCLE_SHUTDOWN_BEGIN: 'lifecycle.shutdown_begin',
  LIFECYCLE_SHUTDOWN_COMPLETE: 'lifecycle.shutdown_complete',
  LIFECYCLE_SHUTDOWN_ERROR: 'lifecycle.shutdown_error',
  LIFECYCLE_CRASH: 'lifecycle.crash',

  // instance.*
  INSTANCE_LOCK_ACQUIRED: 'instance.lock_acquired',
  INSTANCE_LOCK_FAILED: 'instance.lock_failed',

  // adapter.*
  ADAPTER_INIT_BEGIN: 'adapter.init_begin',
  ADAPTER_INIT_COMPLETE: 'adapter.init_complete',
  ADAPTER_INIT_ERROR: 'adapter.init_error',
  ADAPTER_START_BEGIN: 'adapter.start_begin',
  ADAPTER_STARTED: 'adapter.started',
  ADAPTER_START_ERROR: 'adapter.start_error',
  ADAPTER_STOP_BEGIN: 'adapter.stop_begin',
  ADAPTER_STOPPED: 'adapter.stopped',
  ADAPTER_STOP_ERROR: 'adapter.stop_error',
  ADAPTER_DISPOSE_BEGIN: 'adapter.dispose_begin',
  ADAPTER_DISPOSE_COMPLETE: 'adapter.dispose_complete',
  ADAPTER_DISPOSE_ERROR: 'adapter.dispose_error',
  ADAPTER_STATE_WARN: 'adapter.state_warn',
  ADAPTER_MESSAGE_INGRESS: 'adapter.message_ingress',
  ADAPTER_MESSAGE_REJECTED: 'adapter.message_rejected',
  ADAPTER_MESSAGE_ERROR: 'adapter.message_error',
  ADAPTER_SEND_BEGIN: 'adapter.send_begin',
  ADAPTER_SEND_COMPLETE: 'adapter.send_complete',
  ADAPTER_SEND_ERROR: 'adapter.send_error',
  ADAPTER_INTERACTION: 'adapter.interaction',
  ADAPTER_INTERACTION_ERROR: 'adapter.interaction_error',
  // Kept for back-compat ??use the _BEGIN/_COMPLETE pair above for new code.
  ADAPTER_INIT: 'adapter.init',
  ADAPTER_ERROR: 'adapter.error',

  // platform.*
  PLATFORM_CONFLICT_409: 'platform.conflict_409',
  PLATFORM_RECONNECT: 'platform.reconnect',
  PLATFORM_CONNECTED: 'platform.connected',
  PLATFORM_DISCONNECTED: 'platform.disconnected',
  PLATFORM_POLLING_CRASH: 'platform.polling_crash',
  PLATFORM_POLLING_RECOVER: 'platform.polling_recover',
  PLATFORM_RATE_LIMIT: 'platform.rate_limit',
  PLATFORM_API_ERROR: 'platform.api_error',

  // message.*
  MESSAGE_RECEIVED: 'message.received',
  MESSAGE_PROCESSING_START: 'message.processing_start',
  MESSAGE_PROCESSING_COMPLETE: 'message.processing_complete',
  MESSAGE_DUPLICATE_SKIPPED: 'message.duplicate_skipped',
  MESSAGE_RACE_PREVENTED: 'message.race_prevented',
  MESSAGE_REJECTED: 'message.rejected',
  MESSAGE_ERROR: 'message.error',

  // agent.*
  AGENT_QUERY_START: 'agent.query_start',
  AGENT_QUERY_COMPLETE: 'agent.query_complete',
  AGENT_QUERY_ERROR: 'agent.query_error',
  AGENT_TOOL_CALL: 'agent.tool_call',
  AGENT_SUBAGENT_DISPATCH: 'agent.subagent_dispatch',
  AGENT_SUBAGENT_COMPLETE: 'agent.subagent_complete',

  // sdk.* ??Claude Agent SDK internals (CLI override, stream orphan handling, diag)
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
  SDK_RESULT_NON_SUCCESS: 'sdk.result_non_success', // classifySdkResult ??stateless callers hit error_* subtype
  SDK_KEEPALIVE_CACHE_MISS: 'sdk.keepalive_cache_miss', // V2 cache keepalive ping saw 0 cache reads (TTL expired)

  // Callback hook entry markers ??for SDK programmatic hooks which don't emit
  // hook_started/hook_response stream events (those are only for CLI-registered
  // settings.json / plugin hooks). These tell us our JS callbacks actually ran.
  SDK_HOOK_CB_USER_PROMPT_SUBMIT: 'sdk.hook_cb.user_prompt_submit',
  SDK_HOOK_CB_POST_TOOL_USE: 'sdk.hook_cb.post_tool_use',
  SDK_HOOK_CB_POST_TOOL_USE_FAILURE: 'sdk.hook_cb.post_tool_use_failure',
  SDK_HOOK_CB_PRE_COMPACT: 'sdk.hook_cb.pre_compact',
  SDK_HOOK_CB_STOP: 'sdk.hook_cb.stop',

  // session.guard.* ??session-length-handoff-guard events
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
  SESSION_LOCK_ACQUIRED: 'session.lock_acquired',
  SESSION_LOCK_WAIT: 'session.lock_wait',
  SESSION_LOCK_RELEASED: 'session.lock_released',
  SESSION_DEDUP_MARKED: 'session.dedup_marked',
  SESSION_DEDUP_EVICTED: 'session.dedup_evicted',
  SESSION_RESTORE_BEGIN: 'session.restore_begin',
  SESSION_RESTORE_SKIPPED: 'session.restore_skipped',
  SESSION_MANAGER_STARTED: 'session.manager_started',
  SESSION_MANAGER_STOPPED: 'session.manager_stopped',
  SESSION_MANAGER_DISPOSED: 'session.manager_disposed',
  SESSION_ERROR: 'session.error',
  SESSION_ADMIN_CLOSE: 'session.admin_close',

  // orchestrator.* ??PlatformOrchestrator lifecycle & dispatch
  ORCHESTRATOR_INIT: 'orchestrator.init',
  ORCHESTRATOR_ADAPTER_START: 'orchestrator.adapter_start',
  ORCHESTRATOR_ADAPTER_STOP: 'orchestrator.adapter_stop',
  ORCHESTRATOR_ADAPTER_FAILED: 'orchestrator.adapter_failed',
  ORCHESTRATOR_START_ALL_COMPLETE: 'orchestrator.start_all_complete',
  ORCHESTRATOR_STOP_ALL_COMPLETE: 'orchestrator.stop_all_complete',
  ORCHESTRATOR_DISPATCH: 'orchestrator.dispatch',
  ORCHESTRATOR_DISPATCH_ERROR: 'orchestrator.dispatch_error',
  ORCHESTRATOR_NO_ADAPTER: 'orchestrator.no_adapter',
  ORCHESTRATOR_BROADCAST: 'orchestrator.broadcast',

  // schedule.*
  SCHEDULE_TICK: 'schedule.tick',
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
  SCHEDULE_EXECUTION_START: 'schedule.execution_start',
  SCHEDULE_EXECUTION_COMPLETE: 'schedule.execution_complete',
  SCHEDULE_EXECUTION_ERROR: 'schedule.execution_error',
  SCHEDULE_EXECUTION_RETRY: 'schedule.execution_retry',
  SCHEDULE_NOTIFIER_COMPLETE: 'schedule.notifier_complete',
  SCHEDULE_NOTIFIER_ERROR: 'schedule.notifier_error',
  SCHEDULE_NOTIFIER_AUTO_PAUSED: 'schedule.notifier_auto_paused',
  SCHEDULE_NOTIFIER_NO_ADAPTER: 'schedule.notifier_no_adapter',
  SCHEDULE_NOTIFIER_NO_CHAT_ID: 'schedule.notifier_no_chat_id',
  // governance.* ??passive workspace governance telemetry (metadata only)
  GOVERNANCE_SESSION_SUMMARY: 'governance.session_summary',
  GOVERNANCE_LARGE_READ: 'governance.large_read',
  GOVERNANCE_HIGH_COST_EXPLORATION: 'governance.high_cost_exploration',
  GOVERNANCE_BROAD_SEARCH: 'governance.broad_search',
  GOVERNANCE_RETIRED_PATH_ACCESS: 'governance.retired_path_access',
  GOVERNANCE_ARCHIVE_PATH_ACCESS: 'governance.archive_path_access',
  GOVERNANCE_COMMAND_FAILURE: 'governance.command_failure',
  GOVERNANCE_REPEATED_FAILURE: 'governance.repeated_failure',
  GOVERNANCE_GOVERNED_FILE_CHANGED: 'governance.governed_file_changed',
  GOVERNANCE_VALIDATOR_NEEDED: 'governance.validator_needed',
  GOVERNANCE_VALIDATOR_OBSERVED: 'governance.validator_observed',
  GOVERNANCE_HARD_BLOCK: 'governance.hard_block',
  GOVERNANCE_STOP_HYGIENE_NEEDED: 'governance.stop_hygiene_needed',
  GOVERNANCE_STOP_HYGIENE_SKIPPED: 'governance.stop_hygiene_skipped',

  // prompt.* ??runtime prompt mutation/decoration observability
  PROMPT_DECORATION: 'prompt.decoration',

  // adapter.discord.* ??Discord service events (reuse adapter.* prefix)
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
  ADAPTER_DISCORD_FORUM_LISTENER_STARTED: 'adapter.discord_forum_listener_started',
  ADAPTER_DISCORD_MSG_LISTENER_STARTED: 'adapter.discord_msg_listener_started',


  // persistence.*
  PERSISTENCE_MIGRATION: 'persistence.migration',
  PERSISTENCE_ERROR: 'persistence.error',

  // cache.* ??AI-query caching observability (Anthropic prompt cache + SDK session)
  CACHE_ANOMALY_PER_TURN: 'cache.anomaly_per_turn',
  CACHE_EFFICIENCY_SNAPSHOT: 'cache.efficiency_snapshot',
  CACHE_EFFICIENCY_WARN: 'cache.efficiency_warn',
  CACHE_HEARTBEAT_SNAPSHOT: 'cache.heartbeat_snapshot',
  CACHE_SESSION_EVICTED: 'cache.session_evicted',
  CACHE_SESSION_RESTORED: 'cache.session_restored',
  CACHE_KEEPALIVE_PING: 'cache.keepalive_ping',
  CACHE_KEEPALIVE_ERROR: 'cache.keepalive_error',
  CACHE_QUERY_ANOMALY: 'cache.query_anomaly',

  // error.*
  ERROR_UNHANDLED_REJECTION: 'error.unhandled_rejection',
  ERROR_UNCAUGHT_EXCEPTION: 'error.uncaught_exception',
} as const;
