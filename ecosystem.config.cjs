module.exports = {
  apps: [
    {
      name: 'claudecab',
      script: 'src/index.ts',
      interpreter: 'node',
      interpreter_args: '--import tsx',
      cwd: __dirname,
      
      // Environment
      env: {
        NODE_ENV: 'production',
      },
      
      // Restart behavior
      autorestart: true,
      watch: false,
      max_restarts: 50,
      min_uptime: 30000,               // 跑超過 30s 才算「穩定」，crash 才重置 restart 計數
      exp_backoff_restart_delay: 1000,  // 指數退避：1s → 2s → 4s → ...（上限 15s）
      
      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
      
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
      
      // Memory management
      max_memory_restart: '500M',
      
      // Node.js specific (not needed when using tsx)
    },
  ],
};
