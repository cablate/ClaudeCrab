import { describe, expect, it } from 'vitest';
import { ADMIN_HTML } from '../src/admin/AdminHtml.ts';

describe('ADMIN_HTML', () => {
  it('contains the admin shell and parseable client script', () => {
    expect(ADMIN_HTML).toContain('ClaudeCab 後台');
    expect(ADMIN_HTML).toContain('全域部署設定');
    expect(ADMIN_HTML).toContain('儲存全域設定');
    expect(ADMIN_HTML).not.toContain('Save global config');
    expect(ADMIN_HTML).not.toContain("field.type === 'model'");

    const script = ADMIN_HTML.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(script).toBeDefined();
    expect(() => new Function(script ?? '')).not.toThrow();
  });
});
