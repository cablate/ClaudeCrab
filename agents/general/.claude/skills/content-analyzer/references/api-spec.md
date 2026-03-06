# API 規格

Base URL: `http://localhost:3003`

---

## 取得內容類型定義

```
GET /api/analyses/content-types
```

Response:
```json
{
  "status": "success",
  "data": {
    "content_types": [
      { "type": "知識教學", "definition": "解釋概念、教方法、給步驟。讀者讀完會「學到東西」" },
      { "type": "經驗分享", "definition": "分享親身經歷與結果。有「我做了 X，結果 Y」的敘事" },
      { "type": "觀點表達", "definition": "表達立場、判斷、預測。有明確的個人觀點或主張" },
      { "type": "資源整理", "definition": "推薦工具、書單、資源列表。主體是「列舉 + 簡評」" },
      { "type": "問題探討", "definition": "提出問題、分析困境。重點在「問」而非「答」" },
      { "type": "靈感筆記", "definition": "碎片想法、未成形的洞察。短、發散、沒有完整論述" },
      { "type": "經營紀錄", "definition": "數據回顧、成長紀錄。有具體數字或里程碑" },
      { "type": "日常互動", "definition": "閒聊、回應時事、社交性質。主要功能是「維持存在感」" }
    ]
  },
  "meta": { "timestamp": "...", "version": "2.0.0" }
}
```

---

## 取得已存在的 topic 詞彙表

```
GET /api/analyses/topics/distinct
```

Response:
```json
{
  "status": "success",
  "data": {
    "topics": [
      { "topic": "AI Skill", "count": 12 },
      { "topic": "Claude Code", "count": 8 }
    ],
    "total": 2
  },
  "meta": { "timestamp": "...", "version": "2.0.0" }
}
```

---

## 取得待分析內容

支援 `fields` 參數，只回傳指定欄位以節省 token。`id` 永遠回傳。

```
GET /api/contents/unanalyzed?page=1&limit=20&fields=id,text,media_url
```

Response:
```json
{
  "status": "success",
  "data": {
    "contents": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "text": "貼文的完整文字內容...",
        "media_url": null
      }
    ]
  },
  "meta": {
    "timestamp": "...",
    "version": "2.0.0",
    "pagination": { "page": 1, "limit": 20, "total": 85, "pages": 5 }
  }
}
```

**可用欄位：** `id`, `text`, `title`, `username`, `source_type`, `source_id`, `permalink`, `media_type`, `media_url`, `metrics`, `created_at`, `updated_at`, `imported_at`

如果 `total > limit`，需翻頁繼續取：`?page=2&limit=20&fields=id,text,media_url`

---

## 取得已有的分析記錄

```
GET /api/analyses?page=1&limit=20
```

用於流程 B（補寫欄位）：篩選出 `knowledge_density` 為 null 的記錄。

Response:
```json
{
  "status": "success",
  "data": {
    "analyses": [
      {
        "id": "analysis-uuid",
        "content_id": "550e8400-...",
        "content_type": "經驗分享",
        "topics": [...],
        "key_insights": [],
        "knowledge_density": null,
        "density_reasoning": "",
        "analyzed_by": "claude-sonnet-4-20250514",
        "created_at": "...",
        "updated_at": "..."
      }
    ]
  },
  "meta": {
    "timestamp": "...",
    "version": "2.0.0",
    "pagination": { "page": 1, "limit": 20, "total": 120, "pages": 6 }
  }
}
```

> 篩選邏輯：`knowledge_density` 為 `null` 的記錄即為需要補寫的目標。

---

## 取得單篇內容（流程 B 用）

```
GET /api/contents/:id
```

用於流程 B：拿到 analysis 的 `content_id` 後，取得原始貼文內容以進行分析。

Response 結構同「取得待分析內容」的單筆格式。

---

## 寫入分析結果（POST - 全新分析）

```
POST /api/analyses
Content-Type: application/json
```

Request Body:
```json
{
  "content_id": "550e8400-e29b-41d4-a716-446655440000",
  "content_type": "知識教學",
  "topics": [
    { "topic": "AI Skill", "confidence": "core" },
    { "topic": "自媒體經營", "confidence": "related" }
  ],
  "key_insights": [
    "跟案例太貼的 skill 無法有效廣泛複用",
    "做教學容易激發新的思考角度"
  ],
  "knowledge_density": 7,
  "density_reasoning": "有明確觀點(+2)、缺可操作方法(+0)、有具體經驗佐證(+2)、有深入分析(+2)、觀點具原創性(+2) = 8",
  "analyzed_by": "claude-opus-4-6"
}
```

Response (201):
```json
{
  "status": "success",
  "data": {
    "analysis": {
      "id": "新生成的-analysis-uuid",
      "content_id": "550e8400-e29b-41d4-a716-446655440000",
      "content_type": "知識教學",
      "topics": [...],
      "key_insights": [...],
      "knowledge_density": 7,
      "density_reasoning": "...",
      "layer_positions": [],
      "supports_principles": [],
      "action": null,
      "action_note": "",
      "analyzed_by": "claude-opus-4-6",
      "created_at": "2026-02-09T12:00:00.000Z",
      "updated_at": "2026-02-09T12:00:00.000Z"
    }
  },
  "meta": { "timestamp": "...", "version": "2.0.0" }
}
```

---

## 補寫分析欄位（PUT - merge 更新）

```
PUT /api/analyses/:id
Content-Type: application/json
```

**只傳需要補寫的欄位**，其餘欄位保持不變。

Request Body（範例：補寫 key_insights + knowledge_density）:
```json
{
  "key_insights": ["跟案例太貼的 skill 無法有效廣泛複用"],
  "knowledge_density": 7,
  "density_reasoning": "有明確觀點(+2)、缺可操作方法(+0)、有具體經驗佐證(+2)、有深入分析(+2)、觀點具原創性(+2) = 8"
}
```

Response (200): 同 POST 的 response 結構。

---

## 錯誤處理

```json
{
  "status": "error",
  "message": "Content 550e8400-... does not exist",
  "meta": { "timestamp": "...", "version": "2.0.0" }
}
```

常見錯誤：
- `400` — content_id 不存在、content_type 值不在預定義清單中、topics[].confidence 值無效、knowledge_density 不是 1-10 整數
- `503` — 向量資料庫未就緒，稍後重試
