#!/usr/bin/env python3
"""
TurboScribe API Client
拆分為獨立步驟：import → submit → poll，每步可單獨執行、單獨除錯。
SRT 下載由 agent-browser 負責（Cloudflare 擋非瀏覽器存取）
"""

import requests
import json
import re
import time
import csv
import os
import sys
from datetime import datetime
from pathlib import Path

# Cookie 配置（從瀏覽器擷取，2026-02-18 更新）
COOKIES = {
    "webp": "1805837323556",
    "avif": "1805837323556",
    "session-secret": "e773bd139b2c80d0823b3344c428b06e83b1",
    "snowflake": "AhwOn0qXhvONSwYgPiTbUw==",
    "lev": "1",
    "screen-width": "1746",
    "screen-height": "982",
    "device-pixel-ratio": "1.100000023841858",
    "time-zone": "Asia/Taipei",
    "js": "1",
    "device-token": "Gj7VCgjfFpa4FTr669Snq3FD",
    "_ga": "GA1.1.2072098574.1771277330",
    "_fbp": "fb.1.1771277329699.554811089260122635",
    "FPID": "FPID2.2.pLJnto0KVVMaxR63ATnFosDCppjJYBZTTE1jjvUBYx0=.1771277330",
    "FPLC": "KyRdziSDa4/yLodnk2X46kLpwDDEwpueDgtDIMlqpvASCPcFL5ie3tHlnIsIAx5tNcKmn0438MK6+dbrXo24UiSjsc/XszH3CxVtTdnnMzyapMglarimZSo+Y7QekQ==",
    "FPAU": "1.1.696482506.1771277330",
    "i18n-activated-languages": "zh-TW,en",
    "window-width": "1637",
    "access-token": "RSmP4zbnI9dknXB9/0Yxuwk1",
    "window-height": "719",
    "fingerprint": "EKCihVUyO02IBwV_8iG7Kt8uaJCHbKVHpqAUa5GlQrK06sT2AASRnQOTCM4Acmd8zhPAAACTCM4DctoAzk8AAACTCM4DieY3znegAACTCM4AcCQKzkzgAACTCM4CcSjFzmUgAACTCM4Dctn_zk8AAACTCM4E3J_bzi7AAACTCM4AapgYzk2gAACTCM4AbDKozhnAAACTCM4AhF15zgZAAACTCM4DgwPFzgBAAACTCM4Dctn-zk8AAAA",
    "_uetsid": "7c4260300b7e11f1a7a507ebcbaddd52",
    "_uetvid": "7c4298c00b7e11f1b93b9975657eb1ae",
    "_gcl_au": "1.1.696482506.1771277330.917756331.1771355932.1771357363",
    "_ga_LCTR22QQ87": "GS2.1.s1771355921$o5$g1$t1771357363$j35$l0$h20578425"
}

HEADERS = {
    "accept": "*/*",
    "accept-encoding": "identity",
    "accept-language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    "content-type": "application/json",
    "origin": "https://turboscribe.ai",
    "referer": "https://turboscribe.ai/zh-TW/dashboard/folder/2594073385402822729",
    "sec-ch-ua": '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
    "x-lev-xhr": "",
    "x-turbolinks-loaded": ""
}

BASE_URL = "https://turboscribe.ai"

IMPORT_ENDPOINT = "/_htmx/hP40AwAEkpMBzQPskwcAkgkBkqtkcm9wem9uZS1pZL9MLTY1YnJRUEdOMkljYjBmd3ZQUEJvbXcxMTZjYTVi"
SUBMIT_ENDPOINT = "/_htmx/gZ_HcwAEkpMBzQKqlwcAkwjOAjrwSc4kAAAAAcMCwJOpZm9sZGVyLWlksHdpbmRvdy1kcm9wem9uZT-9YXV0b21hdGljYWxseS1jcmVhdGUtYWNjb3VudD8"
LIST_PAYLOAD = {
    "json:handles": json.dumps([]),
    "language": "English",
    "whisper-model": "large-v2",
    "int:num-speakers": "2"
}

CSV_FIELDS = [
    'job_id', 'media_url', 'language', 'model',
    'status', 'handle', 'media_id', 'video_name',
    'created_at', 'completed_at',
    'before_ids', 'srt_path'
]

# 路徑配置
SCRIPT_DIR = Path(__file__).parent.parent  # dom-turboscribe/
OUTPUT_DIR = SCRIPT_DIR / "output"
JOBS_CSV = str(OUTPUT_DIR / "turboscribe_jobs.csv")


def log(msg):
    print(msg, flush=True)


class TurboScribeAPI:
    def __init__(self):
        self.session = requests.Session()
        self.session.cookies.update(COOKIES)
        self.session.headers.update(HEADERS)
        self._init_csv()

    def _init_csv(self):
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        if not os.path.exists(JOBS_CSV):
            with open(JOBS_CSV, 'w', newline='', encoding='utf-8') as f:
                csv.writer(f).writerow(CSV_FIELDS)

    def _save_job(self, job_data):
        with open(JOBS_CSV, 'a', newline='', encoding='utf-8') as f:
            csv.writer(f).writerow([job_data.get(k, '') for k in CSV_FIELDS])

    def _update_job(self, job_id, updates):
        rows = []
        with open(JOBS_CSV, 'r', encoding='utf-8') as f:
            rows = list(csv.DictReader(f))
        for row in rows:
            if row['job_id'] == job_id:
                row.update(updates)
        with open(JOBS_CSV, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction='ignore')
            writer.writeheader()
            writer.writerows(rows)

    def _get_job(self, job_id):
        with open(JOBS_CSV, 'r', encoding='utf-8') as f:
            for row in csv.DictReader(f):
                if row['job_id'] == job_id:
                    return row
        return None

    # ── API Methods ──

    def import_url(self, media_url):
        response = self.session.post(
            f"{BASE_URL}{IMPORT_ENDPOINT}",
            json={"media-url": media_url}
        )
        if response.status_code != 200:
            log(f"[import] Status: {response.status_code}")
            log(f"[import] Response headers: {dict(response.headers)}")
            log(f"[import] Response body: {response.text[:500]}")
            raise Exception(f"Import failed: {response.status_code}")

        script_match = re.search(
            r'<script type="application/json-rpc">(.*?)</script>',
            response.text, re.DOTALL
        )
        if not script_match:
            raise Exception("Failed to extract handle from response")

        json_data = json.loads(script_match.group(1))
        return json_data[1][2], json_data[1][4]  # handle, video_name

    def list_all_media_ids(self):
        """用空 handles 打 SUBMIT_ENDPOINT 取得所有 transcript IDs"""
        response = self.session.post(f"{BASE_URL}{SUBMIT_ENDPOINT}", json=LIST_PAYLOAD)
        if response.status_code != 200:
            raise Exception(f"List failed: {response.status_code}")
        return set(re.findall(r'/transcript/(\d+)/', response.text))

    def submit_transcription(self, handle, language="English", model="large-v2", num_speakers=2):
        payload = {
            "json:handles": json.dumps([handle]),
            "language": language,
            "whisper-model": model,
            "int:num-speakers": str(num_speakers)
        }
        response = self.session.post(f"{BASE_URL}{SUBMIT_ENDPOINT}", json=payload)
        return response.status_code == 200

    def poll_progress(self, before_ids=None, video_name=None, max_retries=120, interval=5):
        """輪詢直到出現新的 transcript ID"""
        for i in range(max_retries):
            try:
                response = self.session.post(f"{BASE_URL}{SUBMIT_ENDPOINT}", json=LIST_PAYLOAD)
                current_ids = set(re.findall(r'/transcript/(\d+)/', response.text))
                new_ids = current_ids - (before_ids or set())

                if new_ids:
                    # 如果有 video_name，嘗試找到對應的 ID
                    if video_name:
                        for nid in new_ids:
                            pattern = f'/transcript/{nid}/'
                            idx = response.text.find(pattern)
                            if idx > 0:
                                context = response.text[idx:idx+200]
                                if any(w in context.lower() for w in video_name.lower().split()[:3]):
                                    log(f"[{i+1}] 找到匹配: {nid}")
                                    return nid
                    # 如果沒有 video_name 或找不到匹配，回傳第一個新 ID
                    new_id = next(iter(new_ids))
                    log(f"[{i+1}] 新 transcript: {new_id}")
                    return new_id

                log(f"[{i+1}/{max_retries}] 等待轉錄完成...")
                time.sleep(interval)
            except Exception as e:
                log(f"輪詢錯誤: {e}")
                time.sleep(interval)

        raise Exception("轉錄超時")

    # ── CLI Step Methods ──

    def _find_job_by_url(self, media_url):
        """查找 CSV 中是否已有此 URL 的非失敗 job"""
        if not os.path.exists(JOBS_CSV):
            return None
        with open(JOBS_CSV, 'r', encoding='utf-8') as f:
            for row in csv.DictReader(f):
                if row.get('media_url') == media_url and row.get('status') != 'failed':
                    return row
        return None

    def cmd_import(self, media_url, language="English", model="large-v2"):
        """Step 1: Import URL → 建立 job、取得 handle、存 CSV"""
        existing = self._find_job_by_url(media_url)
        if existing:
            log(f"[import] URL 已存在: {existing['job_id']} (status={existing['status']})")
            return existing['job_id'], existing.get('handle', ''), existing.get('video_name', '')

        job_id = f"job_{int(time.time())}"
        log(f"[import] 匯入 URL: {media_url}")

        handle, video_name = self.import_url(media_url)
        log(f"[import] handle: {handle}")
        log(f"[import] video: {video_name}")

        self._save_job({
            'job_id': job_id,
            'media_url': media_url,
            'language': language,
            'model': model,
            'status': 'imported',
            'handle': handle,
            'video_name': video_name,
            'created_at': datetime.now().isoformat(),
        })

        log(f"[import] Job ID: {job_id}")
        return job_id, handle, video_name

    def cmd_submit(self, job_id):
        """Step 2: Submit transcription → 記錄 before_ids，輪詢用"""
        job = self._get_job(job_id)
        if not job:
            raise Exception(f"找不到 Job: {job_id}")

        handle = job['handle']
        language = job.get('language', 'English')
        model = job.get('model', 'large-v2')

        log(f"[submit] 取得 before_ids...")
        before_ids = self.list_all_media_ids()
        log(f"[submit] 目前有 {len(before_ids)} 個 transcript")

        log(f"[submit] 提交轉錄 (語言={language}, 模型={model})")
        success = self.submit_transcription(handle, language, model)

        if not success:
            self._update_job(job_id, {'status': 'failed'})
            raise Exception("提交轉錄失敗")

        self._update_job(job_id, {
            'status': 'running',
            'before_ids': ','.join(before_ids),
        })

        log(f"[submit] 已提交，before_ids={len(before_ids)} 個")
        return before_ids

    def cmd_poll(self, job_id):
        """Step 3: Poll until completion → 更新 media_id"""
        job = self._get_job(job_id)
        if not job:
            raise Exception(f"找不到 Job: {job_id}")

        before_ids_str = job.get('before_ids', '')
        before_ids = set(before_ids_str.split(',')) if before_ids_str else set()
        video_name = job.get('video_name', '')

        log(f"[poll] before_ids 數量: {len(before_ids)}")
        log(f"[poll] video_name: {video_name}")
        log(f"[poll] 開始輪詢...")

        media_id = self.poll_progress(before_ids=before_ids, video_name=video_name)

        self._update_job(job_id, {
            'status': 'completed',
            'media_id': media_id,
            'completed_at': datetime.now().isoformat(),
        })

        transcript_url = f"{BASE_URL}/zh-TW/transcript/{media_id}/"
        log(f"[poll] 轉錄完成！")
        log(f"[poll] Media ID: {media_id}")
        log(f"[poll] Transcript URL: {transcript_url}")
        return media_id, transcript_url

    def cmd_pending(self):
        """列出已完成轉錄但尚未下載 SRT 的 jobs"""
        if not os.path.exists(JOBS_CSV):
            log("無任何 job")
            return []
        pending = []
        with open(JOBS_CSV, 'r', encoding='utf-8') as f:
            for row in csv.DictReader(f):
                if row.get('status') == 'completed' and row.get('media_id') and not row.get('srt_path'):
                    pending.append(row)
        if not pending:
            log("[pending] 無待下載 SRT 的 job")
        else:
            for job in pending:
                log(f"  {job['job_id']}  {job['video_name']}")
                log(f"    URL: {BASE_URL}/zh-TW/transcript/{job['media_id']}/")
        return pending

    def cmd_done(self, job_id, srt_path):
        """標記 job 的 SRT 已下載，記錄檔案路徑"""
        job = self._get_job(job_id)
        if not job:
            raise Exception(f"找不到 Job: {job_id}")
        if not os.path.exists(srt_path):
            raise Exception(f"SRT 檔案不存在: {srt_path}")
        self._update_job(job_id, {'status': 'done', 'srt_path': srt_path})
        log(f"[done] {job_id} → {srt_path}")


def main():
    if len(sys.argv) < 2:
        log("用法:")
        log("  python turboscribe.py import  <url> [language] [model]  — 匯入影片（自動去重）")
        log("  python turboscribe.py submit  <job_id>                  — 提交轉錄任務")
        log("  python turboscribe.py poll    <job_id>                  — 輪詢等待完成")
        log("  python turboscribe.py pending                           — 列出待下載 SRT 的 jobs")
        log("  python turboscribe.py done    <job_id> <srt_path>       — 標記 SRT 已下載")
        log("  python turboscribe.py status  <job_id>                  — 查詢 job 狀態")
        log("")
        log("完整流程: import → submit → poll → (agent-browser 下載 SRT) → done")
        sys.exit(1)

    api = TurboScribeAPI()
    command = sys.argv[1]

    if command == "import":
        if len(sys.argv) < 3:
            log("錯誤: 需要提供 URL")
            sys.exit(1)
        url = sys.argv[2]
        language = sys.argv[3] if len(sys.argv) > 3 else "English"
        model = sys.argv[4] if len(sys.argv) > 4 else "large-v2"
        api.cmd_import(url, language, model)

    elif command == "submit":
        if len(sys.argv) < 3:
            log("錯誤: 需要提供 job_id")
            sys.exit(1)
        api.cmd_submit(sys.argv[2])

    elif command == "poll":
        if len(sys.argv) < 3:
            log("錯誤: 需要提供 job_id")
            sys.exit(1)
        api.cmd_poll(sys.argv[2])

    elif command == "pending":
        api.cmd_pending()

    elif command == "done":
        if len(sys.argv) < 4:
            log("錯誤: 需要提供 job_id 和 srt_path")
            sys.exit(1)
        api.cmd_done(sys.argv[2], sys.argv[3])

    elif command == "status":
        if len(sys.argv) < 3:
            log("錯誤: 需要提供 job_id")
            sys.exit(1)
        job = api._get_job(sys.argv[2])
        if not job:
            log(f"找不到 Job: {sys.argv[2]}")
            sys.exit(1)
        for k in CSV_FIELDS:
            v = job.get(k, '')
            if v:
                log(f"  {k}: {v}")

    else:
        log(f"未知指令: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
