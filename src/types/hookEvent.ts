/**
 * Hook lifecycle events emitted by SDK programmatic callback hooks,
 * surfaced to chat adapters so users see real-time feedback when hooks fire.
 *
 * SDK native `hook_started` / `hook_response` stream subtypes only fire for
 * CLI-registered hooks. Programmatic JS callbacks registered via
 * `options.hooks` are instrumented at their emit sites instead.
 */

export type HookKind = 'user_prompt_submit' | 'pre_tool_use' | 'pre_compact';

/** Hooks use one fire-and-forget subtitle line per event. */
export type HookLifecycle = 'fired';

export interface HookEvent {
  /** Routing/log tag, not used for display. */
  kind: HookKind;
  lifecycle: HookLifecycle;
  /** Unique key for log correlation. */
  correlationKey: string;
  /**
   * Display name, set by the emit site so variant labels stay co-located with
   * the code that knows what each variant means.
   */
  name: string;
  /** Display message. Empty string renders as just the hook name. */
  message?: string;
}
