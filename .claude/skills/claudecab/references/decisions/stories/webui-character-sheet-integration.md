# WebUI Character Sheet 整合

**類型**：功能故事  
**狀態**：📋 proposed  
**日期**：2026-02-08  
**相關 ADR**：ADR-031（資料配置策略）  
**前置條件**：Skill-Based Character System 已部署到至少一個 agent

---

## 目標

在 ClaudeCab Dashboard 中展示 Agent 的 RPG 風格角色面板，視覺化呈現 bot 的成長狀態、裝備、熟練度與成就。

---

## 使用者故事

**作為** ClaudeCab 使用者  
**我想要** 在 Dashboard 上看到每個 bot 的完整狀態面板  
**以便** 直觀了解 bot 的能力、成長進度和裝備情況

---

## 資料來源

所有資料從 agent 的 skills 目錄讀取：

| 資料項目 | 來源檔案 | 範例 |
|---------|---------|------|
| 角色名稱 | `persona/references/identity.md` | "大總管" |
| 裝備列表 | `system/equipment/references/loadout.md` | Skills + MCPs |
| 熟練度 | `system/proficiency/references/levels.md` | agent-browser ★★★☆☆ 127 次 |
| 已解鎖成就 | `system/achievements/references/unlocked.md` | 連續服務 7 天 |
| 進行中進度 | `system/achievements/references/progress.md` | 總對話 67/100 |
| 聚合統計 | `system/character-sheet/references/stats.md` | 活躍天數、對話次數 |

---

## UI 設計方向

### 方案 A：單頁面板（推薦）

**位置**：`/agents/:agentId/character`

**佈局**：

```
┌─────────────────────────────────────────┐
│  大總管 (General Assistant)              │
│  活躍 45 天 · 327 次對話                 │
├─────────────────────────────────────────┤
│  ⚔️ 裝備欄 (3)                           │
│  ┌────────────────────────────────────┐ │
│  │ agent-browser  ★★☆☆☆ 12次         │ │
│  │ find-skills    ★☆☆☆☆  5次         │ │
│  │ find-mcp       ★☆☆☆☆  3次         │ │
│  └────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│  🏆 成就 (1 解鎖 / 8 總計)               │
│  ✅ 連續服務 7 天                        │
│  🔒 總對話 100 次 (67/100) ▓▓▓░░        │
│  🔒 首個技能達到 ★★★☆☆                  │
├─────────────────────────────────────────┤
│  📊 記憶深度                             │
│  MEMORY.md: 2.3K tokens                 │
│  日誌: 12 天                             │
│  Pattern: 5 個                           │
└─────────────────────────────────────────┘
```

### 方案 B：Dashboard 首頁卡片

在現有 Dashboard 首頁新增 "Bot 狀態總覽" 區塊，顯示所有 bot 的精簡版角色卡片。

---

## 技術實作

### Phase 1：資料讀取層

**新增 API Endpoint**：

```typescript
// GET /api/agents/:agentId/character
{
  identity: { name, role },
  stats: { activeDays, conversations, memoryDepth },
  equipment: [{ name, type, proficiency }],
  achievements: {
    unlocked: [...],
    inProgress: [{ name, progress, total }]
  }
}
```

**實作**：

```typescript
// src/api/routes/agents/character.ts
import { readFile } from 'fs/promises';
import path from 'path';

async function getCharacterSheet(agentId: string) {
  const agentPath = path.join(process.cwd(), 'agents', agentId);
  
  // Read all sources
  const statsPath = path.join(agentPath, '.claude/skills/sys-character-sheet/references/stats.md');
  const proficiencyPath = path.join(agentPath, '.claude/skills/sys-proficiency/references/levels.md');
  const achievementsUnlockedPath = path.join(agentPath, '.claude/skills/sys-achievements/references/unlocked.md');
  const achievementsProgressPath = path.join(agentPath, '.claude/skills/sys-achievements/references/progress.md');
  
  // Parse markdown files and extract structured data
  const stats = await parseStatsMarkdown(await readFile(statsPath, 'utf-8'));
  const proficiency = await parseProficiencyMarkdown(await readFile(proficiencyPath, 'utf-8'));
  const achievementsUnlocked = await parseAchievementsMarkdown(await readFile(achievementsUnlockedPath, 'utf-8'));
  const achievementsProgress = await parseProgressMarkdown(await readFile(achievementsProgressPath, 'utf-8'));
  
  return {
    stats,
    equipment: proficiency,
    achievements: {
      unlocked: achievementsUnlocked,
      inProgress: achievementsProgress
    }
  };
}
```

**Markdown Parser**：

使用正則表達式解析 markdown，提取結構化資料：

```typescript
function parseProficiencyMarkdown(content: string) {
  const skillPattern = /### (.+?) (★+☆*) (\w+)\n- 使用次數：(\d+)/g;
  const skills = [];
  
  let match;
  while ((match = skillPattern.exec(content)) !== null) {
    skills.push({
      name: match[1],
      stars: match[2],
      level: match[3],
      uses: parseInt(match[4])
    });
  }
  
  return skills;
}
```

### Phase 2：前端元件

**新增頁面**：`src/web/pages/agents/[agentId]/character.tsx`

**使用 shadcn/ui 元件**：
- Card
- Progress
- Badge
- Tabs（如果有多個區塊）

**範例**：

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

export default function CharacterSheet({ agentId }: { agentId: string }) {
  const { data, isLoading } = useQuery(['character', agentId], () =>
    fetch(`/api/agents/${agentId}/character`).then(r => r.json())
  );

  if (isLoading) return <div>載入中...</div>;

  return (
    <div className="space-y-4">
      {/* 基礎資訊 */}
      <Card>
        <CardHeader>
          <CardTitle>{data.stats.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            活躍 {data.stats.activeDays} 天 · {data.stats.conversations} 次對話
          </div>
        </CardContent>
      </Card>

      {/* 裝備欄 */}
      <Card>
        <CardHeader>
          <CardTitle>⚔️ 裝備欄</CardTitle>
        </CardHeader>
        <CardContent>
          {data.equipment.map(skill => (
            <div key={skill.name} className="flex justify-between py-2">
              <span>{skill.name}</span>
              <Badge>{skill.stars} {skill.uses} 次</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 成就 */}
      <Card>
        <CardHeader>
          <CardTitle>🏆 成就</CardTitle>
        </CardHeader>
        <CardContent>
          {data.achievements.unlocked.map(ach => (
            <div key={ach.name}>✅ {ach.name}</div>
          ))}
          {data.achievements.inProgress.map(ach => (
            <div key={ach.name} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>🔒 {ach.name}</span>
                <span>{ach.progress}/{ach.total}</span>
              </div>
              <Progress value={(ach.progress / ach.total) * 100} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
```

### Phase 3：導航整合

在 Agent 詳情頁加入 "角色面板" 連結：

```tsx
// src/web/pages/agents/[agentId]/index.tsx
<Tabs defaultValue="info">
  <TabsList>
    <TabsTrigger value="info">基本資訊</TabsTrigger>
    <TabsTrigger value="settings">設定</TabsTrigger>
    <TabsTrigger value="character">角色面板</TabsTrigger> {/* 新增 */}
  </TabsList>
</Tabs>
```

---

## 驗收標準

- [ ] API `/api/agents/:agentId/character` 回傳正確的結構化資料
- [ ] Markdown parser 正確解析 proficiency、achievements 檔案
- [ ] Character Sheet 頁面正確顯示所有區塊（基礎資訊、裝備、成就）
- [ ] 星級（★☆☆☆☆）正確渲染
- [ ] 成就進度條正確顯示百分比
- [ ] 響應式設計（手機、平板、桌面）
- [ ] 如果 skill 檔案不存在，顯示友善錯誤訊息

---

## 效益

### 產品層面
- **可視化成長**：使用者看得見 bot 的進步
- **遊戲化體驗**：RPG 風格增加使用黏性
- **差異化特色**：競品沒有的「bot 養成」概念

### 技術層面
- **零侵入**：讀取現有檔案，不需修改 bot 邏輯
- **易維護**：資料由 bot 自行更新，WebUI 只負責展示
- **可擴展**：未來可加入熟練度曲線圖、成就時間軸等

---

## 風險與緩解

| 風險 | 影響 | 緩解措施 |
|------|------|---------|
| Markdown 格式不一致 | Parser 失敗 | 加入格式驗證 + fallback 處理 |
| 檔案不存在（舊 agent） | 404 錯誤 | 檢查檔案存在性，顯示「尚未啟用角色系統」 |
| 效能問題（多次讀檔） | 回應慢 | 加入快取機制（TTL 5 分鐘） |

---

## 未來擴展

### Phase 4+（選做）
- **熟練度趨勢圖**：顯示每個 skill 的使用次數變化
- **成就時間軸**：按時間排序展示已解鎖成就
- **比較模式**：對比多個 bot 的能力分佈
- **匯出功能**：匯出角色面板為圖片分享

---

## 參考

- [ADR-031: 資料配置策略](../adr/adr-031-data-placement-strategy.md)
- [Skill-Based Character System](../../system/skill-based-character-system.md)
