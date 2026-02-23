# Hot Add Agent 實作計畫

## 目標

讓系統能在不重啟的情況下載入新增的 agent，參考 Schedule 系統的 hot reload 架構。

---

## 現有架構分析

### Schedule 系統 Hot Reload 模式（參考）

```
message:sent event
    ↓
EventBus.emit('message:sent', { agentId })
    ↓
ScheduleManager.syncSchedulesForAgent(agentId)
    ↓
Delta Sync: 比對 memory vs YAML
    ↓
新增/刪除/更新 cron jobs
```

**關鍵設計**：
- Event-driven（不用 file watcher）
- Delta-based sync（只處理差異）
- 單一 agent 粒度操作

### Agent 系統現有能力

| 函數 | 位置 | 功能 |
|------|------|------|
| `AgentLoader.loadAgent(id)` | AgentLoader.ts | 載入單一 agent config |
| `AgentLoader.reloadAgent(id)` | AgentLoader.ts | 重新載入（清 cache） |
| `PlatformOrchestrator.startBotForAgent(id)` | PlatformOrchestrator.ts | 啟動 agent 的 adapters |
| `PlatformOrchestrator.stopBotForAgent(id)` | PlatformOrchestrator.ts | 停止 agent 的 adapters |
| `PlatformOrchestrator.reloadAgent(id)` | PlatformOrchestrator.ts | stop → reload → start |

**結論**：單一 agent 的載入/啟動已有完整支援，缺的是「發現新 agent」的機制。

---

## 實作方案

### 方案選擇：Event-Driven（參考 Schedule 系統）

不使用 file watcher，而是透過指令觸發：
- `/reload-agents` 指令（類似 Schedule 的 message:sent 觸發）
- 或整合進現有 `/restart` 指令的變體

### 核心函數：`syncAgents()`

位置：整合進 `PlatformOrchestrator.ts`

```typescript
async function syncAgents(): Promise<SyncResult> {
  // 1. 掃描 agents/ 目錄取得所有 agentId
  const diskAgentIds = await scanAgentDirectories();

  // 2. 取得目前記憶體中已載入的 agentId
  const memoryAgentIds = getLoadedAgentIds();

  // 3. Delta 計算
  const toAdd = diskAgentIds.filter(id => !memoryAgentIds.includes(id));
  const toRemove = memoryAgentIds.filter(id => !diskAgentIds.includes(id));

  // 4. 執行同步
  for (const id of toAdd) {
    await loadAndStartAgent(id);
  }
  for (const id of toRemove) {
    await stopAndUnloadAgent(id);
  }

  return { added: toAdd, removed: toRemove };
}
```

---

## 實作步驟

### Step 1: 建立 Agent 目錄掃描函數

**檔案**：`src/core/AgentLoader.ts`

```typescript
export async function scanAgentDirectories(): Promise<string[]> {
  const agentsDir = path.join(process.cwd(), 'agents');
  const entries = await fs.readdir(agentsDir, { withFileTypes: true });

  return entries
    .filter(entry => entry.isDirectory())
    .filter(entry => !entry.name.startsWith('_')) // 排除 _shared 等
    .map(entry => entry.name);
}
```

### Step 2: 取得已載入 Agent 清單

**檔案**：`src/core/PlatformOrchestrator.ts`

已有 `getRunningAdapters()` 方法，只需新增 helper：

```typescript
public getLoadedAgentIds(): string[] {
  const adapters = this.getRunningAdapters();
  // 取得唯一的 agentIds（一個 agent 可能有多個 platform adapters）
  return [...new Set(adapters.map(a => a.agentId))];
}
```

無需維護額外的 Set，直接從 registry 推導。

### Step 3: 實作 syncAgents()

**檔案**：`src/core/PlatformOrchestrator.ts`

```typescript
public async syncAgents(): Promise<{ added: string[]; removed: string[] }> {
  const diskIds = await AgentLoader.scanAgentDirectories();
  const memoryIds = this.getLoadedAgentIds();

  const toAdd = diskIds.filter(id => !memoryIds.includes(id));
  const toRemove = memoryIds.filter(id => !diskIds.includes(id));

  for (const id of toAdd) {
    logger.info(`[Hot Add] Loading new agent: ${id}`);
    await this.startBotForAgent(id);
  }

  for (const id of toRemove) {
    logger.info(`[Hot Remove] Stopping agent: ${id}`);
    await this.stopBotForAgent(id);
  }

  return { added: toAdd, removed: toRemove };
}
```

### Step 4: 新增 /sync-agents 指令

**建議**：整合進 `/restart` 指令
- `/restart` = 重啟當前 agent（現有功能）
- `/restart all` = 同步所有 agents（新功能）

**檔案**：修改 `src/commands/restart.ts`

### Step 5: 權限控管

- 只有 adminIds 可以執行
- 現有 `/restart` 已有權限檢查，沿用即可

---

## 檔案變更清單

| 檔案 | 變更類型 | 說明 |
|------|----------|------|
| `src/core/AgentLoader.ts` | 修改 | 新增 `scanAgentDirectories()` |
| `src/core/PlatformOrchestrator.ts` | 修改 | 新增 `getLoadedAgentIds()`, `syncAgents()` |
| `src/commands/restart.ts` | 修改 | 新增 `all` 參數處理 |

---

## 測試計畫

1. **新增 Agent 測試**
   - 在 `agents/` 下新增一個 test-agent 目錄（含 agent.yaml）
   - 執行 `/restart all`
   - 驗證 test-agent 開始運作（可發訊息給它）

2. **移除 Agent 測試**
   - 重命名 test-agent 目錄為 `_test-agent`（以 _ 開頭會被忽略）
   - 執行 `/restart all`
   - 驗證 test-agent 停止運作

3. **無變更測試**
   - 不做任何變更，執行 `/restart all`
   - 驗證系統正常，沒有重複載入

---

## 驗證方式

1. 新增測試 agent 目錄 `agents/test-hot/`，包含基本 `agent.yaml`
2. 執行 `/restart all`
3. 檢查 PM2 logs 確認 `[Hot Add] Loading new agent: test-hot`
4. 嘗試發訊息給 test-hot agent（如果有設定 Telegram token）
5. 重命名為 `agents/_test-hot/`
6. 再次執行 `/restart all`
7. 檢查 logs 確認 `[Hot Remove] Stopping agent: test-hot`
