# ADR-016: PathValidator 路徑權限強制執行

**狀態**：✅ accepted  
**日期**：2026-02-02

## 背景

ADR-015 建立了共享知識區架構，定義了路徑權限規則：
- 自己的工作區：讀寫皆可
- `_shared/knowledge/`：所有 bot 可讀
- `_shared/knowledge/{自己}/`：可寫入

但這些規則只存在於 Agent 的 skill 文件中（safety.md），是「建議性」而非「強制性」的。Agent 可能因為不注意或被使用者誘導而違反規則。

## 問題

如何在程式層面強制執行路徑權限，而不增加 Agent 的維護負擔？

## 考慮的方案

### 方案 A：Agent hooks.ts

每個 agent 目錄放一個 `hooks.ts`，引用共享的 `PathValidator` 模組。

**優點**：
- 可客製化（agent 可調整規則）

**缺點**：
- 維護成本高
- agent 引用 src 的做法不乾淨
- 新增 agent 需要複製 hooks.ts

### 方案 B：程式內建（✅ 選擇）

在 `MessageProcessor` 直接注入 `PreToolUse` hook，使用 `PathValidator` 驗證路徑。

**優點**：
- 零維護成本 - Agent 不需要寫任何 hook 程式碼
- 自動套用 - 所有 agent 自動受到保護
- 一致性 - 所有 agent 適用相同規則

**缺點**：
- 無法客製化（可透過 settings.json 解決，但目前不需要）

## 決策

選擇 **方案 B：程式內建路徑驗證**

### 實現

1. **PathValidator 類別** (`src/core/PathValidator.ts`)
   - 接收 `agentId`, `workspacePath`, `sharedPath`
   - `validate(toolName, toolInput)` 檢查路徑是否允許
   - 處理相對路徑、符號連結

2. **MessageProcessor 整合**
   - 在 `additionalOptions.hooks.PreToolUse` 注入驗證 hook
   - 違規時回傳 `permissionDecision: 'deny'`

### 攔截的工具

| 工具 | 路徑參數 | 操作類型 |
|------|----------|----------|
| Read | `file_path` | 讀取 |
| Write | `file_path` | 寫入 |
| Edit | `file_path` | 寫入 |
| Glob | `path` | 讀取 |
| Grep | `path` | 讀取 |

**Bash 暫不處理**：命令解析複雜，且通常需要權限審批。

### 權限矩陣

| 路徑 | 讀取 | 寫入 |
|------|------|------|
| `agents/{自己}/` | ✅ | ✅ |
| `agents/_shared/knowledge/` | ✅ | ❌ |
| `agents/_shared/knowledge/{自己}/` | ✅ | ✅ |
| `agents/{其他}/` | ❌ | ❌ |
| 其他路徑 | ❌ | ❌ |

## 後果

**正面**：
- Agent 工作區隔離從「建議」變成「強制」
- 新增 agent 自動受到保護，無需任何配置

**負面**：
- 無法客製化（目前不是問題）

## 未來擴展

若需要客製化，可透過 `settings.json` 開放：

```json
{
  "pathPermissions": {
    "additionalReadPaths": ["../some-external/"],
    "additionalWritePaths": []
  }
}
```

目前不實作，保持簡單。
