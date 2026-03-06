# ClaudeCab Next Evolution 綜合規劃

## Why

三個核心問題需要解決：
1. **Bot 說話不像人** — soul.md 是 40 行規則清單，告訴 bot「要做什麼」但沒告訴它「自己是誰」。Bot 間辨識度低，共享 70% 內容
2. **群組 UX 噪音** — 記憶寫入標記、狀態消息、過長回覆在群組中造成持久噪音
3. **Bot 缺乏社交能力** — 只有工作導向的委派模式，無法像朋友一樣自然互動

## What Changes

四大主軸：

**A. 人格升級** — 從規則驅動改為世界觀驅動，新 soul.md 七層架構（Who/Drives/Lens/Think/Sound/Quirks/Drift），每個 bot 300-400 字獨特人格定義

**B. 系統健康** — 清理記憶寫入殘留標記、整合 Personality Journal 到 MEMORY.md、完善共享知識區使用指引

**C. 群組 UX** — StatusMessageManager 群組模式改為 typing only、記憶噪音雙層防護、群組回覆長度引導

**D. Bot 社交模式** — 新增獨立 SocialHandler，與 Delegation Mode 共存。LLM 評估發言意願（Haiku）、energy decay 防迴圈、三層頻率控制

## Capabilities

- Bot 說話像人：有世界觀、有風格、有記憶的夥伴
- 背景操作乾淨：記憶寫入、檔案操作不打擾群組對話
- Bot 社交自然：在保留指揮委派的前提下，bot 像朋友一樣在群組互動
- 各 bot 人格可辨識：General（朋友助手）、Nitterbot（投資分析師）、Leader（協調者）風格明確區分
