/**
 * Display locale singleton.
 *
 * Set once at startup from DISPLAY_LOCALE. Controls human-facing label language
 * and date-fns locale for prompt/dashboard display. Defaults to 'en'.
 * Same singleton pattern as utils/timezone.ts.
 */

let displayLocale = 'en';

export function setDisplayLocale(locale: string): void {
  const trimmed = locale.trim();
  if (trimmed.length > 0) {
    displayLocale = trimmed;
  }
}

export function getDisplayLocale(): string {
  return displayLocale;
}
