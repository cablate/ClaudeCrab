/**
 * Claude Code JSONL project-hash.
 *
 * Computes the project-hash directory name that Claude Code uses for
 * ~/.claude/projects/<projectHash>/<session>.jsonl transcript paths.
 * Reverse-engineered from cli.js ID() + bmK().
 *
 * (The previous JSONL sanitizer logic — sanitizeBeforeResume / sanitizeJsonl /
 * getJsonlPath — was removed: it patched the C26 readFileState rebuild, but had
 * no runtime caller. External code uses SDKTranscriptDiagnostics.getJsonlPath.
 * See docs/SDK_TOUCHPOINTS.md SDK-020.)
 */

export function projectHash(cwd: string): string {
  const result = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  if (result.length <= 200) return result;

  // bmK hash: charCode loop → base36
  let h = 0;
  for (let i = 0; i < cwd.length; i++) {
    h = (h << 5) - h + cwd.charCodeAt(i);
    h |= 0; // 32-bit signed int
  }
  return result.slice(0, 200) + '-' + Math.abs(h).toString(36);
}
