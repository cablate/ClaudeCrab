---
id: ADR-011
title: SDK PermissionResult Zod schema vs TypeScript types 不一致
status: workaround
date: 2026-01-28
---

# ADR-011: SDK PermissionResult Zod schema vs TypeScript types 不一致

## 背景

SDK 的 `PermissionResult` 型別定義中，allow variant 的 `updatedInput` 欄位在 TypeScript type 中標記為 `optional`（`updatedInput?: object`），但實際 Zod schema 將其定義為 `required`

## 問題

若按 TypeScript type 不傳 `updatedInput`，runtime 會被 Zod validation 拒絕

## 決策

即使 TypeScript type 標記為 optional，仍然始終傳入 `updatedInput` 欄位（傳入原始 toolInput）

## 後果

- 程式碼與 TypeScript type 看似不一致，但確保 runtime 正確
- 需要在 changelog/troubleshooting 記錄此陷阱
- 未來 SDK 版本可能修復此不一致

## 實作位置

`src/core/MessageProcessor.ts`（canUseTool 閉包中的 allow 回應）
