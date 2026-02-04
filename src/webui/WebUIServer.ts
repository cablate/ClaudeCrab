import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import type { Server } from 'node:http';
import type { WebUIServerOptions, WebUIDependencies, WebUIRequest } from './types.js';
import { createRouter } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { MonitoringService } from './services/MonitoringService.js';
import { getEventBus } from '../core/EventBus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * WebUI Server - Express-based admin interface for ClaudeCab
 */
export class WebUIServer {
  private readonly app: Express;
  private readonly port: number;
  private server: Server | null = null;

  // Injected dependencies
  readonly dependencies: WebUIDependencies;

  constructor(options: WebUIServerOptions) {
    this.port = options.port;

    // Create MonitoringService
    const monitoringService = new MonitoringService({
      sessionManager: options.sessionManager,
      platformOrchestrator: options.platformOrchestrator,
      agentLoader: options.agentLoader,
    });

    // Setup event bus listeners for monitoring
    this.setupEventListeners(monitoringService);

    this.dependencies = {
      agentLoader: options.agentLoader,
      sessionManager: options.sessionManager,
      platformOrchestrator: options.platformOrchestrator,
      databaseManager: options.databaseManager,
      sessionRepository: options.sessionRepository,
      conversationRepository: options.conversationRepository,
      scheduleManager: options.scheduleManager,
      monitoringService,
      queryMetricsRepository: options.queryMetricsRepository,
    };

    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * Setup EventBus listeners for monitoring
   */
  private setupEventListeners(monitoringService: MonitoringService): void {
    const eventBus = getEventBus();

    eventBus.on('session:created', (session) => {
      monitoringService.recordEvent(
        'session:created',
        `Session created: ${session.platform}:${session.userId}:${session.agentId}`
      );
    });

    eventBus.on('session:closed', (payload) => {
      monitoringService.recordEvent(
        'session:closed',
        `Session closed: ${payload.sessionId} (${payload.reason})`
      );
    });

    eventBus.on('session:stateChanged', (payload) => {
      monitoringService.recordEvent(
        'session:stateChanged',
        `Session ${payload.sessionId}: ${payload.previousState} → ${payload.newState}`
      );
    });

    eventBus.on('message:sent', (payload) => {
      monitoringService.recordEvent(
        'message:sent',
        `Message sent to ${payload.platform}:${payload.userId}`
      );
    });

    eventBus.on('agent:reloaded', (agent) => {
      monitoringService.recordEvent(
        'agent:reloaded',
        `Agent reloaded: ${agent.id}`
      );
    });

    eventBus.on('error', (error) => {
      monitoringService.recordEvent(
        'error',
        `Error: ${error.message}`
      );
    });
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // Parse request bodies
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(cookieParser());

    // Static files
    const publicPath = path.join(__dirname, '../../public');
    this.app.use('/static', express.static(publicPath));

    // EJS template engine
    this.app.set('view engine', 'ejs');
    this.app.set('views', path.join(__dirname, 'views'));

    // Inject dependencies into request
    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as WebUIRequest).dependencies = this.dependencies;
      next();
    });

    // Add common locals for templates
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      res.locals.currentPath = req.path;
      res.locals.query = req.query;
      next();
    });
  }

  /**
   * Setup routes
   */
  private setupRoutes(): void {
    const router = createRouter();
    this.app.use('/', router);
  }

  /**
   * Setup error handling
   */
  private setupErrorHandling(): void {
    // 404 handler
    this.app.use((_req: Request, res: Response) => {
      res.status(404).render('errors/404', {
        title: 'Not Found',
        layout: 'layouts/main',
      });
    });

    // Global error handler
    this.app.use(errorHandler);
  }

  /**
   * Start the WebUI server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          logger.info({ port: this.port }, 'WebUI server started');
          resolve();
        });

        this.server.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') {
            logger.error({ port: this.port }, 'WebUI port already in use');
          }
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the WebUI server
   */
  async stop(): Promise<void> {
    if (this.server === null) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          logger.error({ error }, 'Error stopping WebUI server');
          reject(error);
          return;
        }
        logger.info('WebUI server stopped');
        this.server = null;
        resolve();
      });
    });
  }

  /**
   * Get the Express app instance (for testing)
   */
  getApp(): Express {
    return this.app;
  }
}
