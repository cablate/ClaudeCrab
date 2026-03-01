@echo off
:: ClaudeCab PM2 auto-start script
:: Registered in Windows Task Scheduler to run at system startup

:: Wait for network to be ready
timeout /t 20 /nobreak >nul

:: Start ClaudeCab via ecosystem config (idempotent — PM2 skips if already running)
cd /d F:\_Program\OwnProject\ClaudeCab
call pm2 start ecosystem.config.cjs

:: Log
echo [%date% %time%] PM2 auto-started >> logs\pm2-autostart.log
