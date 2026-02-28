/**
 * MiniMax TTS Script
 * 
 * 使用 Replicate MiniMax Speech 2.8 HD 生成語音
 * 參考 ClaudeCab/src/core/tts/ReplicateTTSProvider.ts
 * 
 * Usage:
 *   npx tsx tts.ts "要說的文字" [output_path]
 * 
 * Example:
 *   npx tsx tts.ts "你好，這是測試" output/speech.mp3
 */

import { writeFile, mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { config } from "dotenv";
import Replicate from "replicate";
import path from "path";
import { fileURLToPath } from "url";

// 載入 .env（從 script 所在目錄）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, ".env") });

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

const DEFAULT_MODEL = "minimax/speech-2.6-hd";
const DEFAULT_VOICE_ID = "R8_GMHZCMLK";
const DEFAULT_LANGUAGE_BOOST = "Chinese";

interface TTSOptions {
  text: string;
  outputPath?: string;
  voiceId?: string;
  languageBoost?: string;
  audioFormat?: "mp3" | "wav";
}

interface TTSResult {
  audioPath: string;
  audioUrl?: string;
}

async function outputToBuffer(output: unknown): Promise<Buffer> {
  // Replicate returns a FileOutput object with url() method
  if (!output || typeof output !== "object") {
    throw new Error("Replicate TTS returned invalid output");
  }

  // Handle ReadableStream
  if (output instanceof ReadableStream) {
    const chunks: Uint8Array[] = [];
    const reader = output.getReader();
    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (result.value) {
        chunks.push(result.value);
      }
    }
    return Buffer.concat(chunks);
  }

  // Handle Buffer directly
  if (Buffer.isBuffer(output)) {
    return output;
  }

  // Handle ArrayBuffer/TypedArray
  if (ArrayBuffer.isView(output)) {
    return Buffer.from(output.buffer, output.byteOffset, output.byteLength);
  }

  // Handle FileOutput object - fetch from URL
  const fileOutput = output as { url?: () => string };
  if (typeof fileOutput.url === "function") {
    const url = fileOutput.url();
    console.log(`Audio URL: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download audio: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  throw new Error("Unexpected Replicate output format");
}

async function generateSpeech(options: TTSOptions): Promise<TTSResult> {
  const {
    text,
    outputPath = "output/tts_output.mp3",
    voiceId = DEFAULT_VOICE_ID,
    languageBoost = DEFAULT_LANGUAGE_BOOST,
    audioFormat = "mp3",
  } = options;

  if (!text || text.trim().length === 0) {
    throw new Error("Text to synthesize cannot be empty");
  }

  console.log(`Generating speech for: "${text.substring(0, 50)}${text.length > 50 ? "..." : ""}"`);
  console.log(`Voice: ${voiceId}, Language: ${languageBoost}, Format: ${audioFormat}`);

  const input: Record<string, unknown> = {
    text: text.trim(),
    voice_id: voiceId,
    language_boost: languageBoost,
    audio_format: audioFormat,
  };

  // Run the model
  const output = await replicate.run(DEFAULT_MODEL as `${string}/${string}`, { input });

  // Convert output to Buffer
  const audioBuffer = await outputToBuffer(output);

  if (audioBuffer.length === 0) {
    throw new Error("Replicate TTS returned empty audio");
  }

  // 確保輸出目錄存在
  const outputDir = path.dirname(outputPath);
  await mkdir(outputDir, { recursive: true });

  // 寫入音檔
  await writeFile(outputPath, audioBuffer);
  console.log(`Audio saved to: ${outputPath} (${audioBuffer.length} bytes)`);

  return {
    audioPath: outputPath,
  };
}

// CLI 執行
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: npx tsx tts.ts <text_or_file> [output_path]");
    console.error('Example: npx tsx tts.ts "你好，這是測試" output/speech.mp3');
    console.error('Example: npx tsx tts.ts script.txt output/speech.mp3');
    process.exit(1);
  }

  // 支援從檔案讀取文字（如果第一個參數是 .txt 檔案）
  let text = args[0];
  if (text.endsWith(".txt") && existsSync(text)) {
    console.log(`Reading text from file: ${text}`);
    text = await readFile(text, "utf-8");
  }

  const outputPath = args[1] || `output/tts_${Date.now()}.mp3`;

  try {
    const result = await generateSpeech({ text, outputPath });

    // 輸出 JSON 結果
    console.log("\n=== Result ===");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();

export { generateSpeech, TTSOptions, TTSResult };
