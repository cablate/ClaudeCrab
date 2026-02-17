# TurboScribe API Workflow (2026-02-17)

## 完整 API 工作流程

### 1. Import URL
**Endpoint**: `POST https://turboscribe.ai/_htmx/hP40AwAEkpMBzQPskwcAkgkBkqtkcm9wem9uZS1pZL9MLTY1YnJRUEdOMkljYjBmd3ZQUEJvbXcxMTZjYTVi`

**Request Body**:
```json
{
  "media-url": "https://youtube.com/shorts/8FFiXyDdPnY?si=pIaKdvIgZkKS3l7p"
}
```

**Response**: HTML containing JSON-RPC script tag
```html
<script type="application/json-rpc">
[[0,1007,[9,0],[7,1,[9,2],3,[9,4]]],
["L-65brQPGN2Icb0fwvPPBomw116ca5b","handle",
"ZsIq0QAEkpUBkwjOAGCiCs5kIAAAy0J5xtuldHAA3AARBwCSBAECkgkDBMAFwAbAB8tB8/sAAAAAAAjACZIJCpMIzgT11//OcyAAAJuocHJvdmlkZXKncjItZW5hbaNrZXnZRDcyMTQ3NjY2MDMwNTM4Njc1MzBfMjIwLjE0My4xMjguMTU0X3BLM3VsOERsUjFDUmN2YzRhNEpOa2xJbWlKYXN3RVA2o21kNaRtaW1lpHNpemWobWF4LXNpemWoZHVyYXRpb26kbmFtZa5JZiAyKzIgaXMgNC4uLg==_IcZxrsFwIZfPsRNuxU3HV672",
"name","If 2+2 is 4..."]]
</script>
```

**Handle Extraction**: Parse JSON-RPC, get value at index [1][2]

**變更**: 6個月前的 endpoint 不同（包含不同的 dropzone-id），需使用新端點

---

### 2. Submit Transcription
**Endpoint**: `POST https://turboscribe.ai/_htmx/gZ_HcwAEkpMBzQKqlwcAkwjOAjrwSc4kAAAAAcMCwJOpZm9sZGVyLWlksHdpbmRvdy1kcm9wem9uZT-9YXV0b21hdGljYWxseS1jcmVhdGUtYWNjb3VudD8`

**Request Body**:
```json
{
  "json:handles": "[\"ZsIq0QAEkpUBkwjOAGCiCs5kIAAAy0J5xtuldHAA3AARBwCSBAECkgkDBMAFwAbAB8tB8/sAAAAAAAjACZIJCpMIzgT11//OcyAAAJuocHJvdmlkZXKncjItZW5hbaNrZXnZRDcyMTQ3NjY2MDMwNTM4Njc1MzBfMjIwLjE0My4xMjguMTU0X3BLM3VsOERsUjFDUmN2YzRhNEpOa2xJbWlKYXN3RVA2o21kNaRtaW1lpHNpemWobWF4LXNpemWoZHVyYXRpb26kbmFtZa5JZiAyKzIgaXMgNC4uLg==_IcZxrsFwIZfPsRNuxU3HV672\"]",
  "language": "English",
  "whisper-model": "large-v2",
  "int:num-speakers": "2"
}
```

**Whisper Models**:
- `cheetah` / `turbo` - Fastest
- `dolphin` / `small` / `small.en` - Balanced
- `large-v2` / `whale` - Most accurate

**變更**: 端點與6個月前相同

---

### 3. Progress Polling
**Status Flow**: `ready` → `running` → `completed`

**Polling Endpoints** (HTMX auto-polling every 1s):
- **Status: ready → running**
  - `POST /_htmx/KRR2VwAEkpMBzQK5nQcA...?media-id=...&wait-for-update?&previous-status=ready&table-dom-id=...&show-folder-names?&refresh?`
  
- **Status: running → completed**
  - `POST /_htmx/PDtXgAAEkpMBzQK5nQcA...?media-id=...&wait-for-update?&previous-status=running&table-dom-id=...&show-folder-names?&refresh?`

**Response** (when completed): HTML table row with transcript link
```html
<tr>
  <td><a href="/zh-TW/transcript/8295630513699704188/if-2-2-is-4">...</a></td>
</tr>
```

**Media ID Extraction**: Extract from URL path (e.g., `8295630513699704188`)

---

### 4. Download SRT
**Step 1: Request SRT URL**

**Endpoint**: `POST https://turboscribe.ai/_htmx/83Z0_QAEkpMBzQQhkwcAkwjOBPZNfM5zIAAAkahtZWRpYS1pZA`

**Request Body**:
```json
{
  "int:max-words-per-segment": "8",
  "int:max-duration-per-segment-seconds": "10",
  "int:max-characters-per-segment": "80",
  "bool:sentence-enders?": "on"
}
```

**Response**: JSON-RPC with download URL
```javascript
[[0,918,[9,0]],["https://turboscribe.ai/_content/fn/J8YWeAAEkpMBzQLPkgCbBwCTCM4E9k18znMgAAABCALNJxADUATDlahtZWRpYS1pZLVtYXgtd29yZHMtcGVyLXNlZ21lbnS4bWF4LWR1cmF0aW9uLXBlci1zZWdtZW50um1heC1jaGFyYWN0ZXJzLXBlci1zZWdtZW50sHNlbnRlbmNlLWVuZGVycz8/If%202%2B2%20is%204....srt?vid=7214766603053867530&language=zh-TW&etag=Y3E-l5C4z38Agpu9JlUu2ruWlLH-39M5F-5rgbzsVYw&e=1772046787487&s=TZBalnXiyXpBM7vJPIiCFzwuDAEOTLvY8Et_kQeanew"]]
```

**Step 2: Download SRT File**

**Download URL Format**: 
```
/_content/fn/<encoded>/<filename>.srt?vid=<viewer_id>&language=<lang>&etag=<etag>&e=<expiry>&s=<signature>
```

---

## 實作建議

### 持久化狀態追蹤
由於轉錄需要時間（無法一直 blocking），需要：

1. **Job Tracking Database/File**:
   ```json
   {
     "job_id": "unique_id",
     "media_url": "https://...",
     "handle": "ZsIq0QAE...",
     "media_id": "8295630513699704188",
     "status": "running",
     "language": "English",
     "whisper_model": "large-v2",
     "created_at": "2026-02-17T06:34:00Z",
     "completed_at": null
   }
   ```

2. **Polling Worker**:
   - 定期檢查 `status != completed` 的 jobs
   - 對每個 job 執行 progress polling
   - 更新狀態 + media_id
   - 完成後下載 SRT

3. **API Interface**:
   - `POST /transcribe` - 提交新任務（回傳 job_id）
   - `GET /status/{job_id}` - 查詢狀態
   - `GET /download/{job_id}` - 下載 SRT（僅 completed）

---

## Cookie Requirements
必需的 Cookies:
- `session-secret`
- `access-token`
- `device-token`
- `fingerprint`

從瀏覽器 session 複製，或實作登入流程取得。

---

## 測試紀錄
- **測試時間**: 2026-02-17 上午 6:34
- **測試影片**: https://youtube.com/shorts/8FFiXyDdPnY
- **轉錄時長**: ~12秒影片，約10秒完成轉錄
- **Handle**: `ZsIq0QAE...`（每次匯入會產生新的）
- **Media ID**: `8295630513699704188`
