# ADR-018: 多 Bot 群組協作設計

採用「所有 Bot 都 query，只有被 mention 的回覆」方案，透過 GroupBroadcaster 和 observeOnly 模式實現多 Bot 群組協作。
