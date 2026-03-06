# SDK PermissionResult Zod schema vs TypeScript types 不一致

## Why

SDK 的 `PermissionResult` 型別定義中，allow variant 的 `updatedInput` 欄位在 TypeScript type 中標記為 `optional`（`updatedInput?: object`），但實際 Zod schema 將其定義為 `required`。若按 TypeScript type 不傳 `updatedInput`，runtime 會被 Zod validation 拒絕。

## What Changes

即使 TypeScript type 標記為 optional，仍然始終傳入 `updatedInput` 欄位（傳入原始 toolInput）。

## Capabilities

- 確保 runtime 正確通過 Zod validation
- 避免因型別不一致導致的執行時錯誤

## Trade-offs

- 程式碼與 TypeScript type 看似不一致，但確保 runtime 正確
- 需要在 changelog/troubleshooting 記錄此陷阱
- 未來 SDK 版本可能修復此不一致
