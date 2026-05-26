# SOP：升級 @anthropic-ai/claude-agent-sdk 與 @anthropic-ai/claude-code

本文件定義升級上游 Anthropic SDK 或 Claude Code CLI 的標準流程。**任何版本升級都要照這個流程跑**，不管看起來多小。

**核心目標**：
1. 零不可逆風險——每一步都能 rollback
2. 逐批次 patch——不一次吃所有改動
3. 主動挖掘——新能力 + 新 bug 都找出來

**觸發時機**：
- 發現 bot crash 疑似是 SDK/CLI 版本差異
- 想用新 SDK/CLI 功能
- 定期檢查（建議 ≥ 2 週一次）

---

## 安全不變量（每個階段都必須滿足）

| # | 不變量 | 違反後果 |
|---|--------|---------|
| 1 | Sandbox 優先：新版先裝進 `.cache/sandbox-sdk-<version>/` 或 `.cache/sandbox-cli-<version>/`（gitignored），用 npm `--prefix` 或獨立 dir 隔離 | 可能污染 production node_modules |
| 2 | Anchor-based patch + uniqueness check：`patch-sdk-v2.cjs` 的 find 字串必須唯一，失敗 `process.exit(1)` 不破壞 | patch 套錯地方、silent corrupt |
| 3 | Snapshot 進 git：升級前把當下 patched SDK 存到 `docs/upgrades/snapshots/sdk-<prev-version>-patched.mjs`（永久保留） | 下次升級沒對照物 |
| 4 | 每 Batch 獨立 commit：rollback 粒度 = commit，batch 之間不耦合 | rollback 連帶砍別的功能 |
| 5 | Production restart 永遠 user 動作：agent 不自己重啟 bot、不自己改 .env production 值 | Agent 造成 production outage |
| 6 | package-lock.json 是最後保險：即使 patch script 壞了，`npm install @pkg@<prev>` 能完全還原 | 沒有 known-good fallback |

---

## Phase 0 — 升級前備份（零風險）

**目標**：確保有完整 rollback 路徑。

1. `git status` 確認 working tree 乾淨（有未 commit 改動先收工再升）
2. 查詢當下版本並記錄到 session 工作區：
   ```bash
   npm list @anthropic-ai/claude-agent-sdk --depth=0
   npm --prefix "$NPM_GLOBAL" list @anthropic-ai/claude-code --depth=0
   ```
3. Snapshot 當下 patched SDK（若尚未存在於 `docs/upgrades/snapshots/`）：
   ```bash
   cp node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs \
      docs/upgrades/snapshots/sdk-<current-version>-patched.mjs
   ```
4. 確認兩個 pre-patch 備份都在：
   - `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs.pre-patch`（patch script 每次 install 自動建，ephemeral）
   - `docs/upgrades/snapshots/sdk-<current-version>-unpatched.mjs`（patch script 每次 install 自動寫入 git，永久）
   若後者不存在，手動從前者補：
   ```bash
   cp node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs.pre-patch \
      docs/upgrades/snapshots/sdk-<current-version>-unpatched.mjs
   ```
5. 確認 smoke test (`docs/upgrades/tests/test-patch-v<current-version>.mjs`) 可跑：
   ```bash
   node docs/upgrades/tests/test-patch-v<current-version>.mjs
   ```
   若過，代表當下狀態健康；若已壞，先修到過再升級

**檢查清單**：
- [ ] git clean
- [ ] 當下 SDK 版本已記錄
- [ ] 當下 CLI 版本已記錄
- [ ] Patched SDK snapshot 存在 `docs/upgrades/snapshots/sdk-<current-version>-patched.mjs`
- [ ] Unpatched SDK snapshot 存在 `docs/upgrades/snapshots/sdk-<current-version>-unpatched.mjs`
- [ ] Smoke test 對當下版本過

---

## Phase 1 — 研究（純讀，零風險）

**目標**：把新舊版差異摸清楚，不碰任何檔案。

### 步驟

1. **版本 timeline**：
   ```bash
   npm view @anthropic-ai/claude-agent-sdk versions --json
   npm view @anthropic-ai/claude-agent-sdk time --json
   # 也查 CLI
   ```
   記下：當前版本發布日、最新版發布日、中間版本數

2. **抓官方 CHANGELOG**：
   ```bash
   curl -s https://raw.githubusercontent.com/anthropics/claude-agent-sdk-typescript/main/CHANGELOG.md
   curl -s https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md
   ```

3. **Sandbox 新版安裝**（不碰 production node_modules；路徑 gitignored）：
   ```bash
   mkdir -p .cache/sandbox-sdk-<new-version>
   cd .cache/sandbox-sdk-<new-version>
   npm init -y
   npm i @anthropic-ai/claude-agent-sdk@<new-version> --ignore-scripts
   ```
   CLI 同理（`.cache/sandbox-cli-<new-version>/`）。

4. **整理 CHANGELOG 分類表**（每條 entry 歸一類）：
   - 🎯 **新能力**（可改善我們系統）
   - ⚠️ **Breaking change**（直接爆我們 code）
   - 🤫 **靜悄悄行為變動**（新 default、event 變 opt-in 等，可能 silently 壞掉）
   - ✅ **Bug fix**（我們會 free 拿到）
   - ❓ **不確定**（需進 Phase 2 查）

**檢查清單**：
- [ ] 版本 timeline 記錄
- [ ] SDK + CLI CHANGELOG 都抓了
- [ ] 每條 changelog 已分類
- [ ] Sandbox 新版已裝

---

## Phase 2 — Gap 分析 + 兩份 plan（純讀，零風險）

**目標**：產出可執行規劃文件。

### 2.1 既有 patches 檢視

對 `scripts/patch-sdk-v2.cjs` 每個 patch：

1. 找 anchor (`'Cannot send to closed session'`) 是否仍唯一
2. 每個 `find` 字串在新版 `sdk.mjs.pre-patch` 是否仍唯一、且仍位於 cQ constructor 內
3. 判定：
   - `find` 在，但上游已修 → **刪除**
   - `find` 在，上游沒修 → **保留**
   - `find` 不在 → **改寫或刪除**（看是否仍需功能）

### 2.2 Breaking change 搜尋

對 Phase 1 標 ⚠️ 和 🤫 的每條：
```bash
# 範例：sandbox 變 default failIfUnavailable=true
Grep "sandbox" src/
# 範例：session_state_changed 變 opt-in
Grep "session_state_changed|state_changed" src/
```

### 2.3 同類 bug 擴展搜尋（⚠️ 重要）

歷史規律：Anthropic 修了 cQ 某個漏傳欄位後，**同個 class 的其他欄位常常還漏**。

**同類 bug class 判斷法**：
1. 找本次修復的欄位（例如 0.2.110 修 `cwd`/`settingSources`）
2. 在 new `sdk.mjs.pre-patch` 的 cQ constructor 定位 `new D9({...})` options literal
3. 對比 SDK 的 `Options` type（`sdk.d.ts`）：**每個 Options interface 裡有的欄位，都去 D9 options literal 看有沒有傳**
4. 發現 `xxx: !1` 或 `xxx: void 0` 而 Options 宣告有 `$.xxx` → **同類漏洞**，加進 patch

這一步**每次升級必做**，可能發現 1–3 個新 patch 需求。

### 2.4 新能力映射「深度 checklist」

對 Phase 1 標 🎯 的每條新能力，**必須**走完這個 checklist：

- [ ] Option 是否被 cQ **forwarded** 到 D9？（grep `sdk.mjs.pre-patch` 看 cQ constructor 是否傳 `$.<option>`）
- [ ] 是否有對應 **stream event** 可消費？（查 `sdk.d.ts` 的 SDKMessage union 和各 subtype）
- [ ] 是否 **type 在 V2 createSession Options interface 上**？（非 query() 專屬）
- [ ] 啟用後 **需改 code 哪些行**？（具體 file:line，不是「加個 flag」）
- [ ] 是否跟我們現有邏輯**衝突或替代**？（例如 agentProgressSummaries 取代自訂 task_progress parsing）

**若 checklist 有項目失敗**，要麼：
- 追加 patch 修補（forwarded 未處理 → 加進 `cq-forwarded-flags` 或同類 patch）
- 放棄這能力
- 降等成 debug/monitoring 用途

### 2.5 輸出兩份 plan 文件（immutable 版本化）

檔名格式（**一次升級一組**，完工後凍結不再改）：

```
docs/upgrades/<YYYY-MM-DD>-<target>-<from>-to-<to>-patch-plan.md
docs/upgrades/<YYYY-MM-DD>-<target>-<from>-to-<to>-code-plan.md
```

- `YYYY-MM-DD` = 升級動工日
- `<target>` = `sdk` 或 `cli`（若 SDK 和 CLI 同時升，主文件放 sdk，CLI 結論併入）
- 範例：`2026-04-24-sdk-0.2.76-to-0.2.119-patch-plan.md`

**Immutable 原則**：Batch 6 完成後**禁止再改**這兩份文件。之後出的修正、bug、follow-up → 新開一份下次升級 plan（哪怕只隔 1 天）。

**patch-plan.md 必備段落**：
- Metadata header（Date / Target / From / To / Sibling CLI 版本）
- 摘要表（patch ID | old-state | new-state | 動作）
- 每個 patch 的 find/replace + uniqueness 驗證
- Anchor + 一個段落描述「這個 patch 為什麼還需要」
- Rollback 三情境
- **執行實況**（Phase 5/6 回填）：原計畫 vs 實際差異

**code-plan.md 必備段落**：
- Metadata header（同上）
- Batch 表（每批內容、風險等級、rollback 成本）
- 每批 code 動作清單（file + 改動方向）
- 每批驗證準則
- **執行實況**（Phase 5/6 回填）

**檢查清單**：
- [ ] 檔名遵循日期+版本範圍 convention
- [ ] Metadata header 齊全
- [ ] 每個既有 patch 有判定動作
- [ ] 每個 breaking / 靜悄悄變動有對應 code grep 結果
- [ ] 同類 bug class 擴展過（至少走一輪 cQ D9 options 對照）
- [ ] 每個新能力走完深度 checklist
- [ ] 兩份 plan 文件 commit 進 repo

---

## Phase 3 — Patch 開發（改 `patch-sdk-v2.cjs`）

**目標**：改好 patch script 但還沒 `npm install`，仍可回退。

1. 按 Phase 2 結論更新 `scripts/patch-sdk-v2.cjs` 的 `PATCHES` 陣列
2. 更新 `isPatched` 標記字串（用新版 patched 狀態裡的明顯 marker，例如 `'$.extraArgs??{}'`）
3. 更新 script 頂部註解目標版本號
4. **每個 find 在 sandbox 新版 sdk.mjs 手動驗唯一**：
   ```bash
   grep -cF '<find-string>' .cache/sandbox-sdk-<new>/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs
   # 必須回 1
   ```
5. **每個 PATCHES entry 必加 `Origin:` + `Last-modified:` 註解**（見「參考規範 > Patch script 註解」章節）
6. Commit `scripts/patch-sdk-v2.cjs` 改動（尚未 install）

**檢查清單**：
- [ ] 所有新 patches 的 find 字串在 sandbox 新版 sdk.mjs 裡唯一
- [ ] `isPatched` 標記用新版會出現的字串
- [ ] 每個 PATCHES entry 有 `Origin:` 指向本次 plan 檔
- [ ] patch script 改動單獨 commit

---

## Phase 4 — 正式安裝（可逆）

**目標**：升級 production node_modules，驗等價行為。

1. **改 `package.json`**：
   ```json
   "@anthropic-ai/claude-agent-sdk": "^<new-version>"
   ```
2. **`npm install`**：postinstall 自動跑新 patch script
3. **看 postinstall 輸出**：
   - ✓ N 個 patches 全 unique apply
   - md5 前後值
   - 無 `ERROR: Patch "..." target not found`
4. **`npx tsc --noEmit`**：type check 須過（新版 type 可能更嚴格，要補 type guard）
5. **Raw SDK smoke test**：
   ```bash
   node docs/upgrades/tests/test-patch-v<new>.mjs
   ```
   預期：PATCH_OK 類型的 marker 出現在 stream
6. **Pipeline test**：
   ```bash
   npx tsx docs/upgrades/tests/test-pipeline-v<new>.mts <agent-id>
   ```
   預期：走完 AgentLoader → SDKSessionManager → executeQuery，返回預期 marker

**若任何一步失敗 → 立即 rollback**：
```bash
git checkout HEAD~1 -- package.json package-lock.json scripts/patch-sdk-v2.cjs
npm install
```

**檢查清單**：
- [ ] postinstall 全 ✓
- [ ] tsc 零 error
- [ ] smoke test 過
- [ ] pipeline test 過
- [ ] 所有改動 commit 為 Batch 1（標題含 `Batch 1`）

---

## Phase 5 — 分批 rollout

**目標**：新能力一批一批開，每批獨立驗、獨立 rollback。

**Batch 編號規則**：
- **Batch 1**：純升級 + patch（功能等價，不開新 flag）
- **Batch 2+**：每批啟用 1 個新能力，獨立 commit

**每批必走**：
1. 程式碼改動
2. tsc --noEmit
3. Smoke/Pipeline test 重跑（確認沒 regression）
4. 單一 commit，訊息含 `(Batch N)`
5. **交給 user 重啟 production** — agent 不自己動
6. User 重啟後報告觀察結果；agent 從 log 驗證批次的成功準則

**檢查清單（每 Batch）**：
- [ ] Code 改動只涵蓋本批 scope（沒夾別的重構）
- [ ] tsc 零 error
- [ ] 兩個 test 腳本重跑無 regression
- [ ] Commit 訊息明確標註 `(Batch N)` 和本批啟用的功能
- [ ] User restart 後從 log 驗證

---

## Phase 6 — 學習歸檔

**目標**：把這次發現的非顯而易見事實保留給未來 session。

1. **新 snapshot 進 repo**：
   ```bash
   # Patched 版（我們的產物）：手動 cp
   cp node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs \
      docs/upgrades/snapshots/sdk-<new-version>-patched.mjs
   # Unpatched 版（Anthropic 原廠）：patch script 在 Phase 4 npm install 時已自動寫入；確認即可
   ls docs/upgrades/snapshots/sdk-<new-version>-unpatched.mjs
   git add docs/upgrades/snapshots/sdk-<new-version>-*.mjs
   ```
2. **更新 code/pipeline test 檔名到新版**：
   ```bash
   git mv docs/upgrades/tests/test-patch-v<old>.mjs docs/upgrades/tests/test-patch-v<new>.mjs
   git mv docs/upgrades/tests/test-pipeline-v<old>.mts docs/upgrades/tests/test-pipeline-v<new>.mts
   ```
   更新裡面的 `// Run:` 註解到新路徑。
3. **更新 plan 文件執行實況區塊**（一次性最後更新，之後永不再改）：
   - 原計畫預期 vs 實際差異
   - 新發現的 bug class 或 SDK 設計細節
4. **清掉 sandbox**：`rm -rf .cache/sandbox-sdk-<new> .cache/sandbox-cli-<new>` 不佔空間
5. **Memory 更新**：
   - 新增 `project_*.md` 記錄非顯而易見的新理解（bug class、SDK design quirks）
   - 更新 `MEMORY.md` 索引
6. **Commit all docs + memory**

**檢查清單**：
- [ ] 新版 patched snapshot 已進 git
- [ ] Test 檔改成新版號
- [ ] Plan 文件執行實況段落最後更新（之後凍結）
- [ ] Sandbox 清掉
- [ ] 新 project memory 寫好
- [ ] MEMORY.md 索引加入新條目

---

## 參考規範（程式碼註解 → 文件連結）

當 patch script 或升級相關 code 需要**引用文件**時，遵守以下規範：

### 檔名規則

| 文件類型 | 位置 | 命名 | 生命週期 |
|---------|------|------|---------|
| **SOP 本文件** | `docs/sop-sdk-cli-upgrade.md` | 永久 | 跨所有升級 |
| **Per-upgrade patch plan** | `docs/upgrades/<YYYY-MM-DD>-<target>-<from>-to-<to>-patch-plan.md` | 日期+版本範圍綁定，一次一組，**完工後 immutable** | 永久保留 |
| **Per-upgrade code plan** | `docs/upgrades/<YYYY-MM-DD>-<target>-<from>-to-<to>-code-plan.md` | 同上 | 永久保留 |
| **Patched SDK snapshots** | `docs/upgrades/snapshots/sdk-<version>-patched.mjs` | 每版一檔（我們套完 patch 的產物） | 永久保留 |
| **Unpatched SDK snapshots** | `docs/upgrades/snapshots/sdk-<version>-unpatched.mjs` | 每版一檔（Anthropic 原廠，patch script 在首次 install 時自動寫入） | 永久保留 |
| **Test scripts (升級驗證用)** | `docs/upgrades/tests/test-patch-v<version>.mjs`、`test-pipeline-v<version>.mts` | 每版一檔，升級結束後更新檔名成新版號 | 永久保留（可追溯每次升級當時驗證的 SDK 版本） |
| **專題調查** | `docs/upgrades/research/<topic>-v<version>.md` | 版本號綁定、事件結束後可選擇保留 | 選擇性保留 |
| **Sandbox 安裝** | `.cache/sandbox-sdk-<version>/`、`.cache/sandbox-cli-<version>/` | 每版一個 dir | `.gitignore` 排除，Phase 6 清掉 |

### 引用格式

code 註解引用文件時用這個格式：

```js
// See: docs/sop-sdk-cli-upgrade.md (永久 SOP)
// See: docs/upgrades/2026-04-24-sdk-0.2.76-to-0.2.119-patch-plan.md (具體升級細節，immutable)
// See: docs/upgrades/snapshots/sdk-0.2.76-patched.mjs (歷史對照)
// See: docs/upgrades/research/sdk-reverse-engineering-v0.2.76.md (SDK 內部研究)
```

**不要**：
- 裸 URL（`https://...`）— GitHub 路徑會改
- 引用未 commit 檔案（檔案不在 repo 裡，別人看不到）
- 引用會被改動的「最新活動」檔（會追不回歷史）— 一律指 immutable 的日期版本檔

### Patch script 註解（`scripts/patch-sdk-v2.cjs` 專用）

每個 `PATCHES` entry **必帶**兩條註解：

```js
{
  id: 'thinking-and-extraArgs',
  // Origin: docs/upgrades/2026-04-24-sdk-0.2.76-to-0.2.119-patch-plan.md#patch-thinking-and-extraargs
  // Last-modified: 2026-04-24 (同 Origin — 無後續修改)
  anchor: 'Cannot send to closed session',
  find: '...',
  replace: '...',
  description: '...',
}
```

- **Origin**：指向「**當初引入此 patch 的** upgrade plan 的 immutable 版本檔」。`git blame` 查這行 = 找到引入的 commit；那個 commit 同時 commit 了對應 plan 檔。
- **Last-modified**：patch 的 find/replace 最後被修改的日期。如果跨多次升級演進（例如 find 字串 minify 後換名），每次修改加一條 `Origin:` 指向對應新 plan，`Last-modified` 更新為最新日期。

範例（跨升級演進的 patch）：

```js
{
  id: 'F9-initConfig-and-mcpServers',
  // Origin: docs/upgrades/2026-04-24-sdk-0.2.76-to-0.2.119-patch-plan.md#patch-f9-initconfig-and-mcpservers
  // Origin: docs/upgrades/2026-??-??-sdk-0.2.119-to-0.2.xxx-patch-plan.md#patch-f9-adjusted  (next)
  // Last-modified: 2026-??-??  (when F9 signature changed in next upgrade)
  ...
}
```

### 註解檢查

升級結束前，檢查所有 `See: ` 引用是否指向：
- 存在的檔案
- Immutable 位置（snapshots / 日期版本的 plan）
- 非 sandbox（sandbox 會被清掉）

### 註解檢查

patch script / code-plan 文件 / 記憶 refreshes 時，**檢查所有 `See: ` 引用**：
- 檔案還在？
- 內容仍正確？（例如 patch script 引用 plan doc，但 plan doc 已更新到下一次升級 → 註解誤導）
- 過期的引用 → 更新指向新位置 or 改指向 permanent SOP

---

## 附錄：方法論 lessons（這次 session 的結晶）

1. **別信 handoff 的根因 claim**：先自己查。例子：handoff 說「CLI 2.1.119 協議不相容」，實際是「cli.js 檔案不存在」，完全不同根因
2. **兩層測試**：`test-patch-v*.mjs`（raw SDK lifecycle）+ `test-pipeline-v*.mts`（走 AgentLoader + SDKSessionManager）。前者抓 SDK 本身 bug，後者抓整合 bug
3. **同類 bug class 擴展**：任何時候 Anthropic 修了 A 欄位遺漏，**立刻**去翻同個 class 的 B/C/D（cQ 的 D9 options literal 是 high-yield 礦脈）
4. **新能力深度 checklist 必走完**：不要只看 CHANGELOG 說「加了 flag」就開。要驗是否 forwarded、是否有對應 event、是否 type-widened
5. **Callback vs CLI-registered hook**：SDK programmatic callback 不發 `hook_*` stream event，要 callback 入口自己 `logger.info`。這類 SDK 內部分流不看原始碼摸不清楚
6. **Production restart 屬 Safety Valve**：agent 規劃到最後一哩的前一步就要停，把控制權交給 user

---

## 版本

本 SOP 不 versioning。改動直接更新本檔，commit message 描述差異。
