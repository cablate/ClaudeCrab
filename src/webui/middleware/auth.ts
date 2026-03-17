/**
 * WebUI authentication middleware.
 *
 * Reads from environment variables directly (WEBUI_JWT_SECRET, WEBUI_PASSWORD,
 * WEBUI_SESSION_EXPIRE) rather than AppConfig because Express middleware is
 * registered at module load time, before AppConfig is passed in. These values
 * are also centrally documented in AppConfig.webui (src/config.ts) for
 * discoverability.
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { JWTPayload } from '../types.js';

/**
 * Get JWT secret from environment
 */
function getJWTSecret(): string {
  const secret = process.env.WEBUI_JWT_SECRET;
  if (!secret) {
    throw new Error(
      'WEBUI_JWT_SECRET environment variable is not set. ' +
      'Please set it in .env to a random string (e.g. openssl rand -hex 32).'
    );
  }
  return secret;
}

/**
 * Get token expiration time in seconds
 */
function getTokenExpiration(): number {
  const expireMs = parseInt(process.env.WEBUI_SESSION_EXPIRE ?? '86400000', 10);
  return Math.floor(expireMs / 1000);
}

/**
 * Authentication middleware
 * Verifies JWT token from cookie or Authorization header
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for login page and static files
  if (req.path === '/login' || req.path.startsWith('/static')) {
    next();
    return;
  }

  // Get token from cookie or Authorization header
  const token =
    req.cookies?.['webui_token'] ??
    req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    handleUnauthorized(req, res);
    return;
  }

  try {
    const secret = getJWTSecret();
    const decoded = jwt.verify(token, secret) as JWTPayload;

    if (!decoded.authenticated) {
      handleUnauthorized(req, res);
      return;
    }

    next();
  } catch {
    // Clear invalid cookie
    res.clearCookie('webui_token');
    handleUnauthorized(req, res);
  }
}

/**
 * Handle unauthorized access
 */
function handleUnauthorized(req: Request, res: Response): void {
  // HTML request - redirect to login
  if (req.accepts('html')) {
    res.redirect('/login');
    return;
  }

  // API request - return 401
  res.status(401).json({ error: 'Unauthorized' });
}

/**
 * Verify password and generate JWT token
 */
export function verifyPasswordAndGenerateToken(password: string): string | null {
  const correctPassword = process.env.WEBUI_PASSWORD;

  if (!correctPassword) {
    throw new Error('WEBUI_PASSWORD environment variable is not set');
  }

  if (password !== correctPassword) {
    return null;
  }

  const secret = getJWTSecret();
  const expiresIn = getTokenExpiration();

  const token = jwt.sign({ authenticated: true }, secret, { expiresIn });

  return token;
}

/**
 * Get cookie options for JWT token
 */
export function getTokenCookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  maxAge: number;
  sameSite: 'strict' | 'lax' | 'none';
} {
  const expireMs = parseInt(process.env.WEBUI_SESSION_EXPIRE ?? '86400000', 10);

  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: expireMs,
    sameSite: 'strict',
  };
}
