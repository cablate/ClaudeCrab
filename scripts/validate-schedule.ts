#!/usr/bin/env npx tsx
/**
 * Schedule YAML Validation Script
 *
 * Usage:
 *   npx tsx scripts/validate-schedule.ts <path-to-yaml>
 *   npx tsx scripts/validate-schedule.ts agents/coder/schedules/my-task.yaml
 *
 * Validates that a schedule YAML file:
 * 1. Is valid YAML syntax
 * 2. Conforms to ScheduleSpec schema
 * 3. Has valid cron expression (if type: cron)
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { safeValidateScheduleSpec } from '../src/schedule/schemas.js';

// ANSI color codes
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function validateCronExpression(cron: string): { valid: boolean; error?: string } {
  // Basic cron validation (5 or 6 fields)
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5 || parts.length > 6) {
    return { valid: false, error: `Expected 5-6 fields, got ${parts.length}` };
  }

  // Field ranges: minute(0-59), hour(0-23), day(1-31), month(1-12), weekday(0-7)
  const ranges = [
    { name: 'minute', min: 0, max: 59 },
    { name: 'hour', min: 0, max: 23 },
    { name: 'day', min: 1, max: 31 },
    { name: 'month', min: 1, max: 12 },
    { name: 'weekday', min: 0, max: 7 },
  ];

  for (let i = 0; i < Math.min(parts.length, 5); i++) {
    const part = parts[i];
    const range = ranges[i];

    // Skip wildcards and special characters
    if (part === '*' || part.includes('/') || part.includes('-') || part.includes(',')) {
      continue;
    }

    const num = parseInt(part, 10);
    if (isNaN(num) || num < range.min || num > range.max) {
      return {
        valid: false,
        error: `Invalid ${range.name}: "${part}" (expected ${range.min}-${range.max})`,
      };
    }
  }

  return { valid: true };
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`${CYAN}Schedule YAML Validator${RESET}`);
    console.log('');
    console.log('Usage:');
    console.log('  npx tsx scripts/validate-schedule.ts <path-to-yaml>');
    console.log('  npx tsx scripts/validate-schedule.ts agents/*/schedules/*.yaml');
    console.log('');
    console.log('Examples:');
    console.log('  npx tsx scripts/validate-schedule.ts agents/coder/schedules/daily-report.yaml');
    process.exit(0);
  }

  let hasErrors = false;

  for (const arg of args) {
    // Expand glob patterns
    const files = fs.existsSync(arg) && fs.statSync(arg).isFile() ? [arg] : [];

    if (files.length === 0) {
      console.log(`${RED}✗${RESET} File not found: ${arg}`);
      hasErrors = true;
      continue;
    }

    for (const filePath of files) {
      console.log(`${CYAN}Validating:${RESET} ${filePath}`);

      // 1. Check file exists and is readable
      let content: string;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch (err) {
        console.log(`  ${RED}✗${RESET} Cannot read file: ${(err as Error).message}`);
        hasErrors = true;
        continue;
      }

      // 2. Parse YAML
      let parsed: unknown;
      try {
        parsed = parseYaml(content);
      } catch (err) {
        console.log(`  ${RED}✗${RESET} Invalid YAML syntax: ${(err as Error).message}`);
        hasErrors = true;
        continue;
      }

      // 3. Validate against schema
      const result = safeValidateScheduleSpec(parsed);

      if (!result.success) {
        console.log(`  ${RED}✗${RESET} Schema validation failed:`);
        for (const issue of result.error.issues) {
          const path = issue.path.join('.');
          console.log(`    - ${path}: ${issue.message}`);
        }
        hasErrors = true;
        continue;
      }

      const spec = result.data;

      // 4. Validate cron expression if applicable
      if (spec.trigger.type === 'cron') {
        if (!spec.trigger.cron) {
          console.log(`  ${RED}✗${RESET} trigger.type is "cron" but trigger.cron is missing`);
          hasErrors = true;
          continue;
        }

        const cronResult = validateCronExpression(spec.trigger.cron);
        if (!cronResult.valid) {
          console.log(`  ${RED}✗${RESET} Invalid cron expression: ${cronResult.error}`);
          hasErrors = true;
          continue;
        }
      }

      // 5. Validate once/at trigger
      if (spec.trigger.type === 'once' && !spec.trigger.at) {
        console.log(`  ${RED}✗${RESET} trigger.type is "once" but trigger.at is missing`);
        hasErrors = true;
        continue;
      }

      // 6. Validate interval trigger
      if (spec.trigger.type === 'interval' && !spec.trigger.interval) {
        console.log(`  ${RED}✗${RESET} trigger.type is "interval" but trigger.interval is missing`);
        hasErrors = true;
        continue;
      }

      // 7. Check filename matches ID
      const filename = path.basename(filePath).replace(/\.ya?ml$/, '');
      if (spec.id !== filename) {
        console.log(`  ${YELLOW}⚠${RESET} ID mismatch: file="${filename}" but id="${spec.id}" (will use filename)`);
      }

      // 8. Check enabled status
      const enabledStatus = spec.metadata.enabled
        ? `${GREEN}enabled${RESET}`
        : `${YELLOW}disabled${RESET}`;

      // Success output
      console.log(`  ${GREEN}✓${RESET} Valid schedule: ${spec.name}`);
      console.log(`    ID: ${spec.id}`);
      console.log(`    Agent: ${spec.execution.agent}`);
      console.log(`    Status: ${enabledStatus}`);

      if (spec.trigger.type === 'cron') {
        console.log(`    Cron: ${spec.trigger.cron} (${spec.trigger.timezone})`);
      } else if (spec.trigger.type === 'once') {
        console.log(`    Once at: ${spec.trigger.at}`);
      } else if (spec.trigger.type === 'interval') {
        console.log(`    Interval: ${spec.trigger.interval}ms`);
      }

      console.log('');
    }
  }

  process.exit(hasErrors ? 1 : 0);
}

main();
