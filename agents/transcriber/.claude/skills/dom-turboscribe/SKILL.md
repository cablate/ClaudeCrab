---
name: dom-turboscribe
description: 影片轉錄服務。將影片 URL 轉錄成文字（TXT）。支援 import → submit → poll → download → done 完整流程。主動更新時機：TurboScribe API 端點變更、新增轉錄功能、Cookie 過期處理機制改進時。
---

# TurboScribe 影片轉錄

自動化影片轉錄服務。架構分兩層：

- **Python script**（`scripts/turboscribe.py`）：透過 HTMX API 處理 import → submit → poll + 任務管理
- **agent-browser**：透過真實瀏覽器存取 Cloudflare 保護的 transcript 頁面，下載 TXT

## 架構說明

TurboScribe 有兩種端點：

| 類型 | 端點格式 | Python/curl | agent-browser |
|------|----------|:-:|:-:|
| HTMX API | `/_htmx/...` | 可用 | 可用 |
| 頁面 | `/zh-TW/transcript/...` | 403 (Cloudflare) | 可用 |
| TXT 下載 | `/_content/fn/...?e=&s=` | curl 可用（帶簽名） | 可用 |

因此轉錄流程拆成兩段執行。

## 完整工作流程

```
import → submit → poll → (agent-browser 下載 TXT) → done → digest → 口語回覆
```

### Phase 1: 轉錄（Python CLI）

```bash
# Step 1: 匯入影片（自動 URL 去重）
python scripts/turboscribe.py import <url> [language] [model]

# Step 2: 提交轉錄任務
python scripts/turboscribe.py submit <job_id>

# Step 3: 輪詢等待完成（回傳 media_id + transcript URL）
python scripts/turboscribe.py poll <job_id>
```

### Phase 2: 下載 TXT（agent-browser + curl）

> ⚠️ **Phase 2 必須使用 agent-browser**
> 不是 Chrome DevTools MCP，不是 Playwright MCP，不是 dom-agent-browser。
> 就是 `agent-browser` CLI 工具。如果環境沒有，先安裝再繼續。

```bash
# 1. 啟動瀏覽器 + 注入 cookie
agent-browser open https://turboscribe.ai --headed
agent-browser cookies set session-secret "<value>"
agent-browser cookies set access-token "<value>"
agent-browser cookies set device-token "<value>"
agent-browser cookies set snowflake "<value>"
agent-browser cookies set fingerprint "<value>"
agent-browser cookies set lev "1"
agent-browser cookies set js "1"
agent-browser cookies set i18n-activated-languages "zh-TW,en"

# 2. 開啟 transcript 頁面
agent-browser open https://turboscribe.ai/zh-TW/transcript/<media_id>/

# 3. 取得 TXT 下載連結
agent-browser snapshot -i        # 找到「下載TXT」的 ref（通常是 @e58）
agent-browser get attr @e58 href # 取得帶簽名的直接下載 URL

# 4. 用 curl 直接下載到檔案（零 token 消耗）
curl -sL -o "output/<filename>.txt" "<txt_url>"

# 5. 標記完成
python scripts/turboscribe.py done <job_id> output/<filename>.txt

# 6. 讀取 TXT → 深度分析 → 回覆使用者
#    讀取下載好的 TXT，依照以下框架分析，口語化回覆給使用者：
#
#    【影片大綱】（2-4句，讓讀者快速掌握影片在講什麼）
#
#    【深度分析】
#    - 核心主張：作者真正在說的那一句話
#    - 背後邏輯：為什麼這成立？依賴什麼前提？
#    - 邊界條件：什麼情況下不成立？
#    - 可帶走的框架：以後遇到類似情況可以套用的思考工具
#    - 舉例說明：讓抽象落地的案例或數據
#    - 與已知的連結：跟其他概念的關係、延伸或衝突
#
#    原則：口語化、有例子、不堆術語。不需要貼原文。
#
# 7. 自動歸檔（分析完成後立即執行，不需等 Cab 指示）
#    a. 在 knowledge/cases/<影片標題>.md 建立六層框架分析檔案
#       格式：大綱 / 核心主張 / 背後邏輯 / 邊界條件 / 可帶走框架 / 舉例說明 / 與已知連結
#    b. 在 .claude/skills/knowledge-external/references/index.md 對應分類加入新行
#       格式：| 標題 | 核心主張 | knowledge/cases/<標題>.md |
#    c. 若無對應分類，在 index.md 新增分類標題
```

**重點：TXT URL 帶簽名參數（`e=` 過期時間 + `s=` 簽名），curl 可直接下載，不需要 cookie，不受 Cloudflare 擋。用 curl `-o` 直接寫檔，內容完全不經過 conversation，零 token 消耗。**

### Phase 3: 任務管理

```bash
# 列出待下載的 jobs
python scripts/turboscribe.py pending

# 標記已下載
python scripts/turboscribe.py done <job_id> <txt_path>

# 查詢狀態
python scripts/turboscribe.py status <job_id>
```

## CLI 完整指令

```bash
python scripts/turboscribe.py import  <url> [language] [model]  # 匯入影片（自動 URL 去重）
python scripts/turboscribe.py submit  <job_id>                  # 提交轉錄任務
python scripts/turboscribe.py poll    <job_id>                  # 輪詢等待完成
python scripts/turboscribe.py pending                           # 列出待下載 TXT 的 jobs
python scripts/turboscribe.py done    <job_id> <txt_path>       # 標記 TXT 已下載
python scripts/turboscribe.py status  <job_id>                  # 查詢 job 狀態
```

### 參數說明

- `language`: 音訊語言（預設：English）— English, Chinese, Japanese 等
- `model`: 轉錄模式（預設：large-v2）
  - `turbo` — 最快（Cheetah）
  - `small` — 平衡（Dolphin）
  - `large-v2` — 最準確（Whale）

### 狀態流轉

```
imported → running → completed → done
```

- `imported`：已匯入，等待提交
- `running`：轉錄進行中
- `completed`：轉錄完成，等待下載 TXT
- `done`：TXT 已下載到本地

## 任務記錄

所有任務記錄在 `output/turboscribe_jobs.csv`，欄位：

```
job_id, media_url, language, model, status, handle, media_id,
video_name, created_at, completed_at, before_ids, srt_path
```

- `srt_path`：實際存放的是 TXT 檔案路徑（歷史命名）
- URL 去重：同一 URL 不會重複匯入（`_find_job_by_url`）

## agent-browser 操作

### 為什麼用 agent-browser？

1. **Cloudflare 擋 Python requests/curl**：Transcript 頁面回傳 403
2. **Chrome DevTools MCP 不可用**：Chrome 144+ debugging session 彈權限對話框
3. **agent-browser 用 Playwright 底層**：自帶 CDP 控制，不受 Chrome 限制

### Cookie 來源

認證 cookie 儲存在 `references/header.md`，由使用者從瀏覽器 DevTools 擷取更新。

關鍵 cookie（必須注入）：
- `session-secret` — 主要認證
- `access-token` — 存取權杖
- `device-token` — 裝置識別
- `fingerprint` — 瀏覽器指紋
- `snowflake` — 使用者 ID
- `lev`, `js`, `i18n-activated-languages` — 環境設定

### TXT vs SRT

- **TXT**：有直接下載 URL（`_content/fn/.../<name>.txt?...`），一步取得
- **SRT**：需要兩步點擊（開啟設定面板 → 下載），難以自動化
- **結論**：一律下載 TXT

### 已驗證頁面

| 頁面 | URL 格式 | 狀態 |
|------|----------|------|
| Dashboard Folder | `/zh-TW/dashboard/folder/<id>` | 已驗證 |
| Transcript 頁面 | `/zh-TW/transcript/<media_id>/` | 已驗證 |

## 使用原則

### 語言選擇

- 英文影片 → `English`
- 中文影片 → `Chinese`
- 混合語言 → 選擇主要語言

### 模型選擇

- 快速預覽 → `turbo`
- 一般使用 → `small`
- 重要內容 → `large-v2`

### TXT 下載注意

- TXT URL 帶簽名參數（`e=` 過期時間戳 + `s=` 簽名），curl 可直接下載，無需 cookie
- 取得 URL 後要立即下載，不要存著之後用（URL 有時效）
- **用 `curl -sL -o` 直接寫檔**，內容不經過 conversation，零 token 消耗
- 不要用 `agent-browser eval` + `Write` 工具的方式（會浪費大量 token）

## 錯誤處理

| 問題 | 處理方式 |
|------|----------|
| Cookie 過期 | 重新取得認證 cookies（`references/header.md`） |
| API 端點變更 | 更新 `scripts/turboscribe.py` 中的 endpoint URL |
| 轉錄失敗 | 檢查 CSV 的 status，必要時重新 import + submit |
| agent-browser 403 | Cookie 過期，重新注入 |
| 找不到「下載TXT」連結 | 確認 media_id 正確、transcript 確實已完成 |
| URL 已存在 | import 會自動偵測去重，回傳既有 job |

## 注意事項

1. **認證狀態**：Cookie 會過期，定期需從瀏覽器 DevTools 更新
2. **並發限制**：避免同時提交過多任務
3. **CSV 記錄**：`output/turboscribe_jobs.csv` 不要手動編輯
4. **兩層分離**：Python script 不處理瀏覽器操作，agent-browser 不處理 HTMX API
5. **省 token**：下載 TXT 時用 bash `>` 重導，不要讓內容經過 conversation

## 技術文件

- **完整 API 文檔**：`knowledge/turboscribe-api-complete.md`
- **認證 Headers**：`references/header.md`
- **實作腳本**：`scripts/turboscribe.py`

## 主動更新時機

| 情境 | 更新內容 |
|------|----------|
| TurboScribe API 端點變更 | `scripts/turboscribe.py` 的 endpoint URL |
| Cookie 認證機制改變 | `references/header.md` 和認證流程 |
| 發現新轉錄模式或參數 | CLI 指令和使用原則 |
| agent-browser 操作方式改變 | agent-browser 操作章節 |
| 下載格式改變（TXT→其他） | Phase 2 下載流程 |
