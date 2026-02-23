# dom-turboscribe Skill

影片轉錄自動化 Skill，透過 TurboScribe API 將影片轉換為 SRT 字幕檔。

## 目錄結構

```
dom-turboscribe/
├── SKILL.md                          # Skill 主文件
├── README.md                         # 說明文件（本檔）
├── scripts/
│   └── turboscribe.py               # Python 轉錄工具
└── references/
    ├── turboscribe-api-complete.md  # 完整 API 文檔
    └── header.md                     # 認證 Headers
```

## 快速開始

### 觸發條件

當使用者提到以下需求時，AI 會自動載入此 Skill：
- 「轉錄這個影片」
- 「把影片轉成字幕」
- 「我需要影片的文字稿」
- 「下載這個影片的 SRT」

### 使用方式

AI 會自動執行 `scripts/turboscribe.py`，提供三種功能：

1. **轉錄影片**：`transcribe <url> [language] [model]`
2. **查詢進度**：`status <job_id>`
3. **下載 SRT**：`download <media_id> [output_path]`

## 依賴需求

### Python 套件

```bash
pip install requests
```

### 認證配置

Cookie 已內建在 script 中（從 `references/header.md` 提取）。

如 Cookie 過期，需從瀏覽器更新：
1. 開啟 TurboScribe 網站
2. 開 DevTools → Network
3. 複製請求的 Cookie header
4. 更新 `scripts/turboscribe.py` 中的 `COOKIES` 字典

## 任務記錄

所有轉錄任務記錄在 `turboscribe_jobs.csv`（自動建立），包含：
- Job ID、Media ID
- 影片資訊
- 轉錄狀態
- 時間戳
- SRT 路徑

## 測試驗證

```bash
# 測試轉錄功能
python scripts/turboscribe.py transcribe "https://youtube.com/shorts/8FFiXyDdPnY"

# 查詢任務狀態
python scripts/turboscribe.py status job_1771283839

# 下載 SRT
python scripts/turboscribe.py download 8295630513699704188
```

## 已知限制

1. **Cookie 有效期**：Session cookies 會過期，需定期更新
2. **API 端點穩定性**：Import URL 端點可能變更（含 dropzone-id）
3. **並發限制**：未測試大量並發請求的行為
4. **錯誤恢復**：轉錄失敗時需手動重試

## 維護指南

### 更新 API 端點

如 TurboScribe 更新 API，需修改 `scripts/turboscribe.py` 中的 endpoint：

```python
# Import URL endpoint
endpoint = "/_htmx/hP40AwAE..."  # ← 這裡

# Submit endpoint
endpoint = "/_htmx/gZ_HcwAE..."  # ← 這裡

# Download SRT endpoint
endpoint = "/_htmx/83Z0_QAE..."  # ← 這裡
```

參考 `references/turboscribe-api-complete.md` 中的最新 endpoint。

### 更新 Cookie

1. 編輯 `scripts/turboscribe.py`
2. 找到 `COOKIES` 字典
3. 從 `references/header.md` 或瀏覽器更新值

### 新增功能

1. 修改 `scripts/turboscribe.py` 新增功能
2. 更新 `SKILL.md` 使用說明
3. 測試後提交

## 版本歷史

- **v1.0** (2026-02-17)
  - 初始版本
  - 支援轉錄、查詢、下載三大功能
  - CSV 任務記錄
  - 測試驗證：12 秒影片成功轉錄
