# ADR-016: PathValidator 路徑權限強制執行

在 MessageProcessor 內建 PathValidator，透過 PreToolUse hook 自動對所有 agent 強制執行路徑權限規則。
