# ClaudeCab

Multi-agent Telegram bot framework powered by Claude Agent SDK.

ClaudeCab provides a framework for building and deploying multiple AI agents through Telegram, with support for dynamic agent switching, session management, and security features.

## Features

- **Multi-Agent Support**: Define and switch between multiple AI agents
- **Session Management**: Automatic session handling with timeout and cleanup
- **Security**: User whitelist, message validation, prompt injection detection
- **Audit Logging**: Comprehensive logging for compliance and debugging
- **Hot Reload Ready**: Architecture supports agent configuration hot reload
- **Docker Support**: Production-ready Docker deployment

## Quick Start

### Prerequisites

- Node.js >= 20.0.0
- npm or yarn
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Anthropic API Key

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/claudecab.git
cd claudecab

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
```

### Configuration

Edit `.env` file with your credentials:

```env
# Required
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
ANTHROPIC_API_KEY=your_anthropic_api_key

# Optional - Security
ALLOWED_USERS=user_id_1,user_id_2
MAX_MESSAGE_LENGTH=10000
PROMPT_INJECTION_DETECTION=true

# Optional - Session
SESSION_TIMEOUT_MS=3600000
CLEANUP_INTERVAL_MS=60000
MAX_SESSIONS=1000
```

### Running

```bash
# Development mode (with hot reload)
npm run dev

# Build for production
npm run build

# Production mode
npm start

# CLI testing tool
npm run cli [agent-id]
```

## Creating Agents

Agents are defined in the `agents/` directory. Each agent is a subdirectory that follows Claude Code conventions:

```
agents/
├── general/              # Agent ID = "general"
│   ├── .git/             # Prevents Claude Code from loading parent configs
│   ├── .claude/
│   │   └── settings.json # Claude Code settings (permissions, features)
│   ├── agent.json        # ClaudeCab configuration (name, model)
│   └── CLAUDE.md         # System prompt (auto-loaded by Claude Code)
├── coder/
│   ├── .git/
│   ├── .claude/
│   │   └── settings.json
│   ├── agent.json
│   ├── CLAUDE.md
│   └── hooks.ts          # Optional: Custom hooks
└── custom-agent/
    ├── .git/
    ├── .claude/
    │   └── settings.json
    ├── agent.json
    ├── CLAUDE.md
    └── mcp.json          # Optional: MCP server config
```

> **Note**: Each agent directory is treated as an independent Claude Code project:
> - `.git/` prevents upward config traversal
> - `.claude/settings.json` configures permissions and features
> - `CLAUDE.md` is auto-loaded as the system prompt

### agent.json

```json
{
  "name": "General Assistant",
  "description": "A helpful general-purpose assistant",
  "model": "sonnet",
  "maxTokens": 4096,
  "settings": {
    "maxTurns": 10,
    "permissionMode": "default"
  }
}
```

### Configuration Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | (required) | Display name of the agent |
| `description` | string | - | Agent description |
| `model` | string | "sonnet" | Model: "sonnet", "haiku", or "opus" |
| `maxTokens` | number | 4096 | Max response tokens |
| `extends` | string | - | Parent agent ID for inheritance |
| `allowedTools` | string[] | - | Allowed MCP tools |
| `disallowedTools` | string[] | - | Blocked MCP tools |
| `mcpConfigFile` | string | "mcp.json" | MCP configuration file |

### .claude/settings.json

Each agent can have its own Claude Code settings (auto-loaded by SDK):

```json
{
  "model": "opus",
  "permissions": {
    "allow": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    "deny": []
  }
}
```

| Field | Description |
|-------|-------------|
| `model` | Model shorthand (`"sonnet"`, `"opus"`, `"haiku"`) or full ID |
| `permissions.allow` | Tools that are auto-allowed without prompting |
| `permissions.deny` | Tools that are blocked |

### Agent Inheritance

Agents can extend other agents (ClaudeCab feature):

```json
{
  "name": "Coding Expert",
  "extends": "general",
  "description": "Specialized coding assistant"
}
```

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Start conversation |
| `/help` | Show help message |
| `/list` | List available agents |
| `/switch <agent>` | Switch to a different agent |
| `/reset` | Reset conversation (requires confirmation) |

## CLI Testing Tool

Test agents interactively without Telegram:

```bash
# Test default agent
npm run cli

# Test specific agent
npm run cli coder

# With verbose logging
npm run cli -v coder
```

CLI commands:
- `/help` - Show commands
- `/list` - List agents
- `/switch <agent>` - Switch agent
- `/reset` - Clear conversation
- `/info` - Show current agent info
- `/exit` - Quit

## Security

### User Whitelist

Restrict access to specific Telegram user IDs:

```env
ALLOWED_USERS=123456789,987654321
```

Leave empty to allow all users (not recommended for production).

### Prompt Injection Detection

Automatically detects and warns about potential prompt injection attempts. Configure via:

```env
PROMPT_INJECTION_DETECTION=true
```

### Sensitive Command Confirmation

Commands like `/reset` require user confirmation before execution.

## Docker Deployment

### Using Docker

```bash
# Build image
docker build -t claudecab .

# Run container
docker run -d \
  --name claudecab \
  --env-file .env \
  -v $(pwd)/agents:/app/agents:ro \
  claudecab
```

### Using Docker Compose

```bash
# Start
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

## Project Structure

```
claudecab/
├── src/
│   ├── adapters/         # Platform adapters (Telegram, etc.)
│   ├── core/             # Core modules
│   │   ├── AgentLoader.ts
│   │   ├── SessionManager.ts
│   │   ├── MessageProcessor.ts
│   │   └── EventBus.ts
│   ├── types/            # TypeScript types
│   └── utils/            # Utilities (logger, security, etc.)
├── agents/               # Agent configurations
├── tests/                # Test files
├── docs/                 # Documentation
└── docker-compose.yml
```

## Development

```bash
# Run tests
npm test

# Run tests once
npm run test:run

# Type checking
npm run typecheck

# Linting
npm run lint
npm run lint:fix

# Formatting
npm run format
```

## Testing

```bash
# All tests
npm run test:run

# Unit tests only
npm run test:run -- tests/unit/

# Integration tests only
npm run test:run -- tests/integration/

# Specific test file
npm run test:run -- tests/unit/security.test.ts
```

## API Reference

See [docs/api.md](docs/api.md) for detailed API documentation.

## FAQ

### How do I get my Telegram user ID?

Send a message to [@userinfobot](https://t.me/userinfobot) on Telegram.

### Can I use multiple bots?

Yes, create multiple `.env` files and run separate instances.

### How do I add custom tools?

Configure MCP servers in the agent's `mcp.json` file.

### Why does the bot require confirmation for /reset?

This is a security feature to prevent accidental data loss.

### How much memory does ClaudeCab use?

Approximately 5KB per active session. 1000 sessions use about 5MB.

## License

MIT

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.
