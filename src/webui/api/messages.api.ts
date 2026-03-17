import { Router, type Request, type Response } from 'express';
import type { MessageProcessor } from '../../core/MessageProcessor.js';
import type { AgentLoader } from '../../core/AgentLoader.js';
import type { UnifiedMessage } from '../../adapters/types.js';
import { InteractionHandler } from '../../core/InteractionHandler.js';
import { loadSecurityConfig } from '../../utils/security.js';
import { logger } from '../../utils/logger.js';

/**
 * Web UI message sending API — shares the same session as the specified platform's private chat.
 * Default: platform='telegram' + userId=ALLOWED_USERS[0] so session key is identical to Telegram.
 * Accepts optional `platform` parameter in request body to route to Discord or other adapters.
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
    const { agentId, text, platform: requestPlatform } = req.body;

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

    // Build UnifiedMessage — defaults to Telegram private chat session key
    // When platform is specified, routes to that platform's adapter
    const platform = typeof requestPlatform === 'string' ? requestPlatform : 'telegram';
    const message: UnifiedMessage = {
      id: `web-${Date.now()}`,
      platform,
      userId: ownerUserId,
      chatId: ownerUserId,
      text,
      timestamp: new Date(),
    };

    // Fire-and-forget: respond immediately, let SSE push results
    messageProcessor.processMessage(message, agentId).catch((error) => {
      logger.error({ error, agentId }, 'Failed to process message from web');
    });
    res.json({ success: true });
  });

  /**
   * POST /chat — Synchronous: await AI response and return message directly.
   * Body: { agentId: string, text: string }
   * Response: { message: string }
   */
  router.post('/chat', async (req: Request, res: Response) => {
    const { agentId, text, platform: requestPlatform } = req.body;

    if (!agentId || !text) {
      res.status(400).json({ error: 'Missing required fields: agentId, text' });
      return;
    }

    if (!ownerUserId) {
      res.status(500).json({ error: 'ALLOWED_USERS not configured' });
      return;
    }

    const agent = agentLoader.get(agentId);
    if (!agent) {
      res.status(404).json({ error: `Agent '${agentId}' not found` });
      return;
    }

    const platform = typeof requestPlatform === 'string' ? requestPlatform : 'telegram';
    const message: UnifiedMessage = {
      id: `api-${Date.now()}`,
      platform,
      userId: ownerUserId,
      chatId: ownerUserId,
      text,
      timestamp: new Date(),
    };

    try {
      const result = await messageProcessor.processMessage(message, agentId);
      const response = typeof result === 'string' ? result : (result.response ?? '');
      res.json({ message: response });
    } catch (error) {
      logger.error({ error, agentId }, 'Failed to process chat message');
      const msg = error instanceof Error ? error.message : 'Internal error';
      res.status(500).json({ error: msg });
    }
  });

  // --- Resolve interactive hooks from Web UI ---

  router.post('/resolve-permission', (req: Request, res: Response) => {
    const { requestId, decision } = req.body as { requestId?: string; decision?: string };

    if (!requestId || !decision) {
      res.status(400).json({ error: 'Missing requestId or decision' });
      return;
    }

    const bridge = InteractionHandler.permissionRegistry.get(requestId);
    if (!bridge) {
      res.status(404).json({ error: 'Permission request not found or already resolved' });
      return;
    }

    if (decision === 'always') {
      bridge.resolvePermission(requestId, { behavior: 'allow', alwaysAllow: true });
    } else if (decision === 'allow') {
      bridge.resolvePermission(requestId, { behavior: 'allow' });
    } else {
      bridge.resolvePermission(requestId, { behavior: 'deny', message: 'Denied from Web UI' });
    }

    res.json({ success: true });
  });

  router.post('/resolve-question', (req: Request, res: Response) => {
    const { requestId, answer } = req.body as { requestId?: string; answer?: string | null };

    if (!requestId) {
      res.status(400).json({ error: 'Missing requestId' });
      return;
    }

    const bridge = InteractionHandler.questionRegistry.get(requestId);
    if (!bridge) {
      res.status(404).json({ error: 'Question request not found or already resolved' });
      return;
    }

    if (answer === null || answer === undefined) {
      bridge.resolveQuestion(requestId, { answer: null });
    } else {
      bridge.resolveQuestion(requestId, { answer });
    }

    res.json({ success: true });
  });

  router.post('/resolve-plan', (req: Request, res: Response) => {
    const { requestId, decision } = req.body as { requestId?: string; decision?: string };

    if (!requestId || !decision) {
      res.status(400).json({ error: 'Missing requestId or decision' });
      return;
    }

    const bridge = InteractionHandler.exitPlanModeRegistry.get(requestId);
    if (!bridge) {
      res.status(404).json({ error: 'Plan review request not found or already resolved' });
      return;
    }

    bridge.resolveReview(requestId, {
      approved: decision === 'approve',
      ...(decision !== 'approve' ? { message: 'Rejected from Web UI' } : {}),
    });

    res.json({ success: true });
  });

  return router;
}
