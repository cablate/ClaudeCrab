# ADR-002: Agent Isolation - 使用 settingSources + systemPrompt

使用 `settingSources: ['project']` 搭配明確傳遞 `systemPrompt` 來實現 agent 設定隔離，同時保留 skills 載入能力。
