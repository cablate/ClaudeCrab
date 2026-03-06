# ADR-001: 選擇 Claude Agent SDK 而非直接使用 API

選定 `claude-agent-sdk` 作為核心 SDK，取代直接呼叫 Anthropic API，以獲得內建的 session 管理、工具執行與 MCP 整合能力。
