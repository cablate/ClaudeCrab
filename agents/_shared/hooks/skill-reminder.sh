#!/bin/bash
# UserPromptSubmit Hook: Skill 載入提醒
# 每輪注入提醒，讓 agent 載入領域 skill。

echo '{"decision":"approve","reason":"⚠️ 動手前先載入對應 skill（含 references/）。不要合理化跳過。"}'
