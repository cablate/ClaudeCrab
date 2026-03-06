# Equip-v2 Skill 設計決策：AI 推導 vs 靜態模板

## Why

原始 equip skill 採用「邊想邊裝」模式，缺乏明確的需求分析階段。使用者提出需求：能否先根據角色盤點技能清單，再批量搜尋安裝？

經研究 AI agent capability planning 最佳實踐（CrewAI、Competency Matrix），提出系統化流程：角色定義 → 能力框架 → 現況盤點 → 缺口分析 → 工具搜尋 → 配置報告 → 批量安裝。

## What Changes

1. **腳本驅動 vs AI 推導**：使用 AI 動態推導 + 現有工具（find-skills/find-mcp），不使用腳本，保持簡單
2. **靜態範例 vs 動態產出**：`capability-frameworks.md` 作為 Phase 2 執行產出，記錄當前 agent 的能力定義；`capability-frameworks-template.md` 作為格式參考
3. **WebSearch 補強**：採用漸進式迭代，快速模式（預設）+ 深度模式（選用 WebSearch）
4. **工具生態系統**：完整支援三種工具類型 — Skills、MCP Servers、Claude Code Plugins
5. **Skill 開發流程**：確立 skill-creator 為 skill 開發標準流程（5 步驟）
6. **撰寫風格**：確立祈使語氣為中文 SKILL.md 撰寫規範

## Capabilities

- 建立系統化能力配置流程（7 階段：Phase 1-4 自動化 + Phase 5-7 互動式）
- 確立 skill-creator 為 skill 開發標準流程
- 定義動態產出檔案 vs 靜態參考檔案的使用場景
- 確立祈使語氣為中文 SKILL.md 撰寫規範
- 支援完整工具生態系統（Skills/MCPs/Plugins）
