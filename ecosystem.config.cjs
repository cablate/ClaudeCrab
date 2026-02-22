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
      max_restarts: 10,
      restart_delay: 1000,
      
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
