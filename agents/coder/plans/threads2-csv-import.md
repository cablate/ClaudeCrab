# Threads2 CSV 匯入功能實作計畫

## 目標

1. **一次性匯入**：將 n8n 收集的 4 份 CSV 歷史資料匯入系統
2. **停用 n8n**：之後由系統自動排程同步

## CSV 結構對應

| CSV | 欄位 | 目標 |
|-----|------|------|
| 1. 貼文 | id, timestamp, text, permalink, username | → `contents` collection |
| 2. 洞察 | id, timestamp, likes, quotes, replies, reposts, shares, views | → 更新 `contents.metrics` |
| 3. 每日瀏覽 | timestamp, value, timestring | → 新 `account_stats` collection |
| 4. 每日統計 | timestamp, likes, replies, quotes, reposts, followers_count, date | → 新 `account_stats` collection |

---

## 實作步驟

### Phase 1: 基礎建設

**1.1 安裝依賴**
```bash
cd 後端/app
npm install csv-parse multer @types/multer
```

**1.2 新增型別定義**

建立 `後端/app/src/types/import.ts`:
```typescript
export interface PostCsvRow {
  id: string;
  timestamp: string;
  text: string;
  permalink: string;
  username: string;
}

export interface InsightCsvRow {
  id: string;
  timestamp: string;
  likes: string;
  quotes: string;
  replies: string;
  reposts: string;
  shares: string;
  views: string;
}

export interface ViewsCsvRow {
  timestamp: string;
  value: string;
  timestring: string;
}

export interface DailyCsvRow {
  timestamp: string;
  likes: string;
  replies: string;
  quotes: string;
  reposts: string;
  followers_count: string;
  date: string;
}

export interface ImportJob {
  importId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: { total: number; processed: number; failed: number };
  errors: Array<{ row?: number; postId?: string; error: string }>;
  startTime: string | null;
}

export interface ImportPreview {
  totalPosts: number;
  newPosts: number;
  existingPosts: number;
  postsWithInsights: number;
  warnings: string[];
}
```

建立 `後端/app/src/types/account-stats.ts`:
```typescript
export interface AccountStatsPayload {
  date: string;                    // "2024-12-20"
  username: string;
  profile_views: number | null;    // CSV 3
  daily_likes: number | null;      // CSV 4
  daily_replies: number | null;
  daily_quotes: number | null;
  daily_reposts: number | null;
  followers_count: number | null;
  created_at: string;
  updated_at: string;
  source: 'csv_import' | 'api_sync';
}
```

**1.3 修改 `後端/app/src/config/database.ts`**

新增 collection:
```typescript
export const COLLECTIONS = {
  CONTENTS: 'threads_contents',
  ANALYSES: 'analyses',
  KNOWLEDGE_SCHEMAS: 'knowledge_schemas',
  PRINCIPLES: 'principles',
  ACCOUNT_STATS: 'account_stats',  // 新增
} as const;

// COLLECTION_CONFIGS 新增:
[COLLECTIONS.ACCOUNT_STATS]: { size: 1, distance: 'Cosine' },
```

---

### Phase 2: 驗證器

建立 `後端/app/src/validators/import.validator.ts`:
- `validatePostsCsv(rows)`: 檢查必要欄位 id, text
- `validateInsightsCsv(rows)`: 檢查必要欄位 id
- `validateViewsCsv(rows)`: 檢查必要欄位 timestamp, value
- `validateDailyCsv(rows)`: 檢查必要欄位 timestamp, followers_count

---

### Phase 3: Import Controller

建立 `後端/app/src/controllers/import.controller.ts`:

**核心方法:**

1. `previewPostsImport`: 解析 CSV，查詢現有資料，返回預覽
2. `startPostsImport`: 背景執行批次匯入
3. `getImportStatus`: 查詢匯入進度
4. `importAccountStats`: 匯入帳號統計（同步執行，無需 embedding）

**關鍵邏輯:**
- 複用 `sync.controller.ts` 的 `toPointId()` 函式（UUID v5）
- 複用 `embeddingService.generateBatchEmbeddings()` 批次處理
- 複用 `metricsService.computeAndStore()` 計算衍生指標

---

### Phase 4: 路由設定

建立 `後端/app/src/routes/import.routes.ts`:

```typescript
// multer 設定
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/import/posts/preview
router.post('/posts/preview',
  upload.fields([{ name: 'posts' }, { name: 'insights' }]),
  importCtrl.previewPostsImport
);

// POST /api/import/posts/:importId/start
router.post('/posts/:importId/start', importCtrl.startPostsImport);

// GET /api/import/status/:importId
router.get('/status/:importId', importCtrl.getImportStatus);

// POST /api/import/stats
router.post('/stats',
  upload.fields([{ name: 'views' }, { name: 'daily' }]),
  importCtrl.importAccountStats
);
```

修改 `後端/app/src/routes/index.ts`:
```typescript
import importRoutes from './import.routes.js';
app.use('/api/import', importRoutes);
```

---

### Phase 5: 同步擴充（後續排程用）

擴充 `後端/app/src/controllers/sync.controller.ts`:
- 新增 `syncAccountStats` method
- 從 Threads API 獲取當日帳號統計（需確認 API 能力）

擴充 `後端/app/src/routes/sync.routes.ts`:
- 新增 `POST /api/sync/account-stats`

---

## API 規格摘要

| 端點 | 方法 | 用途 |
|------|------|------|
| `/api/import/posts/preview` | POST | 上傳 CSV 預覽匯入 |
| `/api/import/posts/:id/start` | POST | 開始背景匯入 |
| `/api/import/status/:id` | GET | 查詢匯入進度 |
| `/api/import/stats` | POST | 匯入帳號統計 |
| `/api/sync/account-stats` | POST | 排程同步帳號統計 |

---

## 檔案清單

### 新增
- `後端/app/src/types/import.ts`
- `後端/app/src/types/account-stats.ts`
- `後端/app/src/validators/import.validator.ts`
- `後端/app/src/controllers/import.controller.ts`
- `後端/app/src/routes/import.routes.ts`

### 修改
- `後端/app/src/config/database.ts` — 新增 ACCOUNT_STATS collection
- `後端/app/src/routes/index.ts` — 註冊 import routes
- `後端/app/src/controllers/sync.controller.ts` — 新增 syncAccountStats（可選，Phase 5）
- `後端/app/src/routes/sync.routes.ts` — 新增路由（可選，Phase 5）

---

## 驗證方式

1. **啟動服務**
   ```bash
   cd 後端/app && npm run dev
   ```

2. **測試貼文匯入**
   ```bash
   curl -X POST http://localhost:3001/api/import/posts/preview \
     -F "posts=@posts.csv" \
     -F "insights=@insights.csv"
   ```

3. **測試帳號統計匯入**
   ```bash
   curl -X POST http://localhost:3001/api/import/stats \
     -F "views=@views.csv" \
     -F "daily=@daily.csv"
   ```

4. **驗證資料**
   - Qdrant Dashboard: http://localhost:6333/dashboard
   - 檢查 `threads_contents` 和 `account_stats` collections

---

## 注意事項

- **去重邏輯**：貼文用 `source_id` 去重，帳號統計用 `date` 去重
- **批次處理**：貼文匯入每 10 篇一批，避免 embedding API 超載
- **錯誤處理**：記錄失敗的行，不中斷整體匯入
- **時區**：CSV timestamp 需統一處理為 ISO 格式
