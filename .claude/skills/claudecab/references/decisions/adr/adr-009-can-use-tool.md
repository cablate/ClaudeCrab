---
id: ADR-009
title: canUseTool callback（SDK 原生機制）vs Hook system
status: accepted
date: 2026-01-28
---

# ADR-009: canUseTool callback（SDK 原生機制）vs Hook system

## 背景

需要在 Telegram 中實作工具使用的人類審批流程，有兩種可能機制

## 選項

1. SDK 的 `canUseTool` callback — SDK 為程式化權限處理設計的原生機制
2. Hook system（PreToolUse） — SDK 的事件攔截機制

## 決策

選擇 `canUseTool` callback

## 理由

- `canUseTool` 是 SDK 專為程式化權限處理設計的機制，回傳 Promise<PermissionResult> 與 Telegram 按鈕互動天然匹配
- Promise-based 設計可以直接 await Telegram 使用者的按鈕回應
- Hook system 設計目的偏向日誌記錄和觀察，非權限控制

## 實作位置

- `src/core/PermissionBridge.ts`（Promise 橋接）
- `src/core/MessageProcessor.ts`（canUseTool 閉包組裝）
