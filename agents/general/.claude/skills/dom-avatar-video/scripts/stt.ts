/**
 * STT Script - 使用 Groq Whisper 轉錄音檔並輸出時間戳
 *
 * Usage: node --import tsx stt.ts <audio_path> [output_path]
 *
 * Output: JSON with text and word-level timestamps
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// ES module 中取得 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 載入 .env
dotenv.config({ path: path.join(__dirname, '.env') });

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

if (!GROQ_API_KEY) {
  console.error('Error: GROQ_API_KEY not found in .env');
  process.exit(1);
}

interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

interface SegmentTimestamp {
  text: string;
  start: number;
  end: number;
}

interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
  words?: WordTimestamp[];
  segments?: SegmentTimestamp[];
}

async function transcribe(audioPath: string): Promise<TranscriptionResult> {
  const audioBuffer = fs.readFileSync(audioPath);
  const fileName = path.basename(audioPath);

  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer]), fileName);
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');
  formData.append('timestamp_granularities[]', 'segment');

  const response = await fetch(GROQ_TRANSCRIPTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  return {
    text: data.text,
    language: data.language,
    duration: data.duration,
    words: data.words,
    segments: data.segments,
  };
}

function getMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.m4a': 'audio/m4a',
    '.webm': 'audio/webm',
  };
  return mimeTypes[ext] || 'audio/mpeg';
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: node --import tsx stt.ts <audio_path> [output_path]');
    console.error('Example: node --import tsx stt.ts output/tts_test.mp3 output/transcript.json');
    process.exit(1);
  }

  const audioPath = args[0];
  const outputPath = args[1];

  if (!fs.existsSync(audioPath)) {
    console.error(`Error: Audio file not found: ${audioPath}`);
    process.exit(1);
  }

  console.log(`Transcribing: ${audioPath}`);

  try {
    const result = await transcribe(audioPath);

    const output = JSON.stringify(result, null, 2);

    if (outputPath) {
      fs.writeFileSync(outputPath, output);
      console.log(`Saved to: ${outputPath}`);
    } else {
      console.log(output);
    }
  } catch (error) {
    console.error('Transcription failed:', error);
    process.exit(1);
  }
}

main();
