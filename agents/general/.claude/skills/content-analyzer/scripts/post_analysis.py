#!/usr/bin/env python3
"""
Post Analysis - 將分析結果寫入 API

使用方式：
  # POST - 單筆寫入
  python post_analysis.py '{"content_id":"uuid","content_type":"經驗分享","topics":[...],"analyzed_by":"claude"}'

  # POST - 批次寫入（從檔案）
  python post_analysis.py --file results.json

  # POST - 從 stdin 讀取
  echo '[{...}]' | python post_analysis.py --stdin

  # PUT - 補寫欄位（merge 更新）
  python post_analysis.py --put analysis-uuid '{"key_insights":[...],"knowledge_density":7,"density_reasoning":"..."}'

  # PUT - 批次補寫（從檔案，每筆需含 id 欄位）
  python post_analysis.py --put-file updates.json
"""

import argparse
import json
import sys
import requests

BASE_URL = "http://localhost:3003"


def post_analysis(analysis: dict) -> dict:
    """寫入單筆分析結果（POST）"""
    resp = requests.post(
        f"{BASE_URL}/api/analyses",
        json=analysis,
        headers={"Content-Type": "application/json"}
    )
    resp.raise_for_status()
    return resp.json()


def put_analysis(analysis_id: str, data: dict) -> dict:
    """補寫分析欄位（PUT merge）"""
    resp = requests.put(
        f"{BASE_URL}/api/analyses/{analysis_id}",
        json=data,
        headers={"Content-Type": "application/json"}
    )
    resp.raise_for_status()
    return resp.json()


def process_post(data: dict) -> bool:
    """處理單筆 POST"""
    try:
        post_analysis(data)
        content_id = data.get("content_id", "unknown")[:8]
        print(f"  POST {content_id}... - {data.get('content_type')}")
        return True
    except requests.exceptions.HTTPError as e:
        print(f"  POST {data.get('content_id', 'unknown')[:8]}... - HTTP {e.response.status_code}: {e.response.text}")
        return False
    except Exception as e:
        print(f"  POST {data.get('content_id', 'unknown')[:8]}... - {e}")
        return False


def process_put(analysis_id: str, data: dict) -> bool:
    """處理單筆 PUT"""
    try:
        put_analysis(analysis_id, data)
        fields = ", ".join(data.keys())
        print(f"  PUT {analysis_id[:8]}... - [{fields}]")
        return True
    except requests.exceptions.HTTPError as e:
        print(f"  PUT {analysis_id[:8]}... - HTTP {e.response.status_code}: {e.response.text}")
        return False
    except Exception as e:
        print(f"  PUT {analysis_id[:8]}... - {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="寫入/更新分析結果到 API")
    parser.add_argument("json_data", nargs="?", help="JSON 字串（POST 單筆，或 PUT 的 body）")
    parser.add_argument("--file", "-f", help="JSON 檔案路徑（POST 批次，可包含單筆或陣列）")
    parser.add_argument("--stdin", action="store_true", help="從 stdin 讀取 JSON（POST）")
    parser.add_argument("--put", metavar="ID", help="PUT 模式：指定 analysis ID 做 merge 更新")
    parser.add_argument("--put-file", help="PUT 批次：JSON 檔案，每筆需含 id 欄位")
    args = parser.parse_args()

    success = 0
    failed = 0

    # PUT 單筆
    if args.put:
        if not args.json_data:
            print("錯誤：--put 需要提供 JSON body")
            sys.exit(1)
        data = json.loads(args.json_data)
        if process_put(args.put, data):
            success += 1
        else:
            failed += 1

    # PUT 批次
    elif args.put_file:
        with open(args.put_file, "r", encoding="utf-8") as f:
            items = json.load(f)
            if not isinstance(items, list):
                items = [items]

        for item in items:
            aid = item.pop("id", None)
            if not aid:
                print(f"  SKIP - 缺少 id 欄位: {json.dumps(item, ensure_ascii=False)[:80]}")
                failed += 1
                continue
            if process_put(aid, item):
                success += 1
            else:
                failed += 1

    # POST 模式
    else:
        data_list = []

        if args.stdin:
            raw = sys.stdin.read()
            data = json.loads(raw)
            data_list = data if isinstance(data, list) else [data]
        elif args.file:
            with open(args.file, "r", encoding="utf-8") as f:
                data = json.load(f)
                data_list = data if isinstance(data, list) else [data]
        elif args.json_data:
            data = json.loads(args.json_data)
            data_list = data if isinstance(data, list) else [data]
        else:
            parser.print_help()
            sys.exit(1)

        for item in data_list:
            if process_post(item):
                success += 1
            else:
                failed += 1

    # 結果
    total = success + failed
    if total > 1:
        print(f"\n共 {total} 筆，成功 {success}，失敗 {failed}")

    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
