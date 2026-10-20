import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = (relative: string) => readFileSync(path.resolve(__dirname, '..', relative), 'utf8');

describe('Healing App 接线与 v0.1 边界', () => {
  it('桌面、懒加载、渲染、预热与安全区均已注册', () => {
    expect(source('types.ts')).toContain("Healing = 'healing'");
    expect(source('constants.tsx')).toContain("id: AppID.Healing, name: '聊愈'");
    const shell = source('components/PhoneShell.tsx');
    expect(shell).toContain("import('../apps/HealingApp')");
    expect(shell).toContain('case AppID.Healing: return <HealingApp />');
    expect(shell).toContain('[AppID.Healing]: HealingApp');
    expect(shell).toMatch(/APP_IDLE_PRELOAD_ORDER[\s\S]*HealingApp/);
    expect(source('utils/safeAreaApps.ts')).toContain('AppID.Healing');
  });

  it('图片复用压缩、BlobRef 与 MessageItem，工具占位不含 API 调用', () => {
    const app = source('apps/HealingApp.tsx');
    const chat = source('components/healing/HealingChat.tsx');
    const tools = source('components/healing/HealingToolMenu.tsx');
    expect(app).toContain('processImageToBlob');
    expect(app).toContain('putImageBlob');
    expect(chat).toContain("from '../chat/MessageItem'");
    expect(chat).toContain('useBlobRefUrl');
    expect(tools).toContain("onPlaceholder('读心卡')");
    expect(tools).toContain("onPlaceholder('星语图')");
    expect(tools).not.toMatch(/safeFetch|fetch\(|chat\/completions/);
  });

  it('没有语音、Live2D、VRM、STT 或 TTS 接线', () => {
    const healingSources = [
      source('apps/HealingApp.tsx'), source('components/healing/HealingChat.tsx'),
      source('utils/healing/chatService.ts'), source('utils/healing/portrait.ts'),
    ].join('\n');
    expect(healingSources).not.toMatch(/from\s+['"][^'"]*(live2d|vrm|speech|fishaudio|tts)|speech-recognition|chatTts|voiceCall/i);
  });

  it('v2 分片备份登记四张表，并给聊愈向量走独立二进制旁路', () => {
    const context = source('context/OSContext.tsx');
    expect(context).toContain("'healing_sessions', 'healing_messages', 'healing_memory_nodes', 'healing_memory_vectors'");
    expect(context).toContain("case 'healing_messages': backupData.healingMessages = processedData");
    expect(context).toContain('healingVectors: healingVectorPayload');
    const format = source('utils/backupFormat.ts');
    expect(format).toContain("stores/healing_memory_vectors.bin");
    expect(format).toContain('data.healingMemoryVectors = index.map');
  });
});
