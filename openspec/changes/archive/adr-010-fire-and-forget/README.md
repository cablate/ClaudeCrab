# ADR-010: grammy message handler 必須 fire-and-forget

Message handler 改為 fire-and-forget（不 await processMessage），避免 grammy polling loop 被阻塞造成死鎖。
