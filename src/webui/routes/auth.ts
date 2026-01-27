import { Router } from 'express';
import { verifyPasswordAndGenerateToken, getTokenCookieOptions } from '../middleware/auth.js';

/**
 * Create auth router
 */
export function createAuthRouter(): Router {
  const router = Router();

  /**
   * GET /login - Show login page
   */
  router.get('/login', (_req, res) => {
    // Check if already authenticated
    const token = _req.cookies?.['webui_token'];
    if (token) {
      res.redirect('/dashboard');
      return;
    }

    res.render('auth/login', {
      title: 'Login',
      error: null,
      layout: false,
    });
  });

  /**
   * POST /login - Handle login
   */
  router.post('/login', (req, res) => {
    const { password } = req.body as { password?: string };

    if (!password) {
      res.status(400).render('auth/login', {
        title: 'Login',
        error: 'Password is required',
        layout: false,
      });
      return;
    }

    try {
      const token = verifyPasswordAndGenerateToken(password);

      if (token === null) {
        res.status(401).render('auth/login', {
          title: 'Login',
          error: 'Invalid password',
          layout: false,
        });
        return;
      }

      // Set cookie and redirect
      res.cookie('webui_token', token, getTokenCookieOptions());
      res.redirect('/dashboard');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      res.status(500).render('auth/login', {
        title: 'Login',
        error: message,
        layout: false,
      });
    }
  });

  /**
   * GET /logout - Handle logout
   */
  router.get('/logout', (_req, res) => {
    res.clearCookie('webui_token');
    res.redirect('/login');
  });

  return router;
}
