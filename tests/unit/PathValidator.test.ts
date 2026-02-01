import { describe, it, expect, beforeEach } from 'vitest';
import { PathValidator } from '../../src/core/PathValidator.js';
import * as path from 'node:path';
import * as os from 'node:os';

describe('PathValidator', () => {
  let validator: PathValidator;
  const workspacePath = path.join(os.tmpdir(), 'agents', 'general');
  const sharedPath = path.join(os.tmpdir(), 'agents', '_shared');

  beforeEach(() => {
    validator = new PathValidator({
      agentId: 'general',
      workspacePath,
      sharedPath,
    });
  });

  describe('Own workspace access', () => {
    it('should allow Read in own workspace', () => {
      const result = validator.validate('Read', {
        file_path: path.join(workspacePath, 'CLAUDE.md'),
      });
      expect(result.allowed).toBe(true);
    });

    it('should allow Write in own workspace', () => {
      const result = validator.validate('Write', {
        file_path: path.join(workspacePath, 'memory', 'test.md'),
      });
      expect(result.allowed).toBe(true);
    });

    it('should allow Edit in own workspace', () => {
      const result = validator.validate('Edit', {
        file_path: path.join(workspacePath, 'ACTIVE.md'),
      });
      expect(result.allowed).toBe(true);
    });

    it('should allow Glob in own workspace', () => {
      const result = validator.validate('Glob', {
        path: workspacePath,
      });
      expect(result.allowed).toBe(true);
    });

    it('should allow Grep in own workspace', () => {
      const result = validator.validate('Grep', {
        path: path.join(workspacePath, 'memory'),
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('Shared area access', () => {
    it('should allow Read anywhere in shared area', () => {
      const result = validator.validate('Read', {
        file_path: path.join(sharedPath, 'knowledge', 'nitterbot', 'research.md'),
      });
      expect(result.allowed).toBe(true);
    });

    it('should allow Glob anywhere in shared area', () => {
      const result = validator.validate('Glob', {
        path: path.join(sharedPath, 'knowledge'),
      });
      expect(result.allowed).toBe(true);
    });

    it('should allow Grep anywhere in shared area', () => {
      const result = validator.validate('Grep', {
        path: path.join(sharedPath, 'knowledge', 'nitterbot'),
      });
      expect(result.allowed).toBe(true);
    });

    it('should allow Write to own namespace in shared area', () => {
      const result = validator.validate('Write', {
        file_path: path.join(sharedPath, 'knowledge', 'general', 'research.md'),
      });
      expect(result.allowed).toBe(true);
    });

    it('should allow Edit to own namespace in shared area', () => {
      const result = validator.validate('Edit', {
        file_path: path.join(sharedPath, 'knowledge', 'general', 'tools', 'report.md'),
      });
      expect(result.allowed).toBe(true);
    });

    it('should deny Write to other agent namespace in shared area', () => {
      const result = validator.validate('Write', {
        file_path: path.join(sharedPath, 'knowledge', 'nitterbot', 'research.md'),
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('禁止寫入其他 agent');
    });

    it('should deny Edit to other agent namespace in shared area', () => {
      const result = validator.validate('Edit', {
        file_path: path.join(sharedPath, 'knowledge', 'nitterbot', 'research.md'),
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('禁止寫入其他 agent');
    });
  });

  describe('Other paths (denied)', () => {
    it('should deny Read to other agent workspace', () => {
      const otherWorkspace = path.join(os.tmpdir(), 'agents', 'nitterbot');
      const result = validator.validate('Read', {
        file_path: path.join(otherWorkspace, 'CLAUDE.md'),
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('禁止存取工作區外');
    });

    it('should deny Write to other agent workspace', () => {
      const otherWorkspace = path.join(os.tmpdir(), 'agents', 'nitterbot');
      const result = validator.validate('Write', {
        file_path: path.join(otherWorkspace, 'test.md'),
      });
      expect(result.allowed).toBe(false);
    });

    it('should deny access to arbitrary paths', () => {
      const result = validator.validate('Read', {
        file_path: '/etc/passwd',
      });
      expect(result.allowed).toBe(false);
    });

    it('should deny access to parent directories', () => {
      const result = validator.validate('Read', {
        file_path: path.join(workspacePath, '..', 'nitterbot', 'CLAUDE.md'),
      });
      expect(result.allowed).toBe(false);
    });
  });

  describe('Tools without path parameters', () => {
    it('should allow tools without path parameters', () => {
      const result = validator.validate('SomeOtherTool', {
        query: 'test',
      });
      expect(result.allowed).toBe(true);
    });

    it('should allow when tool input is empty', () => {
      const result = validator.validate('Read', {});
      expect(result.allowed).toBe(true);
    });
  });

  describe('Relative paths', () => {
    it('should resolve relative paths from workspace', () => {
      // Relative path within workspace
      const result = validator.validate('Read', {
        file_path: './CLAUDE.md',
      });
      // This will be resolved relative to workspace, so it should be allowed
      expect(result.allowed).toBe(true);
    });

    it('should block relative path escape attempts', () => {
      const result = validator.validate('Read', {
        file_path: '../nitterbot/CLAUDE.md',
      });
      expect(result.allowed).toBe(false);
    });
  });
});
