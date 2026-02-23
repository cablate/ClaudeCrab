# 低難度功能規劃

建立日期：2026-02-23

---

## 1. Schedule 模型設定功能

**目標**：讓 schedule YAML 可以指定執行用的 model（opus/sonnet/haiku）

### 改動範圍

| 檔案 | 改動 |
|------|------|
| `src/schedule/schemas.ts` | `ExecutionSchema` 新增 `model` 欄位 |
| `src/schedule/ScheduleExecutor.ts` | `executeQuery` 呼叫時傳入 model |

### 實作細節

**1. schemas.ts**
```typescript
ExecutionSchema = z.object({
  agent: z.string(),
  prompt: z.string(),
  maxTurns: z.number().positive().optional(),
  timeout: z.number().positive().optional(),
  model: z.enum(['sonnet', 'opus', 'haiku']).optional(),  // 新增
})
```

**2. ScheduleExecutor.ts** (execute 方法內)
```typescript
// 在 executeQuery 呼叫前，組裝 model 參數
const modelOption = spec.execution.model 
  ? { model: `claude-${spec.execution.model}-4-...` }  // 需要 model name mapping
  : {};

return await this.sdkManager.executeQuery(
  retrySessionId,
  spec.execution.prompt,
  agent,
  {
    ...existingOptions,
    additionalOptions: {
      ...existingOptions.additionalOptions,
      ...modelOption,
    },
  }
);
```

**3. Model Name Mapping（選項）**

方案 A：直接用 shorthand，SDK 可能支援 `sonnet`/`opus`/`haiku`
方案 B：建立 mapping table
```typescript
const MODEL_MAP = {
  'sonnet': 'claude-sonnet-4-5-20250929',
  'opus': 'claude-opus-4-20250514',
  'haiku': 'claude-haiku-3-5-20241022',
};
```

### YAML 使用範例
```yaml
id: cost-sensitive-task
execution:
  agent: general
  prompt: "簡單摘要任務..."
  model: haiku   # 使用便宜的 haiku，不需要 opus
```

### 風險評估
- **低風險** - 純新增 optional 欄位
- **向後相容** - 不指定 model 則用預設

---

## 2. 本地語音播放功能

**目標**：Schedule 完成時播放本地音效通知

### 改動範圍

| 檔案 | 改動 |
|------|------|
| `src/schedule/schemas.ts` | `NotificationSchema` 新增 `localSound` 欄位 |
| `src/schedule/ScheduleNotifier.ts` | 新增 `playLocalSound()` 方法 |
| `package.json` | 新增 `sound-play` 依賴 |

### 實作細節

**1. 安裝依賴**
```bash
npm install sound-play
```

**2. schemas.ts**
```typescript
NotificationSchema = z.object({
  onComplete: z.boolean().optional(),
  onError: z.boolean().optional(),
  platform: z.string().optional(),
  chatId: z.string().optional(),
  localSound: z.object({                    // 新增
    onComplete: z.string().optional(),      // 音效檔路徑
    onError: z.string().optional(),
  }).optional(),
})
```

**3. ScheduleNotifier.ts**
```typescript
import sound from 'sound-play';

// 新增方法
private async playLocalSound(soundPath: string): Promise<void> {
  try {
    await sound.play(soundPath);
    logger.debug(`[ScheduleNotifier] Played sound: ${soundPath}`);
  } catch (error) {
    logger.warn({ error, soundPath }, '[ScheduleNotifier] Failed to play sound');
  }
}

// 修改 notifyComplete
async notifyComplete(spec: ScheduleSpec, result: QueryResult): Promise<void> {
  // ... existing telegram notification ...
  
  // 播放本地音效
  if (spec.notification?.localSound?.onComplete) {
    await this.playLocalSound(spec.notification.localSound.onComplete);
  }
}

// 修改 notifyError
async notifyError(spec: ScheduleSpec, error: unknown): Promise<void> {
  // ... existing telegram notification ...
  
  // 播放本地音效
  if (spec.notification?.localSound?.onError) {
    await this.playLocalSound(spec.notification.localSound.onError);
  }
}
```

### YAML 使用範例
```yaml
id: important-task
notification:
  onComplete: true
  chatId: "1491057815"
  localSound:
    onComplete: "C:/sounds/success.mp3"
    onError: "C:/sounds/error.mp3"
```

### 測試方式
1. 準備一個 .mp3 或 .wav 音效檔
2. 建立測試 schedule（trigger: manual 或短時間 cron）
3. 執行後確認音效播放

### 風險評估
- **低風險** - 獨立功能，不影響現有流程
- **依賴風險** - `sound-play` 是成熟套件，支援 Windows/macOS
- **向後相容** - localSound 是 optional

---

## 實作順序建議

1. **Schedule 模型設定**（更簡單，純邏輯改動）
2. **本地語音播放**（需要新增依賴，但測試容易）
