/**
 * Interactive prompt event types (ADR-033: Web UI galgame-style choices)
 */

/**
 * Interactive prompt event (ADR-033: Web UI galgame-style choices)
 */
export interface InteractionEvent {
  type: 'permission_request' | 'question_request' | 'plan_review_request';
  requestId: string;
  agentId: string;
  // Permission fields
  toolName?: string;
  decisionReason?: string;
  // Question fields
  question?: string;
  header?: string;
  options?: Array<{ label: string; description: string }>;
  multiSelect?: boolean;
  // Plan review fields
  allowedPrompts?: Array<{ tool: string; prompt: string }> | undefined;
}
