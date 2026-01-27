import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger.js';

/**
 * Custom error class for WebUI errors
 */
export class WebUIError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly isOperational: boolean = true
  ) {
    super(message);
    this.name = 'WebUIError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Not Found error
 */
export class NotFoundError extends WebUIError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404);
    this.name = 'NotFoundError';
  }
}

/**
 * Validation error
 */
export class ValidationError extends WebUIError {
  constructor(message: string) {
    super(message, 400);
    this.name = 'ValidationError';
  }
}

/**
 * Global error handler middleware
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log error
  logger.error(
    {
      error: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
    },
    'WebUI error'
  );

  // Determine status code
  let statusCode = 500;
  let message = 'Internal Server Error';
  let isOperational = false;

  if (err instanceof WebUIError) {
    statusCode = err.statusCode;
    message = err.message;
    isOperational = err.isOperational;
  }

  // API request - return JSON
  if (req.accepts('json') && !req.accepts('html')) {
    res.status(statusCode).json({
      error: message,
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
    });
    return;
  }

  // HTML request - render error page
  res.status(statusCode).render('errors/error', {
    title: `Error ${statusCode}`,
    statusCode,
    message: isOperational ? message : 'Something went wrong',
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    layout: false, // Use simple layout for error pages
  });
}
