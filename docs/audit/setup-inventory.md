# WP-E Setup Inventory

日期：2026-07-04  
狀態：盤查完成；使用者已拍板「全面升級」，Docker/platform 走正式支援路徑  
依據：`docs/PLAN-cleanup-and-governance.md` WP-E

## 現有安裝入口

| 項目 | 現況 | 判斷 |
|---|---|---|
| `.env.example` | 已列出 Discord 主 bot、agent 目錄、Claude/API key/OAuth、Anthropic-compatible proxy、DB、schedule/session 進階參數 | 可作為設定模板，但新手仍需要線性 SETUP 文件。 |
| `agents/example/agent.json` | 最小 agent 設定，含 agent bot token/channel placeholder | 可作為 agent template。 |
| `agents/example/.claude/settings.local.json` | 最小 Claude Code settings，`env` 為空 | 可承接 per-agent provider/API key 設定，但需要文件示例。 |
| `agents/example/schedules/example-daily-check.yaml` | disabled recurring schedule 範例，含 thread delivery 與防低訊號 prompt | 可作為 schedule 範本。 |
| `scripts/setup-check.ts` | 檢查 Node、`.env`、agent JSON、Discord ID/token 形狀、auth mode | 已有基礎靜態 doctor。 |
| `scripts/setup-verify.ts` | 串 `setup:check`、schedule check、typecheck、build | 可驗證模板與 build，但還不是完整 runtime doctor。 |
| `scripts/discord-check.ts` | 可對真實 Discord channel 發測試訊息，選配建立 thread | 可作為實連驗證，但目前不在 `setup:verify` 內自動執行。 |

## 已跑驗證

```text
npm run setup:check -- --template
結果：0 errors, 5 warnings（placeholder 在 template mode 允許）
```

```text
npm run setup:verify -- --template
結果：通過；包含 setup check、example schedule check、typecheck、build
```

```text
docker build --progress=plain --target production -t claudecab:wp-e-runtime .
結果：通過。慢點曾卡在 Dockerfile 對整個 /app 做 chown -R，已改成只 chown agents/data/logs。
```

```text
docker run --rm -d --name claudecab-wp-e-smoke \
  -e NODE_ENV=production \
  -e DISCORD_ENABLED=false \
  -e SCHEDULE_ENABLED=false \
  -e ENABLE_PERSISTENCE=true \
  -e AGENTS_DIR=/app/agents \
  -e DB_PATH=/app/data/smoke.db \
  -v ${PWD}/agents/example:/app/agents/example:ro \
  claudecab:wp-e-runtime

結果：container healthy；/app/data/smoke.db 與 /app/logs/claudecab.*.log 產生；log 顯示
"Discord disabled - skipping agent Discord adapters" 與 "ClaudeCab initialized successfully"。
```

## 主要缺口

| 缺口 | 影響 | 建議處置 |
|---|---|---|
| 尚無 `docs/SETUP.md` | 新手不知道 clone 後每一步要做什麼、哪些是必填/選填 | 新增繁中線性安裝文件，分「最小可跑」與「進階設定」。 |
| `setup:verify` 不檢查 Claude Code CLI binary/版本 | CLI 或平台包缺失時，新手會到 runtime 才炸 | 補 CLI binary resolution、版本輸出、平台包提示。 |
| `setup:verify` 不直接檢查 SDK patch 狀態 | SDK patch 壞掉時可能延後到使用時才出錯 | 將 `scripts/patch-sdk-v2.cjs` 的狀態檢查納入 verify。 |
| DB 初始化未由 doctor 驗證 | 初次部署可能不知道 DB/schema 是否能建立 | 加一個不破壞 production 的本機暫存 DB 初始化檢查。 |
| Discord 實連驗證是獨立命令 | 權限錯誤、token/channel 錯誤需要另跑才知道 | SETUP 明確把 `discord:check` 作為真實 token 準備後的最後一步。 |
| 其他模型服務/provider 設定只有 `.env.example` 文字提示 | 使用者可能不知道要放 per-agent `.claude/settings.local.json` | 在 SETUP 增加 per-agent provider 設定範例，避免全域污染 OAuth。 |
| Docker 檔案仍 tracked 但未驗證 | 新手可能以為 Docker 是官方支援路徑，實際缺 CLI/OAuth/平台包處理 | 使用者已拍板升級為正式支援；本包補文件、compose、verify 邊界。 |

## Docker / platform 策略選項

| 選項 | 做法 | 優點 | 代價 |
|---|---|---|---|
| A. 標記為 experimental（建議） | 保留 `Dockerfile` / `docker-compose.yml`，在 README/SETUP 明確標「未驗證，不是 production 路徑」 | 可回溯、低風險，不誤導新手把 Docker 當首選 | 仍保留半完成檔案，後續要補驗證或移除。 |
| B. 歸檔 Docker 檔 | 移到 `docs/archive/`，README/SETUP 只保留 Windows + dev 路徑 | 最乾淨，避免新手走壞路 | 若未來要支援 Docker 要重新設計。 |
| C. 升級 Docker 為正式支援 | 補 CLI/平台包/OAuth/API key/provider/volume/healthcheck，並納入 setup verify/smoke | 跨平台部署故事完整 | 工作量與維護面最大，且會增加本輪 scope。 |

決策結果：使用者回覆「全面升級」，採用 C。WP-E 會把 Docker 變成明確支援的安裝路徑，但不取代既有 Windows production 啟動鏈。

## WP-E 實作順序

1. 新增 `docs/SETUP.md`：最小安裝、Discord bot 設定、agent template、Claude OAuth/API key、其他 provider、驗證命令、常見錯誤。
2. README 加上 SETUP 入口與 Docker 狀態說明。
3. 強化 `setup:verify`：CLI binary/version、SDK patch 狀態、暫存 DB 初始化、保留不自動發 Discord 的安全邊界。
4. 補測試覆蓋 setup doctor 新增邏輯。
5. 跑 `npm run typecheck`、`npm run lint`、`npm run test:run` 後提交 WP-E。
