/**
 * WebUI Module - Entry point
 *
 * Exports the WebUI server and related utilities
 */

export { WebUIServer } from './WebUIServer.js';
export type { WebUIServerOptions, WebUIDependencies, WebUIRequest } from './types.js';
export { authMiddleware, verifyPasswordAndGenerateToken } from './middleware/auth.js';
export { WebUIError, NotFoundError, ValidationError } from './middleware/errorHandler.js';
export { StatsService } from './services/StatsService.js';
