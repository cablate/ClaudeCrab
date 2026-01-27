# Changelog

All notable changes to ClaudeCab will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-01-26

### Added

#### SQLite Persistence
- SQLite persistence layer for sessions and conversations
- `DatabaseManager` for database connection and schema management
- `SessionRepository` for session CRUD operations
- `ConversationRepository` for conversation history management
- Automatic session restoration on restart
- Conversation history restoration
- WAL mode for better concurrent performance

#### Configuration
- `ENABLE_PERSISTENCE` environment variable to enable/disable persistence
- `DB_PATH` environment variable to configure database location

### Changed
- `SessionManager` now accepts optional `sessionRepository` for persistence
- `MessageProcessor` now accepts optional `conversationRepository` for persistence
- Test suite expanded from 257 to 323 tests

## [1.0.0] - 2026-01-26

### Added

#### Core Features
- Multi-agent support with dynamic switching via `/switch` command
- Session management with automatic timeout and cleanup
- Agent configuration via `agent.json` and `CLAUDE.md`
- Agent inheritance with `extends` field
- MCP server integration support

#### Telegram Integration
- Full Telegram bot integration using grammy
- Commands: `/start`, `/help`, `/list`, `/switch`, `/reset`
- Long message splitting (4096 character limit)
- Typing indicators during processing
- Rate limiting and request queuing

#### Security
- User whitelist via `ALLOWED_USERS` environment variable
- Message length validation
- Prompt injection detection with configurable patterns
- Sensitive command confirmation (e.g., `/reset`)
- Comprehensive audit logging

#### Developer Experience
- CLI testing tool (`npm run cli`)
- Comprehensive test suite (257 tests)
- TypeScript with strict mode
- ESLint + Prettier configuration
- Vitest for testing

#### Deployment
- Docker support with multi-stage builds
- docker-compose configuration
- Environment-based configuration
- Structured logging with pino

### Performance
- Agent loading: 10 agents < 1 second
- Session creation: < 200ms
- Memory usage: ~5KB per session
- Supports 1000+ concurrent sessions

## [0.6.0] - 2026-01-26

### Added
- User whitelist mechanism
- Audit logging module
- Prompt injection detection
- Sensitive command confirmation
- Security tests

## [0.5.0] - 2026-01-26

### Added
- TelegramAdapter with grammy integration
- BaseAdapter abstract class
- AdapterRegistry for managing adapters
- Telegram commands (/start, /help, /switch, /list, /reset)
- Message processor with streaming support
- Rate limiting and retry logic

## [0.4.0] - 2026-01-26

### Added
- SessionManager for multi-user session handling
- Session state machine (idle → processing → idle/error)
- Concurrent processing with mutex locks
- Message idempotency checking
- Automatic session cleanup

## [0.3.0] - 2026-01-26

### Added
- EventBus for decoupled communication
- AgentLoader with filesystem scanning
- ConfigTransformer for SDK integration
- Agent inheritance support
- Hooks loading (hooks.ts/hooks.js)
- MCP configuration loading

## [0.2.0] - 2026-01-26

### Added
- TypeScript type definitions
- Zod schema validation for agent configs
- Custom error classes
- Unified message types

## [0.1.0] - 2026-01-26

### Added
- Initial project setup
- ESM configuration
- TypeScript configuration
- ESLint + Prettier setup
- Basic logging with pino
- Project structure
