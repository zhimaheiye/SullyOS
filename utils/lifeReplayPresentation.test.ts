// @vitest-environment jsdom
import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, LifeReplaySession, LifeReplayTurn } from '../types';
import { emptyLifeReplayBlueprint } from './lifeReplay';
import { lifeReplayPassages, lifeReplayPortrait } from './lifeReplayPresentation';
import { LifeReplayScene } from '../components/lifeReplay/LifeReplayScene';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const char = { id: 'c1', name: '同行者', avatar: 'avatar.png', sprites: { normal: 'default.png' },
  dateSkinSets: [{ id: 'skin', name: '常服', sprites: { normal: 'skin.png' } }], activeSkinSetId: 'skin' } as unknown as CharacterProfile;
const turn: LifeReplayTurn = {
  id: 'opening', kind: 'opening', userAction: '', createdAt: 1,
  character: { perception: '她只在心里认出了我', action: '向门边走去', speech: '我在这里。' },
  world: { narrative: '教室安静下来。', pastSelfReaction: '过去的我抬起头', pastSelfSpeech: '你是谁？',
    npcBeats: [{ npcId: 'teacher', name: '班主任', action: '放下粉笔', speech: '请坐。' }], directionChange: '气氛缓和', sceneState: '教室',
    suggestedActions: ['走到过去的我身边', '问问班主任发生了什么', '暂时留在门边观察'] },
};
const makeSession = (overrides: Partial<LifeReplaySession> = {}): LifeReplaySession => ({
  id: 'session', kind: 'session', presetId: 'preset', presetTitle: '教室里的那天', charId: 'c1', status: 'active',
  blueprint: { ...emptyLifeReplayBlueprint(), title: '教室里的那天', openingScene: '我们抵达教室门口。', pastSelf: { ...emptyLifeReplayBlueprint().pastSelf, label: '过去的我' } },
  turns: [turn], sceneState: '教室', createdAt: 1, updatedAt: 1, ...overrides,
});
let host: HTMLDivElement;
let root: Root;
let session: LifeReplaySession;
let submit: ReturnType<typeof vi.fn>;
let complete: ReturnType<typeof vi.fn>;
const render = async (props: Record<string, unknown> = {}) => {
  await act(async () => root.render(React.createElement(LifeReplayScene, {
    session, char, userName: '现在的我', busy: false, busyLabel: '', error: '', onSubmit: submit, onComplete: complete, ...props,
  })));
};
const click = async (element: Element | null) => { expect(element).not.toBeNull(); await act(async () => (element as HTMLElement).click()); };
const byText = (text: string) => [...host.querySelectorAll('button')].find(button => button.textContent?.includes(text)) || null;
const goToEnd = async () => { for (let i = 0; i < 20 && !host.querySelector('[data-testid="replay-choices"]'); i++) await click(byText('继续 ›')); };
const setAction = async (value: string) => {
  const input = host.querySelector('[data-testid="replay-action-editor"] textarea') as HTMLTextAreaElement;
  await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!; setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
};
beforeEach(() => {
  localStorage.clear(); session = makeSession(); submit = vi.fn().mockResolvedValue(undefined); complete = vi.fn().mockResolvedValue(undefined);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('life replay reading projection', () => {
  it('keeps every saved speaker distinct and private perception explicit', () => {
    const passages = lifeReplayPassages(makeSession({ turns: [{ ...turn, kind: 'interaction', userAction: '我向前一步' }] }), char.name, '现在的我');
    expect(passages.map(item => [item.label, item.text])).toEqual(expect.arrayContaining([
      ['现在的我', '我向前一步'], ['旁白', '教室安静下来。'], ['同行者说', '“我在这里。”'],
      ['过去的我说', '“你是谁？”'], ['班主任说', '“请坐。”'], ['同行者的未说出口的感受', '她只在心里认出了我'],
    ]));
    expect(passages.every(item => item.turnId === 'opening')).toBe(true);
  });
  it('prefers the active meeting skin, then default sprite, then avatar', () => {
    expect(lifeReplayPortrait(char).value).toBe('skin.png');
    expect(lifeReplayPortrait({ ...char, activeSkinSetId: 'missing' }).value).toBe('default.png');
    expect(lifeReplayPortrait({ ...char, sprites: {}, dateSkinSets: [] })).toEqual({ value: 'avatar.png', isAvatar: true });
  });
  it('switches modes without changing the session or submitting; long reader includes every passage', async () => {
    await render();
    await click(byText('小说长篇'));
    expect(host.querySelector('[data-testid="replay-novel-scroll"]')).not.toBeNull();
    expect(host.textContent).toContain('教室安静下来');
    expect(host.textContent).toContain('班主任');
    await click(byText('见面立绘'));
    expect(host.querySelector('.replay-sprite-image')?.getAttribute('src')).toBe('skin.png');
    expect(submit).not.toHaveBeenCalled();
    expect(session.turns).toHaveLength(1);
  });
  it('fills and replaces the draft without submitting, then sends only the edited text once', async () => {
    let finish!: () => void;
    submit.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    await render();
    await goToEnd();
    expect(submit).not.toHaveBeenCalled();
    const choices = host.querySelectorAll('[data-testid="replay-choice"]');
    expect(choices).toHaveLength(3);
    expect([...choices].map(choice => choice.textContent)).toEqual(turn.world.suggestedActions);
    await click(choices[0]);
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe(turn.world.suggestedActions[0]);
    expect(submit).not.toHaveBeenCalled();
    expect(session.turns).toHaveLength(1);
    await click(host.querySelectorAll('[data-testid="replay-choice"]')[1]);
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe(turn.world.suggestedActions[1]);
    expect(document.activeElement).toBe(host.querySelector('textarea'));
    await setAction('  我先问清楚发生了什么  ');
    await click(byText('小说长篇'));
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('  我先问清楚发生了什么  ');
    await click(byText('见面立绘'));
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('  我先问清楚发生了什么  ');
    expect(submit).not.toHaveBeenCalled();
    const send = byText('发送行动')!;
    await act(async () => { send.click(); send.click(); });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith('我先问清楚发生了什么');
    expect(host.textContent).toContain('正在推进下一幕');
    await act(async () => finish());
  });
  it.each(['小说长篇', '见面立绘'])('%s also treats suggestions as editable draft only', async mode => {
    await render(); await click(byText(mode));
    if (mode === '见面立绘') await goToEnd();
    await click(host.querySelector('[data-testid="replay-choice"]'));
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe(turn.world.suggestedActions[0]);
    expect(submit).not.toHaveBeenCalled();
    expect(session.turns).toHaveLength(1);
    await click(byText('取消编辑'));
    expect(submit).not.toHaveBeenCalled();
  });
  it('canceling editing does not send; failure retains the edited draft and original node', async () => {
    submit.mockRejectedValueOnce(new Error('失败'));
    await render(); await goToEnd(); await click(host.querySelector('[data-testid="replay-choice"]'));
    await click(byText('取消编辑'));
    expect(submit).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="replay-action-editor"]')).toBeNull();
    await click(host.querySelector('[data-testid="replay-choice"]'));
    await setAction('修改后的行动');
    await click(byText('发送行动'));
    expect(submit).toHaveBeenCalledWith('修改后的行动');
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('修改后的行动');
    expect(host.querySelector('[data-testid="replay-action-editor"] [role="alert"]')?.textContent).toBe('失败');
    expect(host.querySelectorAll('[data-testid="replay-choice"]')).toHaveLength(3);
    expect(session.turns).toHaveLength(1);
    await click(byText('发送行动'));
    expect(submit).toHaveBeenCalledTimes(2);
  });
  it('offers free action with no suggestions and restores a completed record', async () => {
    session = makeSession({ turns: [{ ...turn, world: { ...turn.world, suggestedActions: [] } }] });
    await render(); await goToEnd();
    expect(host.querySelectorAll('[data-testid="replay-choice"]')).toHaveLength(0);
    await click(byText('自由输入'));
    await setAction('我留在门边');
    await click(byText('发送行动'));
    expect(submit).toHaveBeenLastCalledWith('我留在门边');
    session = makeSession({ status: 'completed', outcome: { summary: '模拟结束', changedTrajectory: '稍有变化', closingImage: '教室门', generatedAt: 2 } });
    await render(); expect(host.textContent).toContain('模拟结束'); expect(host.querySelector('[data-testid="replay-choice"]')).toBeNull();
  });
  it('places each choice in a column inside the middle region above the dialogue across viewport classes', async () => {
    await render(); await goToEnd();
    const middle = host.querySelector('[data-testid="replay-choice-region"]')!;
    const dialogue = host.querySelector('[data-testid="replay-dialogue"]')!;
    expect(middle.compareDocumentPosition(dialogue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const [width, height] of [[390, 844], [360, 640], [844, 390]]) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
      expect(middle.querySelectorAll('[data-testid="replay-choice"]')).toHaveLength(3);
      expect(dialogue.parentElement).toBe(middle.parentElement);
    }
    const css = readFileSync(`${process.cwd()}/components/lifeReplay/LifeReplayScene.css`, 'utf8');
    expect(css).toMatch(/\.replay-stage-content\{[^}]*display:flex[^}]*flex-direction:column/);
    expect(css).toMatch(/\.replay-stage-middle\{[^}]*flex:1[^}]*justify-content:center[^}]*overflow:hidden/);
    expect(css).toMatch(/\.replay-choice-panel\{[^}]*flex-direction:column[^}]*max-height:100%[^}]*overflow-y:auto/);
    expect(css).toMatch(/\.replay-dialogue\{[^}]*flex:none[^}]*height:clamp/);
    await click(host.querySelector('[data-testid="replay-choice"]'));
    const editor = host.querySelector('[data-testid="replay-action-editor"]')!;
    expect(middle.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(editor.compareDocumentPosition(dialogue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('moves the editor above a synthetic soft keyboard and restores reading on cancel', async () => {
    const priorViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    const viewport = Object.assign(new EventTarget(), { height: 500, offsetTop: 0 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    try {
      await render(); await goToEnd(); await click(host.querySelector('[data-testid="replay-choice"]'));
      const stage = host.querySelector('[data-testid="replay-stage"]') as HTMLElement;
      expect(stage.classList.contains('replay-stage-keyboard')).toBe(true);
      expect(stage.style.getPropertyValue('--replay-keyboard-inset')).toBe('344px');
      expect(host.querySelector('[data-testid="replay-action-editor"]')).not.toBeNull();
      viewport.height = 844;
      await act(async () => viewport.dispatchEvent(new Event('resize')));
      expect(stage.classList.contains('replay-stage-keyboard')).toBe(false);
      await click(byText('取消编辑'));
      expect(submit).not.toHaveBeenCalled();
      expect(host.querySelector('[data-testid="replay-dialogue"]')).not.toBeNull();
    } finally {
      if (priorViewport) Object.defineProperty(window, 'visualViewport', priorViewport);
      else Reflect.deleteProperty(window, 'visualViewport');
    }
  });
  it('starts a newly saved turn at its first passage and keeps history browsing read only', async () => {
    await render(); await goToEnd();
    session = makeSession({ turns: [turn, { ...turn, id: 'second', kind: 'interaction', userAction: '我向前一步' }] });
    await render();
    expect(host.querySelector('.replay-dialogue-head strong')?.textContent).toBe('现在的我');
    expect(host.querySelector('.replay-dialogue-scroll')?.textContent).toBe('我向前一步');
    await click(byText('上一段'));
    expect(submit).not.toHaveBeenCalled();
    await act(async () => root.unmount()); root = createRoot(host);
    await render();
    expect(host.querySelector('[data-testid="replay-choices"]')).not.toBeNull();
  });
  it('updates the meeting portrait for another companion and falls back after image errors', async () => {
    await render(); await click(byText('见面立绘'));
    expect(host.querySelector('.replay-sprite-image')?.getAttribute('src')).toBe('skin.png');
    await act(async () => host.querySelector('.replay-sprite-image')?.dispatchEvent(new Event('error')));
    expect(host.querySelector('.replay-avatar-image')?.getAttribute('src')).toBe('avatar.png');
    await act(async () => host.querySelector('.replay-avatar-image')?.dispatchEvent(new Event('error')));
    expect(host.querySelector('.replay-avatar-image')).toBeNull();
    const other = { ...char, id: 'c2', name: '另一位', avatar: 'other-avatar.png', sprites: {}, dateSkinSets: [] } as CharacterProfile;
    session = makeSession({ charId: other.id });
    await render({ char: other });
    expect(host.querySelector('.replay-avatar-image')?.getAttribute('src')).toBe('other-avatar.png');
    expect(host.querySelector('.replay-dialogue-head strong')?.textContent).toBe('开场');
  });
});
