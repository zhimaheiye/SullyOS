import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, '../apps/CheckPhone.tsx'), 'utf8');

describe('查手机自定义 App 批量安装接线', () => {
    it('每次打开安装弹窗都会重新默认全选其他角色', () => {
        expect(source.match(/onClick=\{openCreateAppModal\}/g)).toHaveLength(2);
        expect(source.match(/setShowCreateModal\(true\)/g)).toHaveLength(1);
        expect(source).toContain('setSyncTargetIds(characters.filter(c => c.id !== targetChar.id).map(c => c.id))');
    });

    it('只向仍存在的目标角色追加具有独立 ID 的配置副本', () => {
        const handler = source.slice(
            source.indexOf('const handleCreateCustomApp = () =>'),
            source.indexOf('// --- Core Generation Logic ---'),
        );

        expect(handler).toContain('validCharacterIds.has(id)');
        expect(handler).toContain('targetIds.forEach((charId, index) =>');
        expect(handler).toContain('id: `app-${createdAt}-${index}-${Math.random().toString(36).slice(2, 8)}`');
        expect(handler).toContain('updateCharacter(charId, prev => ({');
        expect(handler).toContain('customApps: [...(prev.phoneState?.customApps || []), appCopy]');
        expect(handler).toContain('records: prev.phoneState?.records || []');
    });

    it('提供全选、逐角色选择、头像、滚动列表和动态安装数量', () => {
        expect(source).toContain('toggleSelectAllSyncTargets');
        expect(source).toContain('toggleSyncTarget(char.id)');
        expect(source).toContain('<TokenImg value={char.avatar}');
        expect(source).toContain('max-h-56 overflow-y-auto');
        expect(source).toContain("installCount > 1 ? `安装到 ${installCount} 台手机` : '安装到桌面'");
    });
});
