/**
 * Schedule Specification Zod Schemas
 *
 * Defines validation schemas for schedule YAML files.
 */

import { z } from 'zod/v4';

// Trigger configuration schema
// Accepts 'at' as alias for 'once' (common agent mistake)
const TriggerTypeSchema = z.enum(['cron', 'interval', 'once', 'at']).transform(
  (val) => (val === 'at' ? 'once' : val) as 'cron' | 'interval' | 'once'
);

export const TriggerSchema = z.object({
  type: TriggerTypeSchema,
  cron: z.string().optional(),
  interval: z.number().positive().optional(),
  at: z.string().optional(),       // ISO datetime for 'once'
  datetime: z.string().optional(), // Alias for 'at' (common agent mistake)
  timezone: z.string().default('Asia/Taipei'),
}).transform(({ datetime, ...rest }) => {
  // Normalize: merge 'datetime' into 'at'
  if (datetime && !rest.at) {
    rest.at = datetime;
  }
  return rest;
});

// Execution configuration schema
export const ExecutionSchema = z.object({
  agent: z.string(),
  prompt: z.string(),
  maxTurns: z.number().positive().optional(),
  timeout: z.number().positive().optional(),
  /** Model override: 'sonnet' | 'opus' | 'haiku'. If not specified, uses SDK default. */
  model: z.enum(['sonnet', 'opus', 'haiku']).optional(),
});

// Single notification target. Discord is the only supported platform.
export const NotificationTargetSchema = z.object({
  platform: z.literal('discord').default('discord'),
  chatId: z.string(),
});

// Notification configuration schema
export const NotificationSchema = z.object({
  onComplete: z.boolean().optional(),
  onError: z.boolean().optional(),
  /** Discord notification targets. */
  targets: z.array(NotificationTargetSchema).optional(),
  /** Local sound notification - plays audio file on schedule completion/error */
  localSound: z
    .object({
      onComplete: z.string().optional(),
      onError: z.string().optional(),
    })
    .optional(),
});

// Output configuration schema (thread-based output)
export const OutputSchema = z.object({
  /** Output mode: 'thread' creates a discussion thread, 'message' sends a direct message (default) */
  mode: z.enum(['thread', 'message']).default('message'),
  /** Thread title template. Supports {{name}} and {{date}} placeholders */
  threadTitle: z.string().optional(),
  /** Discord: text channel ID for creating threads */
  channelId: z.string().optional(),
  /** Discord: forum channel ID for creating forum posts */
  forumChannelId: z.string().optional(),
  /** Auto-archive thread after period: '24h' | '3d' | '7d' | 'never' */
  autoArchive: z.enum(['24h', '3d', '7d', 'never']).default('never'),
  /** Whether to persist session for user follow-up in thread (default true for thread mode) */
  persistSession: z.boolean().default(true),
  /** Delivery mode: 'streaming' sends intermediate messages, 'summary' sends formatted digest, 'last-only' sends final message */
  delivery: z.enum(['streaming', 'summary', 'last-only']).default('last-only'),
  /** Discord user IDs to mention/add when creating schedule output threads */
  notifyUserIds: z.array(z.string()).optional(),
});

// Metadata schema
export const MetadataSchema = z.object({
  createdAt: z.string(),
  createdBy: z.string(),
  enabled: z.boolean(),
  tags: z.array(z.string()).optional(),
});

// Full schedule specification schema
export const ScheduleSpecSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  trigger: TriggerSchema,
  execution: ExecutionSchema,
  notification: NotificationSchema.optional(),
  output: OutputSchema.optional(),
  metadata: MetadataSchema,
});

// Infer TypeScript types from schemas
export type ScheduleSpec = z.infer<typeof ScheduleSpecSchema>;

// Validation helper
export function validateScheduleSpec(data: unknown): ScheduleSpec {
  return ScheduleSpecSchema.parse(data);
}

// Safe validation helper (returns result instead of throwing)
export function safeValidateScheduleSpec(
  data: unknown
): { success: true; data: ScheduleSpec } | { success: false; error: z.ZodError } {
  const result = ScheduleSpecSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
