/**
 * Display timezone singleton.
 *
 * Set once at startup from the loaded app config (`DISPLAY_TIMEZONE`), then
 * read by every module that formats wall-clock time for humans (dashboard,
 * crash notifications, prompt context). Using a process-wide singleton here
 * instead of threading a timezone parameter through every constructor keeps
 * the display-timezone concern out of unrelated module signatures — the same
 * pattern the codebase already uses for INSTANCE_STARTED_AT.
 *
 * Schedule *trigger* timezones are a separate concern: they are per-schedule
 * (declared in each schedule YAML) and default to UTC, NOT this value.
 */

let displayTimezone = 'UTC';

export function setDisplayTimezone(timezone: string): void {
  const trimmed = timezone.trim();
  if (trimmed.length > 0) {
    displayTimezone = trimmed;
  }
}

export function getDisplayTimezone(): string {
  return displayTimezone;
}
