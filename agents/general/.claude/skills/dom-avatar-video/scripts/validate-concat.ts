/**
 * 驗證 concat 檔案中的所有圖片是否存在
 * 用法：npx tsx validate-concat.ts <concat_file>
 */

import * as fs from 'fs';
import * as path from 'path';

const concatFile = process.argv[2];

if (!concatFile) {
  console.error('用法: npx tsx validate-concat.ts <concat_file>');
  process.exit(1);
}

if (!fs.existsSync(concatFile)) {
  console.error(`❌ concat 檔案不存在: ${concatFile}`);
  process.exit(1);
}

const concatDir = path.dirname(concatFile);
const content = fs.readFileSync(concatFile, 'utf-8');
const lines = content.split('\n');

let hasError = false;
const files: string[] = [];

for (const line of lines) {
  const match = line.trim().match(/^file\s+'(.+)'$/);
  if (match) {
    const filePath = match[1];
    const fullPath = path.join(concatDir, filePath);
    files.push(filePath);
    
    if (!fs.existsSync(fullPath)) {
      console.error(`❌ 找不到: ${filePath}`);
      hasError = true;
    }
  }
}

if (hasError) {
  console.log('\n可用的表情檔案:');
  const expressionsDir = path.join(concatDir, 'avatar-expressions');
  if (fs.existsSync(expressionsDir)) {
    const available = fs.readdirSync(expressionsDir).filter(f => f.endsWith('.png'));
    available.forEach(f => console.log(`  - avatar-expressions/${f}`));
  }
  process.exit(1);
} else {
  console.log(`✅ 驗證通過，共 ${files.length} 個圖片檔案`);
  files.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}
