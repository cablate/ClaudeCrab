/**
 * Attachment Downloader
 *
 * Downloads platform attachments to local storage and returns file paths.
 * Files are stored under agents/{agentId}/uploads/{YYYY-MM-DD}/
 * so Claude can access them via Read tool within the agent's working directory.
 */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

const log = logger.child({ module: 'AttachmentDownloader' });

/** Maximum file size to download (50 MB) */
const MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024;

/** Result of downloading an attachment */
export interface DownloadResult {
  success: boolean;
  /** Absolute local file path */
  filePath?: string;
  /** File size in bytes */
  fileSize?: number;
  error?: string;
}

/** Attachment metadata for building user message context */
export interface AttachmentInfo {
  /** Original filename */
  fileName: string;
  /** MIME type if available */
  mimeType?: string | undefined;
  /** File size in bytes */
  fileSize?: number | undefined;
  /** Local file path after download */
  localPath: string;
}

/**
 * Get the file category label for the user message.
 */
function getCategoryLabel(mimeType: string | undefined, fileName: string): string {
  if (!mimeType) {
    const ext = path.extname(fileName).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].includes(ext)) return '圖片';
    if (['.pdf'].includes(ext)) return 'PDF';
    if (['.doc', '.docx'].includes(ext)) return 'Word 文件';
    if (['.xls', '.xlsx'].includes(ext)) return 'Excel 文件';
    if (['.mp3', '.ogg', '.wav', '.m4a', '.flac'].includes(ext)) return '音訊檔';
    if (['.mp4', '.avi', '.mkv', '.mov', '.webm'].includes(ext)) return '影片檔';
    return '檔案';
  }
  if (mimeType.startsWith('image/')) return '圖片';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType.includes('word') || mimeType.includes('document')) return 'Word 文件';
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'Excel 文件';
  if (mimeType.startsWith('audio/')) return '音訊檔';
  if (mimeType.startsWith('video/')) return '影片檔';
  if (mimeType.startsWith('text/')) return '文字檔';
  return '檔案';
}

/**
 * Check if this attachment is a "long message converted to .txt" by the platform.
 * These should be inlined as text, not saved as files.
 */
export function isAutoConvertedTextFile(fileName: string, mimeType?: string): boolean {
  // Discord auto-converts to "message.txt"; Telegram to *.txt with text/ mime
  const isTxt = fileName.endsWith('.txt') || fileName.endsWith('.md');
  const isTextMime = !mimeType || mimeType.startsWith('text/') || mimeType === 'application/octet-stream';
  return isTxt && isTextMime;
}

/**
 * Build the uploads directory path for an agent.
 */
function getUploadsDir(agentsDir: string, agentId: string): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(agentsDir, agentId, 'uploads', date);
}

/**
 * Ensure a unique filename (no collision).
 */
function resolveUniqueFilename(dir: string, fileName: string): string {
  let candidate = path.join(dir, fileName);
  if (!fs.existsSync(candidate)) return candidate;
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}_${counter}${ext}`);
    counter++;
  }
  return candidate;
}

/**
 * Download a file from a URL to the agent's uploads directory.
 */
export async function downloadAttachment(
  url: string,
  fileName: string,
  agentsDir: string,
  agentId: string,
  expectedSize?: number
): Promise<DownloadResult> {
  // Size pre-check
  if (expectedSize !== undefined && expectedSize > MAX_DOWNLOAD_SIZE) {
    return {
      success: false,
      error: `File too large: ${(expectedSize / 1024 / 1024).toFixed(1)} MB (max ${MAX_DOWNLOAD_SIZE / 1024 / 1024} MB)`,
    };
  }
  const uploadsDir = getUploadsDir(agentsDir, agentId);
  try {
    // Ensure directory exists
    fs.mkdirSync(uploadsDir, { recursive: true });
    // Download
    const response = await fetch(url);
    if (!response.ok) {
      return { success: false, error: `Download failed: HTTP ${response.status}` };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_DOWNLOAD_SIZE) {
      return { success: false, error: `File too large: ${(buffer.length / 1024 / 1024).toFixed(1)} MB` };
    }
    // Write to unique path
    const filePath = resolveUniqueFilename(uploadsDir, fileName);
    fs.writeFileSync(filePath, buffer);
    log.info({ fileName, filePath, size: buffer.length, agentId }, 'Attachment downloaded');
    return { success: true, filePath, fileSize: buffer.length };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error({ error, url, fileName, agentId }, 'Failed to download attachment');
    return { success: false, error: msg };
  }
}

/**
 * Format attachment references for insertion into the user message.
 * Claude will see these paths and can use Read tool to access the files.
 */
export function formatAttachmentContext(attachments: AttachmentInfo[]): string {
  if (attachments.length === 0) return '';
  const lines = ['[附件]'];
  for (const att of attachments) {
    const label = getCategoryLabel(att.mimeType, att.fileName);
    const size =
      att.fileSize !== undefined
        ? att.fileSize > 1024 * 1024
          ? ` (${(att.fileSize / 1024 / 1024).toFixed(1)} MB)`
          : ` (${(att.fileSize / 1024).toFixed(0)} KB)`
        : '';
    lines.push(`- ${label}「${att.fileName}」${size} → ${att.localPath}`);
  }
  return lines.join('\n');
}
