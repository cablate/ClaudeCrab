import telegramifyMarkdown from 'telegramify-markdown';

/**
 * Regex to detect markdown table syntax.
 * Matches tables with:
 * - Header row: | col1 | col2 |
 * - Separator row: | --- | --- | (with optional : for alignment)
 * - Data rows: | data1 | data2 |
 */
const TABLE_REGEX = /(?:^|\n)(\|[^\n]+\|\r?\n\|[\s:|-]+\|\r?\n(?:\|[^\n]+\|\r?\n?)+)/gm;

/**
 * Parse a markdown table into structured data
 */
function parseMarkdownTable(tableText: string): { headers: string[]; rows: string[][] } | null {
  const lines = tableText.trim().split(/\r?\n/);
  if (lines.length < 2) return null;

  // Parse header row
  const headerLine = lines[0];
  if (!headerLine) return null;

  const headers = headerLine
    .split('|')
    .slice(1, -1) // Remove empty strings from leading/trailing |
    .map((cell) => cell.trim());

  // Skip separator row (line 1), parse data rows
  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.includes('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  return { headers, rows };
}

/**
 * Convert a markdown table to Telegram-compatible format.
 *
 * Strategy:
 * - Simple tables (≤3 columns, short content): Convert to list format
 * - Complex tables (>3 columns or long content): Convert to monospace block
 */
function convertSingleTable(tableText: string): string {
  const parsed = parseMarkdownTable(tableText);
  if (!parsed || parsed.headers.length === 0) {
    // Can't parse, return as plain text
    return tableText.trim();
  }

  const { headers, rows } = parsed;

  // Convert to list format: each row becomes a list item
  // Format: • col1: val1 | col2: val2 | col3: val3
  return rows
    .map((row) => {
      const pairs = headers
        .map((header, i) => `${header}: ${row[i] || ''}`)
        .join(' | ');
      return `• ${pairs}`;
    })
    .join('\n');
}

/**
 * Convert all markdown tables in text to Telegram-compatible format.
 * This should be called BEFORE telegramifyMarkdown to avoid escaping issues.
 */
function convertTablesToTelegramFormat(text: string): string {
  return text.replace(TABLE_REGEX, (match) => {
    // Preserve leading newline if present
    const leadingNewline = match.startsWith('\n') ? '\n' : '';
    const tableContent = match.startsWith('\n') ? match.slice(1) : match;
    return leadingNewline + convertSingleTable(tableContent);
  });
}

/**
 * Convert standard Markdown to Telegram MarkdownV2 format
 * Returns null if conversion fails (caller should fallback to original text)
 */
export function convertToTelegramMarkdown(text: string): string | null {
  try {
    // First, convert tables to Telegram-compatible format (uses placeholders)
    const tableConverted = convertTablesToTelegramFormat(text);

    let converted = telegramifyMarkdown(tableConverted, 'escape');
    // telegramify-markdown outputs \\# but Telegram expects \#
    // Fix double-escaped hash symbols
    converted = converted.replace(/\\\\#/g, '\\#');

    return converted;
  } catch {
    return null;
  }
}

