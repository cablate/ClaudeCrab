#!/usr/bin/env python3
"""
Content Analyzer - 批次內容分析腳本

使用方式：
  python analyze.py                    # 分析所有未處理的內容
  python analyze.py --limit 10         # 只處理 10 篇
  python analyze.py --dry-run          # 只顯示分析結果，不寫入
  python analyze.py --page 2           # 從第 2 頁開始
"""

import argparse
import json
import requests
from typing import Optional

BASE_URL = "http://localhost:3003"


def get_content_types() -> list[dict]:
    """取得預定義的內容類型清單"""
    resp = requests.get(f"{BASE_URL}/api/analyses/content-types")
    resp.raise_for_status()
    return resp.json()["data"]["content_types"]


def get_existing_topics() -> list[dict]:
    """取得已存在的 topic 詞彙表"""
    resp = requests.get(f"{BASE_URL}/api/analyses/topics/distinct")
    resp.raise_for_status()
    return resp.json()["data"]["topics"]


def get_unanalyzed_contents(page: int = 1, limit: int = 20) -> dict:
    """取得待分析的內容"""
    resp = requests.get(
        f"{BASE_URL}/api/contents/unanalyzed",
        params={"page": page, "limit": limit, "fields": "id,text,media_url"}
    )
    resp.raise_for_status()
    data = resp.json()
    return {
        "contents": data["data"]["contents"],
        "pagination": data["meta"]["pagination"]
    }


def post_analysis(analysis: dict) -> dict:
    """寫入分析結果"""
    resp = requests.post(
        f"{BASE_URL}/api/analyses",
        json=analysis,
        headers={"Content-Type": "application/json"}
    )
    resp.raise_for_status()
    return resp.json()


def format_analysis_for_display(content: dict, analysis: dict) -> str:
    """格式化分析結果供顯示"""
    text_preview = content["text"][:100] + "..." if len(content["text"]) > 100 else content["text"]
    text_preview = text_preview.replace("\n", " ")

    topics_str = ", ".join(
        f"{t['topic']}({t['confidence']}, {t['weight']})"
        for t in analysis.get("topics", [])
    ) or "(無)"

    return f"""
--- {content['id'][:8]}... ---
原文: {text_preview}
content_type: {analysis['content_type']}
topics: {topics_str}
"""


def main():
    parser = argparse.ArgumentParser(description="批次內容分析")
    parser.add_argument("--limit", type=int, default=20, help="每頁處理數量")
    parser.add_argument("--page", type=int, default=1, help="起始頁碼")
    parser.add_argument("--dry-run", action="store_true", help="只顯示不寫入")
    parser.add_argument("--all", action="store_true", help="處理所有頁面")
    args = parser.parse_args()

    # 取得參考資料
    print("取得參考資料...")
    content_types = get_content_types()
    existing_topics = get_existing_topics()

    print(f"  - {len(content_types)} 種 content_type")
    print(f"  - {len(existing_topics)} 個已存在的 topic")
    if existing_topics:
        print(f"    已存在: {', '.join(t['topic'] for t in existing_topics[:10])}")

    # 取得待分析內容
    current_page = args.page
    total_processed = 0
    total_success = 0
    total_failed = 0

    while True:
        print(f"\n取得第 {current_page} 頁內容...")
        result = get_unanalyzed_contents(page=current_page, limit=args.limit)
        contents = result["contents"]
        pagination = result["pagination"]

        if not contents:
            print("沒有更多待分析的內容")
            break

        print(f"  共 {pagination['total']} 篇待分析，本頁 {len(contents)} 篇")

        # 這裡需要人工輸入分析結果
        # 在實際使用時，這部分會由 AI 來做判斷
        print("\n" + "="*60)
        print("請為以下內容提供分析結果")
        print("格式: content_type|topic1:confidence:weight,topic2:confidence:weight")
        print("例如: 經驗分享|AI Skill:core:0.9,自媒體經營:related:0.4")
        print("輸入 skip 跳過，輸入 quit 結束")
        print("="*60)

        for content in contents:
            print(f"\n【{content['id'][:8]}...】")
            print(f"原文:\n{content['text']}\n")

            user_input = input("分析結果 > ").strip()

            if user_input.lower() == "quit":
                print("\n結束分析")
                return

            if user_input.lower() == "skip":
                print("  跳過")
                continue

            try:
                # 解析輸入
                parts = user_input.split("|")
                content_type = parts[0].strip()

                topics = []
                if len(parts) > 1 and parts[1].strip():
                    for topic_str in parts[1].split(","):
                        topic_parts = topic_str.strip().split(":")
                        topics.append({
                            "topic": topic_parts[0].strip(),
                            "confidence": topic_parts[1].strip() if len(topic_parts) > 1 else "core",
                            "weight": float(topic_parts[2].strip()) if len(topic_parts) > 2 else 0.8
                        })

                analysis = {
                    "content_id": content["id"],
                    "content_type": content_type,
                    "topics": topics,
                    "analyzed_by": "human"
                }

                print(format_analysis_for_display(content, analysis))

                if not args.dry_run:
                    post_analysis(analysis)
                    print("  ✓ 已寫入")
                    total_success += 1
                else:
                    print("  (dry-run, 未寫入)")

                total_processed += 1

            except Exception as e:
                print(f"  ✗ 錯誤: {e}")
                total_failed += 1

        if not args.all or current_page >= pagination["pages"]:
            break

        current_page += 1

    print(f"\n完成！處理 {total_processed} 篇，成功 {total_success}，失敗 {total_failed}")


if __name__ == "__main__":
    main()
