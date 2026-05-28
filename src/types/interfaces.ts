/**
 * Service interfaces for dependency inversion.
 * Core/schedule modules depend on these interfaces, not concrete service classes.
 *
 * This enables the services layer to remain platform-agnostic:
 * - Core modules import interfaces from types/
 * - Concrete implementations live in services/ (pure) and adapters/discord/services/ (Discord-specific)
 * - AppBootstrap wires concrete classes together
 */

import type { OperationalEvent } from './activity.js';

export interface IActivityEventService {
  log(event: OperationalEvent): Promise<void>;
  dispose(): Promise<void>;
}

