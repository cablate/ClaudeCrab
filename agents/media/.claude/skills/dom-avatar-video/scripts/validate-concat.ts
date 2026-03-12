/**
 * 驗證 concat 檔案：圖片存在 + 編碼一致 + 尺寸一致 + duration 合理
 * 用法：npx tsx validate-concat.ts <concat_file> [audio_file]
 *
 * 如果提供 audio_file，會比對 concat 總 duration 與音檔長度
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const concatFile = process.argv[2];
const audioFile = process.argv[3];

if (!concatFile) {
  console.error('用法: npx tsx validate-concat.ts <concat_file> [audio_file]');
  process.exit(1);
}

if (!fs.existsSync(concatFile)) {
  console.error(`❌ concat 檔案不存在: ${concatFile}`);
  process.exit(1);
}

const content = fs.readFileSync(concatFile, 'utf-8');
const lines = content.split('\n');

interface Entry {
  file: string;
  duration: number | null; // null = last entry
  lineNum: number;
}

// Parse concat file
const entries: Entry[] = [];
let currentFile: string | null = null;
let currentLine = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  const fileMatch = line.match(/^file\s+'(.+)'$/);
  const durationMatch = line.match(/^duration\s+([\d.]+)$/);

  if (fileMatch) {
    if (currentFile) {
      // Previous file had no duration (should only be last)
      entries.push({ file: currentFile, duration: null, lineNum: currentLine });
    }
    currentFile = fileMatch[1];
    currentLine = i + 1;
  } else if (durationMatch && currentFile) {
    entries.push({ file: currentFile, duration: parseFloat(durationMatch[1]), lineNum: currentLine });
    currentFile = null;
  }
}
// Last entry (no duration)
if (currentFile) {
  entries.push({ file: currentFile, duration: null, lineNum: currentLine });
}

if (entries.length === 0) {
  console.error('❌ concat 檔案中沒有找到任何 file 條目');
  process.exit(1);
}

// Validation
let errors: string[] = [];
let warnings: string[] = [];
let totalDuration = 0;
const codecs: Map<string, string[]> = new Map();
const dimensions: Map<string, string[]> = new Map();

function ffprobeField(filePath: string, field: string): string {
  try {
    return execSync(
      `ffprobe -v error -show_entries stream=${field} -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8' }
    ).trim();
  } catch {
    return 'ERROR';
  }
}

console.log(`\n📋 驗證 concat: ${path.basename(concatFile)} (${entries.length} 個條目)\n`);

for (const entry of entries) {
  // Check existence
  if (!fs.existsSync(entry.file)) {
    errors.push(`L${entry.lineNum}: 檔案不存在 → ${entry.file}`);
    continue;
  }

  // Check codec
  const codec = ffprobeField(entry.file, 'codec_name');
  if (!codecs.has(codec)) codecs.set(codec, []);
  codecs.get(codec)!.push(path.basename(entry.file));

  // Check dimensions
  const dim = ffprobeField(entry.file, 'width,height');
  if (!dimensions.has(dim)) dimensions.set(dim, []);
  dimensions.get(dim)!.push(path.basename(entry.file));

  // Accumulate duration
  if (entry.duration !== null) {
    totalDuration += entry.duration;
  }
}

// Check codec consistency
if (codecs.size > 1) {
  errors.push(`編碼不一致！concat demuxer 會跳過不同編碼的圖片：`);
  for (const [codec, files] of codecs) {
    errors.push(`  ${codec}: ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` ...共 ${files.length} 個` : ''}`);
  }
  errors.push(`  → 修正：全部轉成真 PNG: ffmpeg -y -i input.png output.tmp.png && mv output.tmp.png input.png`);
}

// Check dimension consistency
if (dimensions.size > 1) {
  errors.push(`尺寸不一致！會觸發 filter graph reconfigure：`);
  for (const [dim, files] of dimensions) {
    errors.push(`  ${dim}: ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` ...共 ${files.length} 個` : ''}`);
  }
}

// Check duration vs audio
if (audioFile && fs.existsSync(audioFile)) {
  const audioDuration = parseFloat(ffprobeField(audioFile, 'duration').split('\n')[0] || '0');
  if (audioDuration > 0) {
    const diff = Math.abs(totalDuration - audioDuration);
    if (diff > 1.0) {
      errors.push(`duration 總和 (${totalDuration.toFixed(2)}s) 與音檔 (${audioDuration.toFixed(2)}s) 差 ${diff.toFixed(2)}s → 可能漏算靜音間隔`);
    } else if (diff > 0.3) {
      warnings.push(`duration 總和 (${totalDuration.toFixed(2)}s) 與音檔 (${audioDuration.toFixed(2)}s) 差 ${diff.toFixed(2)}s`);
    } else {
      console.log(`✅ duration 總和 ${totalDuration.toFixed(2)}s ≈ 音檔 ${audioDuration.toFixed(2)}s`);
    }
  }
} else {
  console.log(`ℹ️  duration 總和: ${totalDuration.toFixed(2)}s（未提供音檔比對）`);
}

// Check last entry has no duration
const lastEntry = entries[entries.length - 1];
if (lastEntry.duration !== null) {
  warnings.push(`最後一個條目有 duration (${lastEntry.duration}s)，ffmpeg concat 規則建議最後一個不加 duration`);
}

// Report
if (codecs.size === 1) {
  const codec = [...codecs.keys()][0];
  console.log(`✅ 編碼統一: ${codec}`);
}
if (dimensions.size === 1) {
  const dim = [...dimensions.keys()][0];
  console.log(`✅ 尺寸統一: ${dim}`);
}

if (warnings.length > 0) {
  console.log(`\n⚠️  警告 (${warnings.length}):`);
  warnings.forEach(w => console.log(`  ${w}`));
}

if (errors.length > 0) {
  console.log(`\n❌ 錯誤 (${errors.length}):`);
  errors.forEach(e => console.log(`  ${e}`));
  process.exit(1);
} else {
  console.log(`\n✅ 驗證通過，共 ${entries.length} 個圖片`);
  process.exit(0);
}
