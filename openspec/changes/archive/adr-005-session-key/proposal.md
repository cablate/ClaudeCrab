# Session Key 使用三段式雙冒號

## Why

多機器人架構下，需要唯一識別不同平台 + Agent + 用戶的組合。

## What Changes

使用 `${platform}::${agentId}::${userId}` 作為 session key。

## Capabilities

- 單冒號可能出現在 userId 中，雙冒號作為分隔符更安全
- 加入 `agentId` 確保同一用戶對不同 Agent 有獨立 Session
- DB UNIQUE 約束對應為 `UNIQUE(platform, agent_id, user_id)`

## Trade-offs

- session key 格式固定，未來若需調整需遷移既有資料
