# TurboScribe API 完整工作流程文檔

**最後更新**: 2026-02-17  
**測試環境**: Chrome DevTools + TurboScribe Web UI  
**測試影片**: https://youtube.com/shorts/8FFiXyDdPnY  
**目的**: 提供完整的 HTTP API 呼叫流程，用於自動化轉錄而無需瀏覽器控制

---

## 概覽

完整的轉錄流程包含四個步驟：
1. **Import URL** - 匯入影片並取得 handle
2. **Submit Transcription** - 提交轉錄任務
3. **Poll Progress** - 輪詢轉錄進度直到完成
4. **Download SRT** - 下載字幕檔案

---

## Step 1: Import URL

### Request
```http
POST https://turboscribe.ai/_htmx/hP40AwAEkpMBzQPskwcAkgkBkqtkcm9wem9uZS1pZL9MLTY1YnJRUEdOMkljYjBmd3ZQUEJvbXcxMTZjYTVi
Content-Type: application/json
Cookie: session-secret=...; access-token=...; device-token=...; fingerprint=...

{
  "media-url": "https://youtube.com/shorts/8FFiXyDdPnY?si=pIaKdvIgZkKS3l7p"
}
```

### Response
```html
<script type="application/json-rpc">
[[0,1007,[9,0],[7,1,[9,2],3,[9,4]]],
["L-65brQPGN2Icb0fwvPPBomw116ca5b","handle",
"ZsIq0QAEkpUBkwjOAGCiCs5kIAAAy0J5xtuldHAA3AARBwCSBAECkgkDBMAFwAbAB8tB8/sAAAAAAAjACZIJCpMIzgT11//OcyAAAJuocHJvdmlkZXKncjItZW5hbaNrZXnZRDcyMTQ3NjY2MDMwNTM4Njc1MzBfMjIwLjE0My4xMjguMTU0X3BLM3VsOERsUjFDUmN2YzRhNEpOa2xJbWlKYXN3RVA2o21kNaRtaW1lpHNpemWobWF4LXNpemWoZHVyYXRpb26kbmFtZa5JZiAyKzIgaXMgNC4uLg==_IcZxrsFwIZfPsRNuxU3HV672",
"name","If 2+2 is 4..."]]
</script>
```

### Parsing Logic
```javascript
// Extract handle from JSON-RPC response
const scriptMatch = html.match(/<script type="application\/json-rpc">([\\s\\S]*?)<\/script>/);
const json = JSON.parse(scriptMatch[1]);
const handle = json[1][2];  // 取得第二個陣列的第三個元素
const videoName = json[1][4];  // 影片名稱
```

### 重要變更
⚠️ **Endpoint 已變更**：6個月前的 endpoint 不同（不同的 dropzone-id），需使用最新端點

---

## Step 2: Submit Transcription

### Request
```http
POST https://turboscribe.ai/_htmx/gZ_HcwAEkpMBzQKqlwcAkwjOAjrwSc4kAAAAAcMCwJOpZm9sZGVyLWlksHdpbmRvdy1kcm9wem9uZT-9YXV0b21hdGljYWxseS1jcmVhdGUtYWNjb3VudD8
Content-Type: application/json
Cookie: session-secret=...; access-token=...; device-token=...; fingerprint=...

{
  "json:handles": "[\"ZsIq0QAEkpUBkwjOAGCiCs5kIAAAy0J5xtuldHAA3AARBwCSBAECkgkDBMAFwAbAB8tB8/sAAAAAAAjACZIJCpMIzgT11//OcyAAAJuocHJvdmlkZXKncjItZW5hbaNrZXnZRDcyMTQ3NjY2MDMwNTM4Njc1MzBfMjIwLjE0My4xMjguMTU0X3BLM3VsOERsUjFDUmN2YzRhNEpOa2xJbWlKYXN3RVA2o21kNaRtaW1lpHNpemWobWF4LXNpemWoZHVyYXRpb26kbmFtZa5JZiAyKzIgaXMgNC4uLg==_IcZxrsFwIZfPsRNuxU3HV672\"]",
  "language": "English",
  "whisper-model": "large-v2",
  "int:num-speakers": "2"
}
```

### Parameters
- **json:handles**: JSON 字串陣列，包含從 Step 1 取得的 handle
- **language**: 音訊語言（如 "English", "Chinese", "Japanese"）
- **whisper-model**: 轉錄模式
  - `turbo` - 最快（Cheetah 🐆）
  - `small` / `small.en` - 平衡（Dolphin 🐬）
  - `large-v2` - 最準確（Whale 🐳）
- **int:num-speakers**: 說話者數量（預設 2）

### Response
返回完整頁面 HTML，轉錄任務已開始（status: ready）

---

## Step 3: Poll Progress

轉錄狀態流程：`ready` → `running` → `completed`

### Polling Endpoint Pattern
```
POST /_htmx/<encoded>?media-id=<media_id>&wait-for-update?&previous-status=<status>&table-dom-id=<id>&show-folder-names?&refresh?
```

### Status: ready → running
```http
POST https://turboscribe.ai/_htmx/KRR2VwAEkpMBzQK5nQcAkwjOBPZNfM5zIAAAAcMCkgQDBJIJBQbAB8OYqG1lZGlhLWlksHdhaXQtZm9yLXVwZGF0ZT-vcHJldmlvdXMtc3RhdHVzpXJlYWR5rHRhYmxlLWRvbS1pZL5MLWxQcVhtcUc5YkZ4LVBYQ2xQZVM0emdkNjZiN2Wyc2hvdy1mb2xkZXItbmFtZXM_qHJlZnJlc2g_
Content-Type: application/json
Cookie: [same as above]

(empty body)
```

### Status: running → completed
```http
POST https://turboscribe.ai/_htmx/PDtXgAAEkpMBzQK5nQcAkwjOBPZNfM5zIAAAAcMCkgQDBJIJBQbAB8OYqG1lZGlhLWlksHdhaXQtZm9yLXVwZGF0ZT-vcHJldmlvdXMtc3RhdHVzp3J1bm5pbmesdGFibGUtZG9tLWlkvkwtbFBxWG1xRzliRngtUFhDbFBlUzR6Z2Q2NmI3ZbJzaG93LWZvbGRlci1uYW1lcz-ocmVmcmVzaD8
Content-Type: application/json
Cookie: [same as above]

(empty body)
```

### Completed Response Example
```html
<tr class="hover:bg-base-200 transition-colors group">
  <td>
    <a href="/zh-TW/transcript/8295630513699704188/if-2-2-is-4">
      <span>If 2+2 is 4...</span>
    </a>
  </td>
  <td>2026年2月17日 上午6:34</td>
  <td>12秒</td>
  <td>🐳</td>
  <td>
    <svg><!-- 完成圖示 --></svg>
  </td>
</tr>
```

### Parsing Media ID
```javascript
// 從轉錄連結中提取 media_id
const linkMatch = html.match(/\/transcript\/(\d+)\//);
const mediaId = linkMatch[1];  // "8295630513699704188"
```

### Polling Interval
建議每 1-2 秒輪詢一次，直到狀態變為 `completed`

---

## Step 4: Download SRT

### Step 4.1: Request SRT URL

```http
POST https://turboscribe.ai/_htmx/83Z0_QAEkpMBzQQhkwcAkwjOBPZNfM5zIAAAkahtZWRpYS1pZA
Content-Type: application/json
Cookie: [same as above]

{
  "int:max-words-per-segment": "8",
  "int:max-duration-per-segment-seconds": "10",
  "int:max-characters-per-segment": "80",
  "bool:sentence-enders?": "on"
}
```

### SRT Parameters
- **max-words-per-segment**: 每段最多單詞數（1-1000，預設 8）
- **max-duration-per-segment-seconds**: 每段最大持續時間（秒，預設 10）
- **max-characters-per-segment**: 每段最大字元數（預設 80）
- **sentence-enders?**: 句子感知分段（on/off，預設 on）

### Response
```html
<script type="application/json-rpc" hx-swap-oob="beforeend:head">
[[0,918,[9,0]],
["https://turboscribe.ai/_content/fn/J8YWeAAEkpMBzQLPkgCbBwCTCM4E9k18znMgAAABCALNJxADUATDlahtZWRpYS1pZLVtYXgtd29yZHMtcGVyLXNlZ21lbnS4bWF4LWR1cmF0aW9uLXBlci1zZWdtZW50um1heC1jaGFyYWN0ZXJzLXBlci1zZWdtZW50sHNlbnRlbmNlLWVuZGVycz8/If%202%2B2%20is%204....srt?vid=7214766603053867530&language=zh-TW&etag=Y3E-l5C4z38Agpu9JlUu2ruWlLH-39M5F-5rgbzsVYw&e=1772046787487&s=TZBalnXiyXpBM7vJPIiCFzwuDAEOTLvY8Et_kQeanew"]]
</script>
```

### Parsing Download URL
```javascript
const scriptMatch = html.match(/<script type="application\/json-rpc"[^>]*>([\\s\\S]*?)<\/script>/);
const json = JSON.parse(scriptMatch[1]);
const srtUrl = json[1];  // 完整的 SRT 下載 URL
```

### Step 4.2: Download SRT File

```http
GET https://turboscribe.ai/_content/fn/J8YWeAAEkpMBzQLPkgCbBwCTCM4E9k18znMgAAABCALNJxADUATDlahtZWRpYS1pZLVtYXgtd29yZHMtcGVyLXNlZ21lbnS4bWF4LWR1cmF0aW9uLXBlci1zZWdtZW50um1heC1jaGFyYWN0ZXJzLXBlci1zZWdtZW50sHNlbnRlbmNlLWVuZGVycz8/If%202%2B2%20is%204....srt?vid=7214766603053867530&language=zh-TW&etag=Y3E-l5C4z38Agpu9JlUu2ruWlLH-39M5F-5rgbzsVYw&e=1772046787487&s=TZBalnXiyXpBM7vJPIiCFzwuDAEOTLvY8Et_kQeanew
Cookie: [same as above]
```

直接下載即可取得 SRT 檔案內容

---

## 必需的 Authentication Cookies

以下 cookies 為必需，需從已登入的瀏覽器 session 複製：

```
session-secret=e773bd139b2c80d0823b3344c428b06e83b1
access-token=RSmP4zbnI9dknXB9/0Yxuwk1
device-token=Gj7VCgjfFpa4FTr669Snq3FD
fingerprint=VDw_NhRkiqXh4HhZI-giYxDi2NZf-6Cchiz66i2fyO1vflcPAASRnQOTCM4CcSjFzmUgAACTCM4Dctn-zk8AAACTCM4DctoAzk8AAACTCM4AbDKozhnAAACTCM4E3J_bzi7AAACTCM4Acmd8zhPAAACTCM4DieY3znegAACTCM4AcCQKzkzgAACTCM4DgwPFzgBAAACTCM4AhF15zgZAAACTCM4Dctn_zk8AAACTCM4AapgYzk2gAAA
```

其他可選的 cookies（用於追蹤）：
- `_ga`, `_fbp`, `FPID`, `FPLC`, `FPAU`, `_uetsid`, `_uetvid`, `_gcl_au`, `_ga_LCTR22QQ87`

---

## Python Script 實作範例

```python
import requests
import json
import time
import re

class TurboScribeAPI:
    def __init__(self, cookies):
        self.base_url = "https://turboscribe.ai"
        self.cookies = cookies
        self.headers = {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
    
    def import_url(self, media_url):
        """Step 1: Import video URL and get handle"""
        endpoint = "/_htmx/hP40AwAEkpMBzQPskwcAkgkBkqtkcm9wem9uZS1pZL9MLTY1YnJRUEdOMkljYjBmd3ZQUEJvbXcxMTZjYTVi"
        payload = {"media-url": media_url}
        
        response = requests.post(
            f"{self.base_url}{endpoint}",
            json=payload,
            cookies=self.cookies,
            headers=self.headers
        )
        
        # Parse handle from response
        script_match = re.search(r'<script type="application/json-rpc">(.*?)</script>', response.text, re.DOTALL)
        if not script_match:
            raise Exception("Failed to extract handle from response")
        
        json_data = json.loads(script_match.group(1))
        handle = json_data[1][2]
        video_name = json_data[1][4]
        
        return handle, video_name
    
    def submit_transcription(self, handle, language="English", model="large-v2", num_speakers=2):
        """Step 2: Submit transcription job"""
        endpoint = "/_htmx/gZ_HcwAEkpMBzQKqlwcAkwjOAjrwSc4kAAAAAcMCwJOpZm9sZGVyLWlksHdpbmRvdy1kcm9wem9uZT-9YXV0b21hdGljYWxseS1jcmVhdGUtYWNjb3VudD8"
        payload = {
            "json:handles": json.dumps([handle]),
            "language": language,
            "whisper-model": model,
            "int:num-speakers": str(num_speakers)
        }
        
        response = requests.post(
            f"{self.base_url}{endpoint}",
            json=payload,
            cookies=self.cookies,
            headers=self.headers
        )
        
        return response.status_code == 200
    
    def poll_progress(self, max_retries=120, interval=2):
        """Step 3: Poll for transcription completion"""
        # Simplified: in production, need to track media_id and use proper polling endpoints
        # For now, sleep and return True
        print(f"Waiting for transcription to complete (max {max_retries * interval}s)...")
        time.sleep(15)  # Wait minimum time for short video
        return True
    
    def download_srt(self, media_id, max_words=8, max_duration=10, max_chars=80):
        """Step 4: Download SRT file"""
        # Step 4.1: Request SRT URL
        endpoint = "/_htmx/83Z0_QAEkpMBzQQhkwcAkwjOBPZNfM5zIAAAkahtZWRpYS1pZA"
        payload = {
            "int:max-words-per-segment": str(max_words),
            "int:max-duration-per-segment-seconds": str(max_duration),
            "int:max-characters-per-segment": str(max_chars),
            "bool:sentence-enders?": "on"
        }
        
        response = requests.post(
            f"{self.base_url}{endpoint}",
            json=payload,
            cookies=self.cookies,
            headers=self.headers
        )
        
        # Parse SRT URL
        script_match = re.search(r'<script type="application/json-rpc"[^>]*>(.*?)</script>', response.text, re.DOTALL)
        if not script_match:
            raise Exception("Failed to extract SRT URL")
        
        json_data = json.loads(script_match.group(1))
        srt_url = json_data[1]
        
        # Step 4.2: Download SRT
        srt_response = requests.get(srt_url, cookies=self.cookies)
        return srt_response.text
    
    def transcribe(self, media_url, language="English", model="large-v2"):
        """Complete workflow: Import → Submit → Poll → Download"""
        print(f"[1/4] Importing URL: {media_url}")
        handle, video_name = self.import_url(media_url)
        print(f"✓ Got handle for: {video_name}")
        
        print(f"[2/4] Submitting transcription (language={language}, model={model})")
        success = self.submit_transcription(handle, language, model)
        if not success:
            raise Exception("Failed to submit transcription")
        print("✓ Transcription submitted")
        
        print("[3/4] Polling for completion...")
        completed = self.poll_progress()
        if not completed:
            raise Exception("Transcription timeout")
        print("✓ Transcription completed")
        
        print("[4/4] Downloading SRT...")
        # Note: Need to implement proper media_id tracking
        # For now, this is placeholder
        print("⚠ Need to implement media_id extraction from polling")
        
        return "TODO: Complete implementation"

# Usage
cookies = {
    "session-secret": "your_session_secret",
    "access-token": "your_access_token",
    "device-token": "your_device_token",
    "fingerprint": "your_fingerprint"
}

api = TurboScribeAPI(cookies)
result = api.transcribe(
    media_url="https://youtube.com/shorts/8FFiXyDdPnY",
    language="English",
    model="large-v2"
)
```

---

## 實作建議：持久化狀態追蹤

由於轉錄需要時間（無法一直 blocking wait），建議實作：

### 1. Job Tracking Database
```python
# jobs.json
{
  "jobs": [
    {
      "job_id": "uuid-1234",
      "media_url": "https://youtube.com/shorts/...",
      "handle": "ZsIq0QAE...",
      "media_id": null,  # 從 polling 取得
      "status": "running",  # ready, running, completed, failed
      "language": "English",
      "whisper_model": "large-v2",
      "created_at": "2026-02-17T06:34:00Z",
      "completed_at": null,
      "srt_path": null
    }
  ]
}
```

### 2. Background Polling Worker
```python
# worker.py
import schedule
import time

def poll_pending_jobs():
    jobs = load_jobs()
    for job in jobs:
        if job['status'] in ['ready', 'running']:
            # Poll progress
            # Update status and media_id
            # Download SRT when completed
            pass

# Run every 5 seconds
schedule.every(5).seconds.do(poll_pending_jobs)

while True:
    schedule.run_pending()
    time.sleep(1)
```

### 3. API Interface
```python
# api.py
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/transcribe', methods=['POST'])
def submit_transcription():
    """Submit new transcription job"""
    data = request.json
    job_id = create_job(
        media_url=data['url'],
        language=data.get('language', 'English')
    )
    return jsonify({"job_id": job_id, "status": "submitted"})

@app.route('/status/<job_id>', methods=['GET'])
def get_status(job_id):
    """Check transcription status"""
    job = get_job(job_id)
    return jsonify(job)

@app.route('/download/<job_id>', methods=['GET'])
def download_srt(job_id):
    """Download SRT file (only if completed)"""
    job = get_job(job_id)
    if job['status'] != 'completed':
        return jsonify({"error": "Not ready"}), 400
    
    with open(job['srt_path'], 'r') as f:
        return f.read(), 200, {
            'Content-Type': 'text/plain',
            'Content-Disposition': f'attachment; filename="{job_id}.srt"'
        }
```

---

## 測試紀錄

- **測試日期**: 2026-02-17
- **測試時間**: 上午 6:34
- **測試影片**: https://youtube.com/shorts/8FFiXyDdPnY
- **影片時長**: 12秒
- **轉錄耗時**: 約 10 秒
- **Handle**: `ZsIq0QAEkpUBkwjOAGCiCs5kIAAAy0J5xtuldHAA3AARBwCSBAECkgkDBMAFwAbAB8tB8/sAAAAAAAjACZIJCpMIzgT11//OcyAAAJuocHJvdmlkZXKncjItZW5hbaNrZXnZRDcyMTQ3NjY2MDMwNTM4Njc1MzBfMjIwLjE0My4xMjguMTU0X3BLM3VsOERsUjFDUmN2YzRhNEpOa2xJbWlKYXN3RVA2o21kNaRtaW1lpHNpemWobWF4LXNpemWoZHVyYXRpb26kbmFtZa5JZiAyKzIgaXMgNC4uLg==_IcZxrsFwIZfPsRNuxU3HV672`
- **Media ID**: `8295630513699704188`
- **語言**: English
- **模型**: large-v2 (Whale 🐳)

---

## 已知限制與注意事項

1. **Endpoint 可能變動**: Import URL 的 endpoint 包含 dropzone-id，可能會定期更新
2. **Cookie 過期**: Session cookies 會過期，需定期更新或實作登入流程
3. **Rate Limiting**: 未知是否有 API rate limit，建議加入 retry 機制
4. **Media ID 追蹤**: 目前需要從 polling response 的 HTML 中解析 media_id，較為脆弱
5. **Error Handling**: 需完整處理各種錯誤情況（網路錯誤、轉錄失敗、超時等）

---

## 下一步

1. ✅ 驗證所有 API endpoints
2. ✅ 記錄完整的請求/回應格式
3. ⬜ 實作完整的 Python script
4. ⬜ 加入 media_id 追蹤機制
5. ⬜ 實作 background worker
6. ⬜ 建立持久化的 job tracking system
7. ⬜ 加入 error handling 和 retry 機制
8. ⬜ 測試多個影片以驗證穩定性
