import { Router, type Request, type Response } from 'express';
import type { MessageProcessor } from '../../core/MessageProcessor.js';
import type { AgentLoader } from '../../core/AgentLoader.js';
import type { UnifiedMessage } from '../../adapters/types.js';
import { loadSecurityConfig } from '../../utils/security.js';
import { logger } from '../../utils/logger.js';

/**
 * Web UI message sending API — shares the same session as Telegram private chat.
 * Uses platform='telegram' + userId=ALLOWED_USERS[0] so session key is identical.
 */
export function createMessagesApiRouter(
  messageProcessor: MessageProcessor,
  agentLoader: AgentLoader,
): Router {
  const router = Router();

  // Resolve owner userId from ALLOWED_USERS (already configured for security whitelist)
  const securityConfig = loadSecurityConfig();
  const ownerUserId = securityConfig.allowedUsers[0];

  if (!ownerUserId) {
    logger.warn('ALLOWED_USERS not configured — Web UI message sending disabled');
  }

  router.post('/send', async (req: Request, res: Response) => {
    const { agentId, text } = req.body;

    if (!agentId || !text) {
      res.status(400).json({ error: 'Missing required fields: agentId, text' });
      return;
    }

    if (!ownerUserId) {
      res.status(500).json({ error: 'ALLOWED_USERS not configured' });
      return;
    }

    // Verify agent exists and is loaded
    const agent = agentLoader.get(agentId);
    if (!agent) {
      res.status(404).json({ error: `Agent '${agentId}' not found` });
      return;
    }

    // Build UnifiedMessage — identical to Telegram private chat message
    // This ensures the same session key: telegram::agentId::ownerUserId
    const message: UnifiedMessage = {
      id: `web-${Date.now()}`,
      platform: 'telegram',
      userId: ownerUserId,
      chatId: ownerUserId,
      text,
      timestamp: new Date(),
    };

    try {
      await messageProcessor.processMessage(message, agentId);
      res.json({ success: true });
    } catch (error) {
      logger.error({ error, agentId }, 'Failed to send message from web');
      res.status(500).json({ error: 'Failed to process message' });
    }
  });

  return router;
}
