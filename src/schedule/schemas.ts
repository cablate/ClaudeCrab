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
}).transform((val) => {
  // Normalize: merge 'datetime' into 'at'
  if (val.datetime && !val.at) {
    val.at = val.datetime;
  }
  const { datetime: _, ...rest } = val;
  return rest;
});

// Execution configuration schema
export const ExecutionSchema = z.object({
  agent: z.string(),
  prompt: z.string(),
  maxTurns: z.number().positive().optional(),
  timeout: z.number().positive().optional(),
});

// Notification configuration schema
export const NotificationSchema = z.object({
  onComplete: z.boolean().optional(),
  onError: z.boolean().optional(),
  platform: z.string().optional(),
  chatId: z.string().optional(),
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
  metadata: MetadataSchema,
});

// Infer TypeScript types from schemas
export type Trigger = z.infer<typeof TriggerSchema>;
export type Execution = z.infer<typeof ExecutionSchema>;
export type Notification = z.infer<typeof NotificationSchema>;
export type Metadata = z.infer<typeof MetadataSchema>;
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
