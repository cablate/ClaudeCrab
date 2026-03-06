## Purpose

本規格定義 ClaudeCab 系統的架構不變量與契約——一個建構於 Claude Agent SDK 之上的多 Agent Telegram Bot 平台。涵蓋技術堆疊限制、核心模組職責、資料流、Agent 設定，以及分層隔離邊界。

## Requirements

### Requirement: 技術堆疊限制

系統應（SHALL）以開啟 strict mode 的 TypeScript 5.x 實作。執行環境應（SHALL）要求 Node.js 20 或以上版本。所有 AI 呼叫應（SHALL）僅透過 `@anthropic-ai/claude-agent-sdk` 發出——禁止直接使用 `@anthropic-ai/sdk`（Anthropic API client）。輸入驗證應（SHALL）使用 Zod schema。持久化應（SHALL）透過 `better-sqlite3` 使用 SQLite。Telegram 整合應（SHALL）使用 grammy 函式庫。`any` 型別不得（MUST NOT）出現在程式碼庫的任何位置。

#### Scenario: TypeScript strict mode 強制執行

- **WHEN** 程式碼庫進行編譯
- **THEN** TypeScript 編譯器必須（MUST）以 `strict: true` 且零個 `any` 使用成功完成

#### Scenario: AI SDK 限制

- **WHEN** 任何模組需要呼叫 LLM
- **THEN** 必須（MUST）透過 `claude-agent-sdk` 的 `query()` 函式執行，且不得（MUST NOT）從 `@anthropic-ai/sdk` 匯入

#### Scenario: 執行環境版本檢查

- **WHEN** 應用程式啟動
- **THEN** 若 Node.js 版本低於 20，應（SHALL）快速失敗

---
### Requirement: 應用程式進入點與啟動流程

應用程式進入點（`src/index.ts`）應（SHALL）保持精簡（約 20 行），並將所有生命週期管理委派給 `AppBootstrap`。`AppBootstrap` 應（SHALL）負責完整的初始化與優雅關閉序列。環境變數應（SHALL）在單一位置（`src/config.ts`）以 `AppConfig` 形式解析與驗證。

#### Scenario: 委派式啟動

- **WHEN** `src/index.ts` 被執行
- **THEN** 它應（SHALL）實例化並呼叫 `AppBootstrap`，本身不包含任何業務邏輯

#### Scenario: 集中式設定

- **WHEN** 任何模組需要存取環境變數
- **THEN** 它應（SHALL）從 `src/config.ts` 產生的 `AppConfig` 物件讀取，且不得（MUST NOT）直接呼叫 `process.env`

---
### Requirement: Agent 設定目錄結構

Each Agent SHALL be represented as a self-contained directory under `agents/`, which MUST contain three mandatory items: `agent.json` (ClaudeCab metadata), `CLAUDE.md` (system prompt), and `.claude/settings.local.json` (SDK permissions and model). `agent.json` MUST conform to the `AgentConfig` Zod schema. `settings.local.json` is managed by the SDK and SHALL be loaded via `settingSources: ['project', 'local']`. Each Agent directory MAY contain an `evolution/` subdirectory with `weekly/` and `proposals/` subdirectories for the self-evolution mechanism. The `CLAUDE.md` file SHALL support a User Expectations section positioned as a high-weight section near the top of the file, which the daily reflection cycle uses as its primary gap-identification benchmark.

#### Scenario: Agent 目錄結構驗證

- **WHEN** `AgentLoader` scans the `agents/` directory
- **THEN** it SHALL reject any subdirectory that does not contain a valid `agent.json` passing Zod schema validation

#### Scenario: settings.local.json 所有權

- **WHEN** the SDK approves a tool at runtime
- **THEN** it MAY dynamically write to the `permissions.allow` array in `settings.local.json`, and the application MUST NOT overwrite this file in a way that loses SDK-managed fields

#### Scenario: Agent 繼承

- **WHEN** `agent.json` specifies an `extends` field
- **THEN** `AgentLoader` SHALL merge the parent Agent's configuration, with child values taking precedence

#### Scenario: Evolution directory is optional

- **WHEN** `AgentLoader` scans an Agent directory that does not contain `evolution/`
- **THEN** validation SHALL pass normally — evolution/ is not a mandatory directory

#### Scenario: User Expectations section in CLAUDE.md

- **WHEN** an Agent's CLAUDE.md contains a User Expectations section
- **THEN** AgentLoader SHALL load it as part of the system prompt without special handling — it is treated as regular CLAUDE.md content


<!-- @trace
source: agent-self-evolution
updated: 2026-03-03
code:
  - agents/general/output/kgaiwin_backup/L7/css/style.css
  - agents/general/output/kgaiwin_backup/image/l4/tombol/btn.gif
  - agents/general/output/kgaiwin_backup/elements/images/sincerely-media-HoEYgBL_Gcs-unsplash-mobile.jpg
  - openspec-migration-plan.md
  - agents/general/output/kgaiwin_backup/elements/images/news/gilles-lambert-S_LhjpfIdm4-unsplash.jpg
  - agents/general/evolution/weekly/.gitkeep
  - AGENTS.md
  - agents/admin/schedules/daily-growth-review.yaml
  - agents/general/output/kgaiwin_backup/css/style5.css
  - agents/general/output/kgaiwin_backup/elements/images/team/rc-cf-FMh5o5m5N9E-unsplash.jpg
  - agents/admin/schedules/weekly-collaboration-review.yaml
  - agents/general/output/kgaiwin_backup/download_kgaiwin.py
  - agents/general/output/kgaiwin_backup/image/l6/bg.webp
  - agents/general/output/kgaiwin_backup/image/lindex/bg.webm
  - agents/admin/evolution/proposals/.gitkeep
  - agents/general/.claude/skills/style-driven-author/author-style-methodology.md
  - agents/general/evolution/proposals/.gitkeep
  - agents/general/output/kgaiwin_backup/Henric-ai.zip
  - agents/admin/evolution/weekly/.gitkeep
  - agents/general/output/frame_28s.png
  - agents/general/output/kgaiwin_backup/image/l4/bg.webm
  - doc-cleanup-charter.md
  - agents/general/output/kgaiwin_backup/this3.html
  - agents/general/output/kgaiwin_backup/elements/images/header/priscilla-du-preez-W3SEyZODn8U-unsplash.jpg
  - agents/general/output/check_broll_test.png
  - agents/general/output/kgaiwin_backup/elements/images/header/rod-long-I79Pgmhmy5M-unsplash.jpg
  - agents/general/output/kgaiwin_backup/elements/images/lunch/farhad-ibrahimzade-D5c9ZciQy_I-unsplash.jpg
  - agents/general/output/kgaiwin_backup/image/l1/tombol/btn.gif
  - agents/general/output/kgaiwin_backup/1.html
  - agents/general/output/kgaiwin_backup/image/l2/bg.webm
  - agents/general/output/kgaiwin_backup/L10/image/tombol/btn.jpg
  - agents/general/output/kgaiwin_backup/elements/images/sincerely-media-HoEYgBL_Gcs-unsplash.jpg
  - agents/general/output/kgaiwin_backup/elements/js/bootstrap.bundle.min.js
  - agents/general/output/kgaiwin_backup/elements/images/slide/jason-leung-O67LZfeyYBk-unsplash.jpg
  - agents/general/output/kgaiwin_backup/assets/load1.html
  - agents/general/output/check_14_2s.png
  - agents/general/output/kgaiwin_backup/L10/image/tombol/btn.webp
  - agents/general/output/kgaiwin_backup/4.html
  - agents/general/output/ai.png
  - agents/general/output/kgaiwin_backup/image/l3/tombol/btn.gif
  - agents/general/output/kgaiwin_backup/Lindex.html
  - agents/general/output/kgaiwin_backup/assets/load2.html
  - agents/general/output/kgaiwin_backup/image/l6/tombol/btn.webp
  - agents/general/output/kgaiwin_backup/elements/images/news/priscilla-du-preez-W3SEyZODn8U-unsplash.jpg
  - agents/general/output/kgaiwin_backup/L9/image/tombol/btn.webp
  - agents/general/output/kgaiwin_backup/css/style2.css
  - agents/general/output/kgaiwin_backup/assets/load4.html
  - agents/_example/.claude/rules/self-evolution.md
  - agents/general/output/kgaiwin_backup/L2.html
  - agents/general/output/kgaiwin_backup/elements/images/dinner/farhad-ibrahimzade-ZipYER3NLhY-unsplash.jpg
  - agents/general/schedules/morning-summary.yaml
  - agents/general/output/kgaiwin_backup/elements/css/tooplate-crispy-kitchen.css
  - agents/general/output/final_14s.png
  - agents/general/output/check_28s.png
  - agents/general/output/final_32s.png
  - agents/general/output/kgaiwin_backup/elements/fonts/bootstrap-icons.woff2
  - agents/general/output/kgaiwin_backup/elements/images/news/ella-olsson-mmnKI8kMxpc-unsplash.jpg
  - agents/admin/knowledge/self-evolution-management-guide.md
  - agents/general/output/kgaiwin_backup/assets/load.html
  - agents/general/output/kgaiwin_backup/image/l5/bg.avif
  - agents/admin/CLAUDE.md
  - agents/general/output/kgaiwin_backup/L10.html
  - agents/general/output/kgaiwin_backup/elements/images/dinner/farhad-ibrahimzade-isHUj3N0194-unsplash.jpg
  - agents/general/output/kgaiwin_backup/elements/css/bootstrap-icons.css
  - agents/general/output/kgaiwin_backup/V2.html
  - agents/admin/knowledge/agent-changes-log.md
  - agents/general/output/kgaiwin_backup/urls.txt
  - agents/general/output/kgaiwin_backup/image/l5/tombol/btn.avif
  - agents/general/output/kgaiwin_backup/h-wlc.zip
  - agents/general/output/check_15s.png
  - agents/general/output/kgaiwin_backup/L10/assets/load.html
  - agents/general/output/kgaiwin_backup/L4.html
  - agents/general/output/kgaiwin_backup/assets/load3.html
  - agents/general/output/kgaiwin_backup/image/l5/bg.jpg
  - agents/general/output/kgaiwin_backup/L7/image/bg.webp
  - agents/general/output/kgaiwin_backup/image/l3/bg.mp4
  - agents/_example/evolution/proposals/.gitkeep
  - agents/_example/evolution/GROWTH-REVIEW-PROTOCOL.md
  - agents/general/output/broll/ai.png
  - agents/general/.claude/settings.local.json
  - agents/general/output/kgaiwin_backup/image/lindex/tombol/btn.gif
  - agents/general/output/check_16s.png
  - agents/general/output/kgaiwin_backup/LV2.html
  - agents/general/output/kgaiwin_backup/L7/image/bg.avif
  - agents/general/output/frame_1s.png
  - agents/general/output/kgaiwin_backup/elements/video/production_ID_3769033.mp4
  - agents/general/output/kgaiwin_backup/image/l5/bg.webp
  - agents/general/output/kgaiwin_backup/image/l6/tombol/btn.jpg
  - agents/general/output/kgaiwin_backup/Goat.zip
  - agents/general/output/kgaiwin_backup/elements/images/header/luisa-brimble-aFzg83dvnAI-unsplash.jpg
  - agents/general/output/kgaiwin_backup/Henric-ai (1).zip
  - agents/general/output/kgaiwin_backup/elements/images/news/news-detail-header.jpg
  - agents/general/output/kgaiwin_backup.zip
  - agents/general/output/kgaiwin_backup/elements/images/daan-evers-tKN1WXrzQ3s-unsplash.jpg
  - agents/general/output/kgaiwin_backup/henric-----.zip
  - agents/general/output/kgaiwin_backup/2129_crispy_kitchen.zip
  - agents/general/output/kgaiwin_backup/elements/images/header/briana-tozour-V_Nkf1E-vYA-unsplash.jpg
  - agents/general/output/check_14s.png
  - agents/general/output/newsletter-ep15/original-data.md
  - agents/general/output/traffic.png
  - agents/general/output/broll/traffic.png
  - agents/_example/evolution/weekly/.gitkeep
  - agents/general/output/kgaiwin_backup/L9/image/tombol/btn.avif
  - agents/coder/CLAUDE.md
  - agents/general/output/newsletter-ep15/final.md
  - agents/_example/evolution/proposals/TEMPLATE.md
  - agents/general/output/kgaiwin_backup/elements/images/team/matthew-hamilton-tNCH0sKSZbA-unsplash.jpg
  - agents/general/output/kgaiwin_backup/L7/image/bg.jpg
  - agents/general/output/kgaiwin_backup/elements/fonts/bootstrap-icons.woff
  - agents/general/output/kgaiwin_backup/henric----- (1).zip
  - agents/coder/.claude/hooks/project-whitelist.ts
  - agents/general/output/kgaiwin_backup/css/style.css
  - agents/general/output/kgaiwin_backup/R2.html
  - agents/_example/CLAUDE.md
  - agents/general/output/kgaiwin_backup/css/style6.css
  - agents/general/.claude/skills/style-driven-author/SKILL.md
  - agents/general/output/kgaiwin_backup/image/l4/bg.mp4
  - agents/general/knowledge/claude-code-prompts-analysis.md
  - agents/general/output/kgaiwin_backup/L5.html
  - agents/admin/schedules/daily-reflection.yaml
  - agents/general/output/kgaiwin_backup/L8/image/bg.jpg
  - agents/general/output/kgaiwin_backup/image/l1/bg.webm
  - agents/general/output/kgaiwin_backup/L9/image/tombol/btn.jpg
  - agents/general/output/kgaiwin_backup/L8/image/tombol/btn.avif
  - agents/general/output/kgaiwin_backup/Findex.html
  - agents/general/CLAUDE.md
  - agents/general/knowledge/ganttai-fundraising-v2-review.md
  - agents/general/output/kgaiwin_backup/L10/image/bg.avif
  - agents/admin/schedules/daily-memory-digest.yaml
  - agents/general/output/kgaiwin_backup/L10/css/style.css
  - agents/general/output/kgaiwin_backup/elements/js/jquery.min.js
  - agents/general/output/broll/template.png
  - agents/general/output/kgaiwin_backup/this2.html
  - agents/general/output/kgaiwin_backup/image/l5/tombol/btn.webp
  - agents/general/output/kgaiwin_backup/image/l6/bg.jpg
  - agents/general/output/kgaiwin_backup/L9/image/bg.jpg
  - agents/general/output/kgaiwin_backup/L10/image/tombol/btn.avif
  - agents/coder/schedules/daily-memory-digest.yaml
  - agents/general/output/check_32s.png
  - agents/general/output/newsletter-ep15/review.md
  - agents/general/schedules/daily-memory-digest.yaml
  - agents/general/output/kgaiwin_backup/elements/images/lunch/louis-hansel-cH5IPjaAYyo-unsplash.jpg
  - agents/general/output/kgaiwin_backup/L10/image/bg.webp
  - agents/general/output/kgaiwin_backup/assets/load5.html
  - agents/general/output/kgaiwin_backup/elements/images/breakfast/lucas-swennen-1W_MyJSRLuQ-unsplash.jpg
  - agents/general/output/kgaiwin_backup/elements/images/news/caroline-attwood-bpPTlXWTOvg-unsplash.jpg
  - agents/general/output/newsletter-ep15/final-v5.md
  - agents/general/output/kgaiwin_backup/image/l6/tombol/btn.avif
  - agents/general/output/kgaiwin_backup/R3.html
  - agents/general/output/template_test_broll.mp4
  - agents/general/schedules/daily-reflection.yaml
  - agents/general/output/kgaiwin_backup/image/l6/bg.avif
  - agents/general/output/kgaiwin_backup/L8/css/style.css
  - agents/general/output/kgaiwin_backup/elements/images/author/shoeib-abolhassani-ojl7T2Ah93U-unsplash.jpg
  - agents/coder/schedules/daily-reflection.yaml
  - agents/general/output/kgaiwin_backup/L7/image/tombol/btn.jpg
  - agents/general/output/kgaiwin_backup/V1.html
  - agents/general/output/kgaiwin_backup/L8/image/bg.webp
  - agents/_example/evolution/REFLECTION-PROTOCOL.md
  - agents/general/output/newsletter-ep15/final-v2.md
  - agents/general/output/kgaiwin_backup/elements/images/slide/jay-wennington-N_Y88TWmGwA-unsplash.jpg
  - agents/general/output/kgaiwin_backup/L8.html
  - agents/general/output/kgaiwin_backup/L10/image/bg.jpg
  - CLAUDE.md
  - agents/general/output/idea.png
  - agents/coder/evolution/weekly/.gitkeep
  - agents/general/output/kgaiwin_backup/L8/image/bg.avif
  - agents/general/output/kgaiwin_backup/elements/images/alex-haney-CAhjZmVk5H4-unsplash.jpg
  - agents/general/output/final_16s.png
  - agents/general/.claude/skills/style-driven-author/references/newsletter-style.md
  - agents/general/output/kgaiwin_backup/image/l2/bg.mp4
  - agents/general/output/kgaiwin_backup/L7/image/tombol/btn.avif
  - agents/general/output/template_broll.png
  - agents/general/output/newsletter-ep15/final-v4.md
  - agents/general/output/kgaiwin_backup/L9/image/bg.avif
  - agents/general/output/kgaiwin_backup/L6.html
  - agents/general/output/kgaiwin_backup/elements/images/dinner/keriliwi-c3mFafsFz2w-unsplash.jpg
  - agents/general/output/kgaiwin_backup/F2.html
  - agents/general/output/kgaiwin_backup/L8/image/tombol/btn.webp
  - agents/general/output/kgaiwin_backup/elements/images/team/nicolas-horn-MTZTGvDsHFY-unsplash.jpg
  - agents/general/output/kgaiwin_backup/R1.html
  - agents/general/output/kgaiwin_backup/L3.html
  - agents/general/output/kgaiwin_backup/L9/assets/load.html
  - agents/general/output/kgaiwin_backup/L7.html
  - agents/general/output/kgaiwin_backup/L9/image/bg.webp
  - agents/general/output/kgaiwin_backup/elements/images/breakfast/louis-hansel-dphM2U1xq0U-unsplash.jpg
  - agents/general/output/kgaiwin_backup/L9/css/style.css
  - agents/admin/knowledge/growth-reviews/daily/.gitkeep
  - agents/general/output/kgaiwin_backup/L1.html
  - agents/general/output/newsletter-ep15/final-v3.md
  - agents/general/output/kgaiwin_backup/elements/images/news/stefan-johnson-xIFbDeGcy44-unsplash.jpg
  - agents/general/output/newsletter-ep15/structure.md
  - agents/general/output/kgaiwin_backup/elements/images/news/louis-hansel-GiIiRV0FjwU-unsplash.jpg
  - agents/general/output/kgaiwin_backup/L9.html
  - agents/general/output/kgaiwin_backup/elements/images/breakfast/brett-jordan-8xt8-HIFqc8-unsplash.jpg
  - agents/general/output/kgaiwin_backup/elements/images/author/alexander-hipp-iEEBWgY_6lA-unsplash.jpg
  - agents/general/output/kgaiwin_backup/L7/image/tombol/btn.webp
  - agents/general/output/kgaiwin_backup/style5.css
  - agents/general/output/kgaiwin_backup/image/lindex/bg.mp4
  - agents/general/output/kgaiwin_backup/elements/images/lunch/louis-hansel-rheOvfxOlOA-unsplash.jpg
  - agents/general/output/kgaiwin_backup/L8/assets/load.html
  - agents/general/output/frame_14s.png
  - claudecab.db
  - agents/general/output/kgaiwin_backup/L7/assets/load.html
  - agents/coder/evolution/proposals/.gitkeep
  - agents/general/output/kgaiwin_backup/image/l2/tombol/btn.gif
  - agents/general/output/newsletter-ep15/draft-v1.md
  - agents/general/output/kgaiwin_backup/elements/images/charles-deluvio-FdDkfYFHqe4-unsplash.jpg
  - agents/general/output/kgaiwin_backup/elements/js/custom.js
  - agents/transcriber/.claude/skills/dom-turboscribe/output/knowledge_plan_webinar.txt
  - agents/general/output/kgaiwin_backup/image/l5/tombol/btn.jpg
  - agents/general/output/kgaiwin_backup/css/style4.css
  - agents/general/output/kgaiwin_backup/assets/load6.html
  - agents/general/output/kgaiwin_backup/elements/images/lunch/farhad-ibrahimzade-MGKqxm6u2bc-unsplash.jpg
  - agents/general/output/kgaiwin_backup/image/l1/bg.mp4
  - agents/admin/schedules/weekly-growth-review.yaml
  - agents/general/.claude/skills/sys-proficiency/references/levels.md
  - agents/general/output/kgaiwin_backup/elements/images/slide/ivan-torres-MQUqbmszGGM-unsplash.jpg
  - agents/admin/knowledge/growth-reviews/weekly/.gitkeep
  - agents/general/output/kgaiwin_backup/image/l3/bg.webm
  - agents/general/output/kgaiwin_backup/L8/image/tombol/btn.jpg
  - agents/general/output/kgaiwin_backup/css/style3.css
  - agents/general/output/broll/idea.png
  - agents/general/output/kgaiwin_backup/elements/images/news/pablo-merchan-montes-Orz90t6o0e4-unsplash.jpg
  - agents/general/output/final_28s.png
  - agents/general/output/kgaiwin_backup/css/style1.css
  - agents/general/output/kgaiwin_backup/elements/css/bootstrap.min.css
tests:
  - agents/general/output/test_broll_check.mp4
  - agents/general/output/test_broll_concat2.txt
  - agents/general/output/test_broll_concat.txt
  - agents/general/output/test_nobroll.mp4
-->

---
### Requirement: AgentLoader 動態系統提示

`AgentLoader` 應（SHALL）支援兩種系統提示存取模式：啟動時快取與每次查詢時從磁碟讀取。`readSystemPrompt(agentId)` 方法應（SHALL）在每次呼叫時從磁碟重新讀取 `CLAUDE.md`，使 Agent 能在執行時修改自身的系統提示。`loadSystemPrompt()` 應（SHALL）自動將引擎層全域靜態規則（例如 `[send:path]` 檔案傳送語法）附加至每個 Agent 的系統提示末尾。

#### Scenario: 執行時 CLAUDE.md 重新載入

- **WHEN** `MessageProcessor` 在每次 SDK 查詢前呼叫 `getSystemPrompt(agentId)`
- **THEN** `AgentLoader.readSystemPrompt()` 應（SHALL）從磁碟讀取檔案並回傳當前內容，而非快取值

#### Scenario: 全域規則注入

- **WHEN** `AgentLoader` 組裝最終系統提示
- **THEN** 它應（SHALL）在 Agent 自身 CLAUDE.md 內容之後附加 `getGlobalStaticRules()` 的輸出

---
### Requirement: SDKQueryManager 隔離

`SDKQueryManager` 應（SHALL）是唯一呼叫 SDK `query()` 函式的模組。它應（SHALL）僅接受 `systemPrompt` 字串與 `cwd` 路徑作為主要輸入。它不得（MUST NOT）包含任何業務邏輯，例如記憶體注入、使用者設定檔組裝，或對話歷史格式化。系統提示應（SHALL）使用 SDK preset append 模式傳遞（`{ type: 'preset', preset: 'claude_code', append: systemPrompt }`），以保留 Claude Code 的內建提示與安全規則。`SDKQueryManager` 必須（MUST）設計為可移植，無需修改即可在 ClaudeCab 以外使用。

#### Scenario: Preset append 模式

- **WHEN** `SDKQueryManager` 呼叫 `query()`
- **THEN** `systemPrompt` 選項必須（MUST）使用 `{ type: 'preset', preset: 'claude_code', append: ... }` 格式，且不得（MUST NOT）使用純字串覆寫

#### Scenario: 查詢層不含業務邏輯

- **WHEN** `SDKQueryManager` 執行查詢
- **THEN** 它不應（SHALL NOT）讀取記憶體檔案、注入使用者設定檔，或執行任何 Agent 特定的資料組裝

#### Scenario: 對話恢復

- **WHEN** 一個 session 儲存了 `sdkSessionId`
- **THEN** `SDKQueryManager` 應（SHALL）透過 `resume` 選項將其傳遞給 SDK，若失敗則應（SHALL）在清除已儲存的 ID 後重試一次，且不帶 `resume` 選項

#### Scenario: 中間訊息串流

- **WHEN** SDK 在多輪查詢過程中產生 assistant 訊息
- **THEN** 應（SHALL）立即對每則訊息呼叫 `onIntermediateMessage` callback，以實現對使用者的即時傳遞

---
### Requirement: SessionManager 與對話連續性

`SessionManager` 應（SHALL）以複合鍵 `platform::agentId::userId` 字串識別每個 session。每個組合應（SHALL）在記憶體中僅有一個活躍 session。建立新 session 時，`SessionManager` 應（SHALL）向資料庫查詢該鍵的前一個 `session_id` 與 `sdk_session_id`，並應（SHALL）重用它們以維持對話連續性。過期的 session 應（SHALL）從記憶體中移除，但不得（MUST NOT）從資料庫中刪除。早於 `dbRetentionMs`（預設 30 天）的資料庫資料列應（SHALL）在重啟時清理。

#### Scenario: Session 鍵唯一性

- **WHEN** 兩個使用者在同一平台上向同一個 Agent 傳送訊息
- **THEN** 它們各自應（SHALL）擁有獨立的 session，且不共享狀態

#### Scenario: 重啟後的對話連續性

- **WHEN** 為曾經互動過的使用者建立新 session
- **THEN** `SessionManager` 應（SHALL）從資料庫還原前一個 `sdkSessionId`，以保留 SDK 的對話歷史

#### Scenario: 冪等訊息處理

- **WHEN** 相同的訊息 ID 到達超過一次（例如因重試）
- **THEN** `SessionManager` 應（SHALL）將其判定為重複，且該訊息不應（SHALL NOT）被再次處理

#### Scenario: 並發請求保護

- **WHEN** 同一個 session 同時收到兩則訊息
- **THEN** 分散式互斥鎖（async-mutex）應（SHALL）確保每次只處理一則

---
### Requirement: 資料流——訊息至回應

標準訊息處理管線應（SHALL）遵循以下序列：(1) Platform Adapter 接收平台原生訊息並轉換為 `UnifiedMessage`；(2) `MessageProcessor` 執行冪等性檢查與 session 管理；(3) `SDKQueryManager` 以 Agent 的 `cwd` 與系統提示執行查詢；(4) 回應被處理並持久化；(5) Platform Adapter 將回應傳遞給使用者。此管線中的任何步驟都不應（SHALL）被跳過。

#### Scenario: UnifiedMessage 作為 Adapter 契約

- **WHEN** 任何 platform adapter 收到入站訊息
- **THEN** 它應（SHALL）在將訊息傳遞至下游前將其轉換為 `UnifiedMessage`，且不得讓平台特定型別洩漏至 `MessageProcessor`

#### Scenario: 完整管線執行

- **WHEN** `MessageProcessor.processMessage()` 被呼叫
- **THEN** 它應（SHALL）始終依序執行所有查詢後步驟：`saveSDKSessionId()`、`updateInjectionCursor()`、`persistConversation()`、`sendFinalResponse()`，以及 `emitBotRepliedEvent()`

#### Scenario: 訊息長度處理

- **WHEN** 回應文字超過 4096 個字元（Telegram 的限制）
- **THEN** Adapter 應（SHALL）在傳送前將其分割為多則訊息

---
### Requirement: 記憶體系統——引擎層零程式碼

Agent 記憶體系統應（SHALL）在引擎層不含任何程式碼的情況下實作。引擎（`src/`）應（SHALL）不知曉記憶體檔案、使用者設定檔或每日日誌。記憶體管理應（SHALL）完全由每個 Agent 的 `CLAUDE.md` 中的指令驅動，該指令引導 Agent 使用其 Read/Write 工具能力管理自身的工作區檔案。引擎不應（SHALL NOT）將記憶體內容組裝至系統提示中。

#### Scenario: 引擎對記憶體一無所知

- **WHEN** `SDKQueryManager`、`MessageProcessor` 或 `AgentLoader` 處理請求
- **THEN** 它們均不應（SHALL）以注入系統提示為目的讀取 `MEMORY.md`、`USER.md` 或任何 Agent 工作區檔案

#### Scenario: Agent 自我管理

- **WHEN** Agent session 啟動，且 Agent 的 CLAUDE.md 指示其載入記憶體
- **THEN** Agent 本身應（SHALL）發出 Read 工具呼叫以載入其工作區檔案，無需任何引擎協調

#### Scenario: BOOTSTRAP.md 一次性儀式

- **WHEN** `BOOTSTRAP.md` 存在於 Agent 目錄中
- **THEN** Agent 應（SHALL）在首次執行時執行入門流程，然後自行刪除該檔案，不為後續 session 留下任何痕跡

---
### Requirement: 分層邊界隔離

系統應（SHALL）強制執行嚴格的分層邊界。`SDKQueryManager` 不應（SHALL NOT）知曉記憶體、session 或業務上下文。`MessageProcessor` 不應（SHALL NOT）知曉記憶體內容或平台特定的訊息格式。`AgentLoader` 應（SHALL）只讀取檔案而不解釋其語意。Agent 層（CLAUDE.md + 執行時）應（SHALL）是唯一知曉記憶體協議與工作區檔案結構的層。

#### Scenario: SDKQueryManager 可移植性

- **WHEN** `SDKQueryManager` 被提取並用於其他專案
- **THEN** 它應（SHALL）無需任何 ClaudeCab 特定的匯入或設定即可正確運作

#### Scenario: MessageProcessor 平台無關性

- **WHEN** `MessageProcessor` 傳送回應
- **THEN** 它應（SHALL）將所有平台特定的傳遞委派給 `BaseAdapter` 介面，且不應（SHALL NOT）匯入任何 Telegram 特定型別

---
### Requirement: PathValidator 工作區隔離

`PathValidator` 應（SHALL）對任何 Agent 發出的每次檔案系統工具呼叫強制執行工作區隔離。它應（SHALL）透過 `PreToolUse` hooks 攔截 `Read`、`Write`、`Edit`、`Glob`、`Grep` 和 `Bash` 工具呼叫。每個 Agent 應（SHALL）僅對其自身的 `agents/{id}/` 目錄擁有讀寫存取權。Agent 應（SHALL）對 `_shared/knowledge/` 擁有唯讀存取權，並對 `_shared/knowledge/{agentId}/` 擁有讀寫存取權。存取任何其他 Agent 工作區的操作應（SHALL）被拒絕。

#### Scenario: 跨 Agent 寫入被阻擋

- **WHEN** Agent A 嘗試向 `agents/agentB/` 寫入檔案
- **THEN** `PathValidator` 應（SHALL）在工具執行前阻擋該操作

#### Scenario: 共享知識庫唯讀強制執行

- **WHEN** 任何 Agent 嘗試向其自身命名空間以外的 `_shared/knowledge/` 寫入
- **THEN** `PathValidator` 應（SHALL）拒絕該寫入操作

#### Scenario: 自動 Hook 注入

- **WHEN** `MessageProcessor` 為任何 Agent 準備查詢
- **THEN** `PathValidator` 應（SHALL）自動注入，無需 Agent 的 CLAUDE.md 宣告任何 hooks

---
### Requirement: PlatformOrchestrator 與 Adapter 生命週期

`PlatformOrchestrator` 應（SHALL）管理所有 platform adapter 的生命週期。每個設定了 `telegramBotToken` 的 Agent 應（SHALL）獲得其自身的 `TelegramAdapter` 實例（每個 Agent 一個 Bot）。一個 Agent 的 adapter 啟動失敗不應（SHALL NOT）阻止其他 Agent 的啟動。Orchestrator 應（SHALL）支援 `reloadAgent(agentId)` 以重新載入設定，並在不重啟系統的情況下重啟單一 Agent 的 adapter。`BaseAdapter` 抽象類別應（SHALL）定義所有 adapter 實作的平台無關介面。

#### Scenario: 每個 Agent 的 Bot 隔離

- **WHEN** 兩個 Agent 設定了不同的 Telegram bot token
- **THEN** 各自應（SHALL）擁有獨立的 grammy Bot 實例，且不共享訊息處理器

#### Scenario: 部分失敗的韌性

- **WHEN** 一個 Agent 的 Telegram token 在啟動時無效
- **THEN** 系統應（SHALL）記錄錯誤，並繼續正常啟動所有其他 Agent

#### Scenario: 熱重載

- **WHEN** `reloadAgent(agentId)` 被呼叫
- **THEN** Agent 的 `AgentConfig` 應（SHALL）從磁碟重新讀取，其 adapter 應（SHALL）在不影響任何其他正在運行的 Agent 的情況下重啟

---
### Requirement: 透過 PermissionBridge 進行權限審批

工具使用審批應（SHALL）透過基於 Promise 的 `PermissionBridge` 處理，將同步 SDK `canUseTool` callback 與非同步 Telegram InlineKeyboard 使用者互動解耦。每個待審批項目應（SHALL）有 120 秒的超時，超時後應（SHALL）自動拒絕。`PermissionBridge` 不應（SHALL NOT）直接依賴任何 adapter 或 SDK 型別。Session 結束時，應（SHALL）呼叫 `cancelAll()` 以釋放所有待處理的 Promise。

#### Scenario: 使用者審批流程

- **WHEN** SDK 為需要審批的工具呼叫 `canUseTool`
- **THEN** `PermissionBridge` 應（SHALL）建立一個延遲 Promise，且 adapter 應（SHALL）向使用者顯示允許/拒絕的 InlineKeyboard

#### Scenario: 審批超時

- **WHEN** 使用者在 120 秒內未回應權限提示
- **THEN** `PermissionBridge` 應（SHALL）將延遲 Promise 解析為拒絕，且該工具不應（SHALL NOT）執行

#### Scenario: Session 清理

- **WHEN** Session 結束或被重設
- **THEN** 應（SHALL）呼叫 `PermissionBridge.cancelAll()` 以防止懸掛的 Promise

---
### Requirement: AgentConfig 型別契約

`AgentConfig` 介面應（SHALL）是所有 Agent 設定的權威資料契約。它應（SHALL）支援以下欄位：`name`、`model`（sonnet/opus/haiku）、`telegramBotToken`、`systemPrompt`、`systemPromptFile`、`allowedTools`、`disallowedTools`、`mcpConfigFile`、`display`（Live 頁面的視覺資產），以及 `settings`（permissionMode、maxTurns、delegation、initiative、idleMutter）。`ConfigTransformer` 應（SHALL）是將 `AgentConfig` 轉換為 SDK `query()` 選項的唯一模組。

#### Scenario: 模型名稱映射

- **WHEN** `ConfigTransformer.getSDKModel()` 以 `'sonnet'`、`'opus'` 或 `'haiku'` 呼叫
- **THEN** 它應（SHALL）回傳對應的 SDK 模型 ID 字串

#### Scenario: 權限模式映射

- **WHEN** `ConfigTransformer.toSDKOptions()` 處理 `settings.permissionMode`
- **THEN** 它應（SHALL）使用 `PERMISSION_MODE_MAP` 將其映射為 SDK 相容的值，再傳遞給 `query()`

#### Scenario: 未知設定欄位

- **WHEN** `AgentLoader` 以 Zod 驗證 `agent.json`
- **THEN** 未知欄位應（SHALL）被拒絕，並應（SHALL）記錄一個描述性錯誤，指出無效欄位的名稱