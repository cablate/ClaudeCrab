# TTS 模組實作計劃

**目標**：建立 Text-to-Speech 模組，使用 MiniMax Speech 2.8 Turbo（透過 Replicate API）

---

## 架構設計

仿照現有 STT 模組的 **工廠模式 + 提供者模式**：

```
src/core/tts/
├── index.ts              # 工廠函數 + 匯出
├── types.ts              # TTSProvider 介面
└── ReplicateTTSProvider.ts  # MiniMax 實作
```

---

## 實作步驟

### Phase 1: 核心模組

1. **`src/core/tts/types.ts`** — 介面定義
   ```typescript
   interface TTSProvider {
     synthesize(text: string, options?: SynthesizeOptions): Promise<SynthesizeResult>
   }
   interface SynthesizeResult { audio: Buffer; mimeType: string; extension: string }
   interface TTSConfig { provider: 'replicate'; apiToken: string; model?: string }
   ```

2. **`src/core/tts/ReplicateTTSProvider.ts`** — 實作
   - 使用 Replicate SDK 呼叫 `minimax/speech-2.8-turbo`
   - 回傳 MP3 Buffer
   - 含 retry 機制

3. **`src/core/tts/index.ts`** — 工廠
   ```typescript
   export function createTTSProvider(config: TTSConfig): TTSProvider
   ```

4. **`src/types/errors.ts`** — 新增 `TTSError`

### Phase 2: 設定

5. **`src/config.ts`** — 新增 tts 設定區塊
   ```typescript
   tts: { enabled, provider, apiToken, model }
   ```

6. **`.env.example`** — 新增環境變數
   ```
   TTS_ENABLED=false
   TTS_PROVIDER=replicate
   REPLICATE_API_TOKEN=
   TTS_MODEL=minimax/speech-2.8-turbo
   ```

### Phase 3: Adapter 整合

7. **`src/adapters/types.ts`** — 新增 `ttsProvider?` 到 TelegramAdapterConfig

8. **`src/adapters/BaseAdapter.ts`** — 新增 `sendVoice()` 抽象方法

9. **`src/adapters/TelegramAdapter.ts`** — 實作
   - `sendVoice(chatId, audio, options)` — 發送音訊
   - `synthesizeAndSendVoice(chatId, text)` — 合成 + 發送

10. **`src/core/PlatformOrchestrator.ts`** — 傳遞 ttsProvider

11. **`src/AppBootstrap.ts`** — 建立 ttsProvider 並注入

### Phase 4: 依賴

12. **安裝 Replicate SDK**
    ```bash
    npm install replicate
    ```

---

## 關鍵檔案

| 動作 | 檔案 |
|------|------|
| 新增 | `src/core/tts/types.ts` |
| 新增 | `src/core/tts/ReplicateTTSProvider.ts` |
| 新增 | `src/core/tts/index.ts` |
| 修改 | `src/types/errors.ts` |
| 修改 | `src/config.ts` |
| 修改 | `.env.example` |
| 修改 | `src/adapters/types.ts` |
| 修改 | `src/adapters/BaseAdapter.ts` |
| 修改 | `src/adapters/TelegramAdapter.ts` |
| 修改 | `src/core/PlatformOrchestrator.ts` |
| 修改 | `src/AppBootstrap.ts` |

---

## 參考現有實作

- `src/core/stt/types.ts` — 介面設計模式
- `src/core/stt/GroqSTTProvider.ts` — retry、error handling 模式
- `src/AppBootstrap.ts:110-112` — STT provider 建立方式

---

## 驗證方式

1. **TypeScript 編譯**：`npm run build` 無錯誤
2. **單元測試**：測試 ReplicateTTSProvider.synthesize() 回傳正確格式
3. **整合測試**：
   - 設定 `TTS_ENABLED=true` + `REPLICATE_API_TOKEN`
   - 透過 Telegram 觸發 TTS（需額外 command 或 hook）
   - 確認收到語音訊息
