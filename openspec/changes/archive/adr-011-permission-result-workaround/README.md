# ADR-011: SDK PermissionResult Zod schema vs TypeScript types 不一致

針對 SDK 的 `PermissionResult` 型別中 `updatedInput` 欄位 TypeScript type 與 Zod schema 不一致的問題，採用始終傳入該欄位的 workaround。
