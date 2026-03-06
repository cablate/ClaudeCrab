# Agent 專門化方案設計

## Why

ClaudeCab 需要讓使用者能方便地建立專門化 Agent 並配置所需的 plugin/skill/MCP 能力，類似 Moltbot 的 Agent 專門化生態。現有 AgentConfig schema 中 `mcpConfigFile` 已定義但未使用，Skills 和 Plugin 機制完全缺失。

## What Changes

設計五種可行方案，並按優先級分階段實作：

**第一階段（已完成）**：
- **Skills 目錄整合**：利用 SDK 自動從 `.claude/skills/` 載入 SKILL.md
- **MCP Server 整合**：利用 SDK 自動從 `.mcp.json` 讀取 MCP 配置
- WebUI Skills 管理頁面（列出、上傳、編輯、刪除、預覽）

**第二階段（規劃中）**：
- In-Process 自訂 Tools（`createSdkMcpServer()` 建立 ClaudeCab 專屬工具）
- Plugin 混合模式（CLI 安裝 + SDK local 載入）

**第三階段（規劃中）**：
- Agent Routing（單一 Bot 路由到不同 Agent）
- Plugin Marketplace 整合

## Capabilities

- 每個 Agent 擁有專屬 Skills，符合 Anthropic SKILL.md 標準格式
- MCP Server 整合讓 Agent 可連接外部工具（filesystem、browser、database 等）
- SDK 原生支援，不需自訂載入邏輯
- 可透過 Git 版本控制 Skills
- WebUI 提供視覺化管理介面
