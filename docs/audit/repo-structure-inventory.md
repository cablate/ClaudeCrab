# WP-D Repo Structure Inventory

日期：2026-07-04  
狀態：盤查完成，code/doc 清理同步執行  
依據：`docs/PLAN-cleanup-and-governance.md` WP-D

## Root 盤查

| 項目 | tracked | 判斷 | 處置 |
|---|---:|---|---|
| `.env` | 否 | 本機 secret | 保持 ignore，不讀內容。 |
| `.claude/`, `.agents/`, `.codex/`, `.serena/`, `.codegraph/` | 否 | 本機 AI/runtime 狀態 | 保持 ignore。 |
| `agents/*` | 部分 | `agents/example/` 是開源模板，其餘本機 agent 外掛 | 保持現有 ignore 規則。 |
| `claudecab.pid`, `claudecab.runtime.json` | 否 | production supervisor runtime 產物 | 已 ignore；本包不碰 `start.ts` 實際路徑。 |
| `data/`, `dist/`, `logs/`, `temp/`, `node_modules/`, `Python/` | 否 | runtime/build/local dependency | 已 ignore；不搬動本機目錄。 |
| `ecosystem.config.cjs` | 是 | PM2 舊設定，無 runtime 引用 | 移入 `docs/archive/`。 |
| `Dockerfile`, `docker-compose.yml` | 是 | Docker 路徑未驗證，屬 WP-E 使用者拍板 | 本包不處理。 |

## Docs 盤查

| 文件 | 判斷 | 處置 |
|---|---|---|
| `docs/ARCHITECTURE.md` | 現行架構入口 | 保留。 |
| `docs/LOGGING.md` | log 查詢入口 | 保留。 |
| `docs/SDK_TOUCHPOINTS.md` | WP-C 產出，SDK 升級入口 | 保留。 |
| `docs/sop-sdk-cli-upgrade.md` | SDK/CLI 升級 SOP | 保留。 |
| `docs/PLAN-cleanup-and-governance.md` | 本輪治理執行計畫 | 全部完成後再歸檔。 |
| `docs/current-architecture-review-2026-06-19.md` | 已完成架構盤點快照 | 移入 archive。 |
| `docs/SCHEDULE_THREAD_CONTINUATION_FIX_PLAN.md` | 已完成修復計畫 | 移入 archive。 |
| `docs/SESSION_OPERATIONS_AND_REVIEW_FIX_PLAN.md` | 已完成修復計畫 | 移入 archive。 |
| `docs/workflow-audit-agent-configs.md` | 已完成 agent config workflow 盤點 | 移入 archive。 |

## Scripts 盤查

| script | 用途 | 保留理由 |
|---|---|---|
| `scripts/setup-check.ts` | 檢查 agent template / agent.json / 基本 Discord 設定 | WP-E setup doctor 基礎。 |
| `scripts/setup-verify.ts` | 驗證 Node/npm/SDK patch/CLI binary 等 runtime prerequisites | WP-E setup doctor 基礎。 |
| `scripts/discord-check.ts` | 獨立檢查單一 agent Discord bot/channel | 安裝與排錯需要。 |
| `scripts/schedule-tool.ts` | schedule list/validate/check/run/trigger/discord-test CLI | schedule 核心模組驗證需要。 |
| `scripts/patch-sdk-v2.cjs` | postinstall SDK patch | WP-C 登記的必要 touchpoint。 |

## 決策點

- Docker 支援去留屬 WP-E 明確決策點，本包不自行移除。
- production 啟動鏈 `Task Scheduler + VBS + start.ts` 不在本包更動。

## 驗收

- root tracked 檔案保留理由清楚。
- docs root 只留下現行入口、SOP、執行中的治理計畫。
- 新增 `docs/README.md` 與 `scripts/README.md` 作為索引。
- `npm run typecheck`、`npm run lint`、`npm run test:run` 通過。
