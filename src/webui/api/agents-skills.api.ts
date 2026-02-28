import { Router } from 'express';
import type { Request, Response } from 'express';
import type { WebUIRequest, WebUIDependencies, SkillInfo } from '../types.js';

/** Params inherited from parent router via mergeParams */
interface AgentParams {
  id: string;
  [key: string]: string;
}

/** Params for skill-specific routes */
interface SkillParams extends AgentParams {
  name: string;
}
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import AdmZip from 'adm-zip';
import os from 'node:os';
import { parse as parseYaml } from 'yaml';

/** Maximum upload file size for skill zip imports (10 MB) */
const UPLOAD_MAX_FILE_SIZE = 10 * 1024 * 1024;

// Configure multer for zip file uploads
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: UPLOAD_MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only .zip files are allowed'));
    }
  },
});

/**
 * Helper to get dependencies from request
 */
function getDeps(req: Request): WebUIDependencies {
  return (req as WebUIRequest).dependencies;
}

/**
 * Create agent skills sub-router
 * Mounted at /api/agents/:id/skills
 */
export function createAgentSkillsRouter(): Router {
  const router = Router({ mergeParams: true });

  /**
   * GET / - List installed skills
   */
  router.get('/', async (req: Request<AgentParams>, res: Response) => {
    const { agentLoader } = getDeps(req);
    const agent = agentLoader.get(req.params.id);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const skillsDir = path.join(agent.path, '.claude', 'skills');
    const skills: SkillInfo[] = [];

    try {
      const entries = await fs.readdir(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillPath = path.join(skillsDir, entry.name);
        const skillMdPath = path.join(skillPath, 'SKILL.md');

        try {
          const content = await fs.readFile(skillMdPath, 'utf-8');
          const stat = await fs.stat(skillMdPath);

          // Parse YAML frontmatter for name and description
          const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
          let name = entry.name;
          let description = '';

          if (frontmatterMatch?.[1]) {
            try {
              const frontmatter = parseYaml(frontmatterMatch[1]) as Record<string, unknown>;
              if (frontmatter.name && typeof frontmatter.name === 'string') {
                name = frontmatter.name.trim();
              }
              if (frontmatter.description && typeof frontmatter.description === 'string') {
                description = frontmatter.description.trim();
              }
            } catch {
              // YAML parse failed, fall back to directory name
            }
          }

          skills.push({
            name,
            description,
            path: entry.name,
            modified: stat.mtime.toISOString(),
          });
        } catch {
          // No SKILL.md in this directory, skip
        }
      }
    } catch {
      // Skills directory doesn't exist
    }

    res.json({ skills });
  });

  /**
   * POST / - Upload and install a skill (zip file)
   */
  router.post('/', upload.single('file'), async (req: Request<AgentParams>, res: Response) => {
    const { agentLoader } = getDeps(req);
    const id = req.params.id;
    const agent = agentLoader.get(id);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const skillsDir = path.join(agent.path, '.claude', 'skills');

    try {
      // Ensure skills directory exists
      await fs.mkdir(skillsDir, { recursive: true });

      // Extract zip
      const zip = new AdmZip(file.path);
      const zipEntries = zip.getEntries();

      // Find SKILL.md to determine skill structure
      let skillName: string | null = null;
      let hasSkillMd = false;

      for (const entry of zipEntries) {
        if (entry.entryName.endsWith('SKILL.md')) {
          hasSkillMd = true;
          // Determine skill folder name from path
          const parts = entry.entryName.split('/').filter(Boolean);
          if (parts.length >= 2 && parts[0]) {
            // e.g., "my-skill/SKILL.md" -> "my-skill"
            skillName = parts[0];
          } else if (parts.length === 1) {
            // SKILL.md is at root, use zip filename as skill name
            skillName = path.basename(file.originalname, '.zip');
          }
          break;
        }
      }

      if (!hasSkillMd) {
        await fs.unlink(file.path);
        res.status(400).json({ error: 'Invalid skill package: SKILL.md not found' });
        return;
      }

      if (!skillName) {
        skillName = path.basename(file.originalname, '.zip');
      }

      // Validate skill name
      if (!/^[a-z0-9-]+$/.test(skillName)) {
        await fs.unlink(file.path);
        res.status(400).json({ error: 'Invalid skill name. Use only lowercase letters, numbers, and hyphens.' });
        return;
      }

      const targetDir = path.join(skillsDir, skillName);

      // Check if skill already exists
      try {
        await fs.access(targetDir);
        await fs.unlink(file.path);
        res.status(409).json({ error: `Skill "${skillName}" already exists. Delete it first to reinstall.` });
        return;
      } catch {
        // Doesn't exist, good to proceed
      }

      // Extract to target directory
      // If zip has a root folder matching skillName, extract contents
      // Otherwise, create the folder and extract there
      const firstEntry = zipEntries[0];
      const hasRootFolder = firstEntry && firstEntry.isDirectory && firstEntry.entryName === `${skillName}/`;

      if (hasRootFolder) {
        // Extract and the folder structure is already correct
        zip.extractAllTo(skillsDir, true);
      } else {
        // Create skill folder and extract there
        await fs.mkdir(targetDir, { recursive: true });
        zip.extractAllTo(targetDir, true);
      }

      // Clean up temp file
      await fs.unlink(file.path);

      // Read the installed skill info
      const skillMdPath = path.join(targetDir, 'SKILL.md');
      const content = await fs.readFile(skillMdPath, 'utf-8');
      const stat = await fs.stat(skillMdPath);

      // Parse YAML frontmatter
      const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
      let name = skillName ?? '';
      let description = '';

      if (frontmatterMatch?.[1]) {
        const frontmatter = frontmatterMatch[1];
        const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
        const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
        if (nameMatch?.[1]) name = nameMatch[1].trim();
        if (descMatch?.[1]) description = descMatch[1].trim();
      }

      res.status(201).json({
        success: true,
        skill: {
          name,
          description,
          path: skillName ?? '',
          modified: stat.mtime.toISOString(),
        },
      });
    } catch (error) {
      // Clean up temp file on error
      try {
        await fs.unlink(file.path);
      } catch {
        // Ignore
      }
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /:name - Read a skill's SKILL.md
   */
  router.get('/:name', async (req: Request<SkillParams>, res: Response) => {
    const { agentLoader } = getDeps(req);
    const agent = agentLoader.get(req.params.id);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const { name } = req.params;
    const skillMdPath = path.join(agent.path, '.claude', 'skills', name, 'SKILL.md');

    // Security check
    const resolvedPath = path.resolve(skillMdPath);
    const agentDir = path.resolve(agent.path);
    if (!resolvedPath.startsWith(agentDir)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    try {
      const content = await fs.readFile(skillMdPath, 'utf-8');
      const stat = await fs.stat(skillMdPath);
      res.json({ name, content, modified: stat.mtime.toISOString() });
    } catch {
      res.status(404).json({ error: 'Skill not found' });
    }
  });

  /**
   * PUT /:name - Update a skill's SKILL.md
   */
  router.put('/:name', async (req: Request<SkillParams>, res: Response) => {
    const { agentLoader } = getDeps(req);
    const agent = agentLoader.get(req.params.id);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const { name } = req.params;
    const { content } = req.body as { content?: string };

    if (content === undefined) {
      res.status(400).json({ error: 'content required' });
      return;
    }

    const skillMdPath = path.join(agent.path, '.claude', 'skills', name, 'SKILL.md');

    // Security check
    const resolvedPath = path.resolve(skillMdPath);
    const agentDir = path.resolve(agent.path);
    if (!resolvedPath.startsWith(agentDir)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    try {
      // Check if skill exists
      await fs.access(skillMdPath);

      await fs.writeFile(skillMdPath, content, 'utf-8');
      const stat = await fs.stat(skillMdPath);

      // Parse updated frontmatter
      const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
      let skillName = name;
      let description = '';

      if (frontmatterMatch?.[1]) {
        const frontmatter = frontmatterMatch[1];
        const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
        const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
        if (nameMatch?.[1]) skillName = nameMatch[1].trim();
        if (descMatch?.[1]) description = descMatch[1].trim();
      }

      res.json({
        success: true,
        skill: {
          name: skillName,
          description,
          path: name,
          modified: stat.mtime.toISOString(),
        },
      });
    } catch {
      res.status(404).json({ error: 'Skill not found' });
    }
  });

  /**
   * DELETE /:name - Delete a skill
   */
  router.delete('/:name', async (req: Request<SkillParams>, res: Response) => {
    const { agentLoader } = getDeps(req);
    const agent = agentLoader.get(req.params.id);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const { name } = req.params;
    const skillDir = path.join(agent.path, '.claude', 'skills', name);

    // Security check
    const resolvedPath = path.resolve(skillDir);
    const agentDir = path.resolve(agent.path);
    if (!resolvedPath.startsWith(agentDir)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    try {
      // Check if skill exists
      await fs.access(skillDir);

      await fs.rm(skillDir, { recursive: true, force: true });
      res.json({ success: true, message: `Skill "${name}" deleted` });
    } catch {
      res.status(404).json({ error: 'Skill not found' });
    }
  });

  return router;
}
