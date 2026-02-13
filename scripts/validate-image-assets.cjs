#!/usr/bin/env node
/**
 * validate-image-assets.js
 *
 * 驗證 public/images/agents/ 下所有圖片是否符合 image-asset-spec。
 * 用法：node scripts/validate-image-assets.js [agentId]
 *   - 不帶參數：掃描所有 agent
 *   - 帶 agentId：只掃描指定 agent
 *
 * 需要 sharp：npm install sharp（專案已有）
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// ─── 規格定義 ───

const SPEC = {
  sprite: {
    label: 'Sprite',
    filename: 'sprite.png',
    // 允許一定範圍（pixel art 縮放可能有 ±2px 差異）
    width: { min: 50, max: 130 },
    height: { min: 70, max: 170 },
    ratioTarget: 3 / 4, // 3:4
    ratioTolerance: 0.15,
    maxBytes: 50 * 1024,
    requireTransparency: true,
  },
  portrait: {
    label: 'Portrait',
    filename: 'portrait.png',
    width: { min: 1000, max: 3000 },
    height: { min: 500, max: 2000 },
    ratioTarget: 4 / 3,
    ratioTolerance: 0.3, // 允許較寬範圍（各 agent 風格不同）
    maxBytes: 2 * 1024 * 1024, // 2MB（寬鬆，建議 500KB）
    recommendedMaxBytes: 500 * 1024,
    requireTransparency: true,
  },
  emoji: {
    label: 'Emoji',
    filenamePattern: /^emoji-(.+)\.png$/,
    validKeys: ['neutral', 'excited', 'annoyed', 'tired', 'focused', 'bored', 'task_received'],
    requiredKeys: ['neutral', 'excited', 'annoyed', 'tired', 'focused', 'bored'],
    width: { min: 256, max: 4096 },
    height: { min: 256, max: 4096 },
    ratioTarget: 1, // 1:1
    ratioTolerance: 0.05,
    maxBytes: 8 * 1024 * 1024, // 8MB（寬鬆，建議 200KB）
    recommendedMaxBytes: 200 * 1024,
    requireTransparency: true,
  },
};

// ─── 檢測邏輯 ───

async function checkFakeTransparency(filePath, metadata) {
  if (metadata.channels !== 4) return null;

  const { data } = await sharp(filePath)
    .resize(200, 200, { fit: 'fill' }) // 縮小後檢測，省記憶體
    .raw()
    .toBuffer({ resolveWithObject: true });

  let transparentPixels = 0;
  let checkerSuspect = 0;
  const totalPixels = 200 * 200;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 10) transparentPixels++;

    // 棋盤格偵測：不透明區域中相鄰像素灰度劇烈交替
    if (i >= 4 && data[i + 3] > 200) {
      const prevGray = (data[i - 4] + data[i - 3] + data[i - 2]) / 3;
      const currGray = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (Math.abs(prevGray - currGray) > 80) checkerSuspect++;
    }
  }

  const warnings = [];
  if (transparentPixels === 0) {
    warnings.push('無透明像素 — 背景可能未去除或為假透明');
  }
  if (checkerSuspect > totalPixels * 0.08) {
    warnings.push(`疑似棋盤格假透明 (${((checkerSuspect / totalPixels) * 100).toFixed(1)}% 像素高對比交替)`);
  }
  return warnings.length > 0 ? warnings : null;
}

async function validateFile(filePath, spec) {
  const results = { file: path.basename(filePath), errors: [], warnings: [] };

  if (!fs.existsSync(filePath)) {
    results.errors.push('檔案不存在');
    return results;
  }

  const stat = fs.statSync(filePath);
  const metadata = await sharp(filePath).metadata();

  // 格式
  if (metadata.format !== 'png') {
    results.errors.push(`格式錯誤: ${metadata.format}, 應為 png`);
  }

  // 尺寸範圍
  if (metadata.width < spec.width.min || metadata.width > spec.width.max) {
    results.errors.push(`寬度 ${metadata.width}px 超出範圍 [${spec.width.min}, ${spec.width.max}]`);
  }
  if (metadata.height < spec.height.min || metadata.height > spec.height.max) {
    results.errors.push(`高度 ${metadata.height}px 超出範圍 [${spec.height.min}, ${spec.height.max}]`);
  }

  // 比例
  const ratio = metadata.width / metadata.height;
  if (Math.abs(ratio - spec.ratioTarget) > spec.ratioTolerance) {
    results.errors.push(`比例 ${ratio.toFixed(2)} 偏離目標 ${spec.ratioTarget.toFixed(2)} (容許 ±${spec.ratioTolerance})`);
  }

  // 檔案大小
  if (stat.size > spec.maxBytes) {
    results.errors.push(`檔案 ${(stat.size / 1024).toFixed(0)}KB 超過上限 ${(spec.maxBytes / 1024).toFixed(0)}KB`);
  } else if (spec.recommendedMaxBytes && stat.size > spec.recommendedMaxBytes) {
    results.warnings.push(`檔案 ${(stat.size / 1024).toFixed(0)}KB 超過建議值 ${(spec.recommendedMaxBytes / 1024).toFixed(0)}KB`);
  }

  // RGBA 通道
  if (spec.requireTransparency && metadata.channels !== 4) {
    results.errors.push(`缺少 alpha 通道 (channels=${metadata.channels}), 應為 RGBA`);
  }

  // 假透明偵測
  if (spec.requireTransparency) {
    const fakeWarnings = await checkFakeTransparency(filePath, metadata);
    if (fakeWarnings) {
      results.warnings.push(...fakeWarnings);
    }
  }

  return results;
}

async function validateAgent(agentDir, agentId) {
  const report = { agentId, files: [], missingRequired: [] };
  const files = fs.existsSync(agentDir) ? fs.readdirSync(agentDir) : [];

  // Sprite
  const spritePath = path.join(agentDir, 'sprite.png');
  if (files.includes('sprite.png')) {
    report.files.push(await validateFile(spritePath, SPEC.sprite));
  }

  // Portrait
  const portraitPath = path.join(agentDir, 'portrait.png');
  if (files.includes('portrait.png')) {
    report.files.push(await validateFile(portraitPath, SPEC.portrait));
  }

  // Emoji
  const emojiFiles = files.filter(f => SPEC.emoji.filenamePattern.test(f));
  const foundKeys = [];

  for (const f of emojiFiles) {
    const match = f.match(SPEC.emoji.filenamePattern);
    const key = match[1];
    foundKeys.push(key);

    if (!SPEC.emoji.validKeys.includes(key)) {
      report.files.push({
        file: f,
        errors: [`未知的 emoji key "${key}", 有效值: ${SPEC.emoji.validKeys.join(', ')}`],
        warnings: [],
      });
      continue;
    }

    report.files.push(await validateFile(path.join(agentDir, f), SPEC.emoji));
  }

  // 檢查必要 emoji 是否齊全（只在有任何 emoji 時才檢查）
  if (emojiFiles.length > 0) {
    const missing = SPEC.emoji.requiredKeys.filter(k => !foundKeys.includes(k));
    if (missing.length > 0) {
      report.missingRequired.push(`缺少必要 emoji: ${missing.join(', ')}`);
    }
  }

  return report;
}

// ─── 輸出格式化 ───

function printReport(reports) {
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const report of reports) {
    const hasIssues = report.files.some(f => f.errors.length > 0 || f.warnings.length > 0) || report.missingRequired.length > 0;

    if (!hasIssues && report.files.length === 0) {
      console.log(`\n📁 ${report.agentId} — 無圖片資產`);
      continue;
    }

    console.log(`\n📁 ${report.agentId}`);

    for (const f of report.files) {
      const status = f.errors.length > 0 ? '❌' : f.warnings.length > 0 ? '⚠️' : '✅';
      console.log(`  ${status} ${f.file}`);
      for (const e of f.errors) {
        console.log(`     ❌ ${e}`);
        totalErrors++;
      }
      for (const w of f.warnings) {
        console.log(`     ⚠️  ${w}`);
        totalWarnings++;
      }
    }

    for (const m of report.missingRequired) {
      console.log(`  ⚠️  ${m}`);
      totalWarnings++;
    }
  }

  console.log('\n' + '─'.repeat(50));
  if (totalErrors === 0 && totalWarnings === 0) {
    console.log('✅ 所有圖片資產符合規格');
  } else {
    console.log(`結果: ${totalErrors} 個錯誤, ${totalWarnings} 個警告`);
  }

  return totalErrors;
}

// ─── Main ───

async function main() {
  const targetAgent = process.argv[2];
  const baseDir = path.join(__dirname, '..', 'public', 'images', 'agents');

  if (!fs.existsSync(baseDir)) {
    console.log('找不到 public/images/agents/ 目錄');
    process.exit(1);
  }

  console.log('🔍 圖片資產規格驗證');
  console.log('─'.repeat(50));

  const agents = targetAgent ? [targetAgent] : fs.readdirSync(baseDir).filter(d =>
    fs.statSync(path.join(baseDir, d)).isDirectory()
  );

  const reports = [];
  for (const agentId of agents) {
    const agentDir = path.join(baseDir, agentId);
    if (!fs.existsSync(agentDir)) {
      console.log(`找不到 ${agentId} 的圖片目錄`);
      continue;
    }
    reports.push(await validateAgent(agentDir, agentId));
  }

  const errorCount = printReport(reports);
  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('驗證失敗:', err);
  process.exit(1);
});
