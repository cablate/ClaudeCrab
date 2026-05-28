' run-hidden.vbs
' Launched by Task Scheduler (task: ClaudeCab).
' Starts `npm run start` (which runs start.ts supervisor) in a hidden window,
' redirecting stdout/stderr to logs/supervisor-{out,error}.log.
' Wrapped in cmd /c so stream redirection works; VBS returns immediately and
' the supervisor process keeps running detached.

Option Explicit

Dim WshShell, projectDir, cmd
projectDir = "F:\_Program\OwnProject\ClaudeCab"

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = projectDir

cmd = "cmd /c npm run start 1>> """ & projectDir & "\logs\supervisor-out.log"" 2>> """ & projectDir & "\logs\supervisor-error.log"""

' 0 = hidden window, False = do not wait for completion
WshShell.Run cmd, 0, False
