import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChatReplyDots from '../../components/chat/ChatReplyDots';

const chat = readFileSync(new URL('../../apps/Chat.tsx', import.meta.url), 'utf8');

describe('private chat reply UI wiring', () => {
  it('shows pending dots for ordinary generation and instant chat, without a life auto-reply lane', () => {
    expect(chat).not.toContain('setLifeReplyPending');
    expect(chat).not.toContain('decideLifeReply');
    expect(chat).not.toContain('deliverLifeAutoReply');
    expect(chat).toContain('const replyUiTyping = isTyping || instantChatPending');
    expect(chat).toContain('isTyping={replyUiTyping}');
    expect(chat).toContain('generating: replyUiTyping || isProactiveComposing');
    expect(chat).toContain('(replyUiTyping || recallStatus || searchStatus || diaryStatus || isProactiveComposing)');
    expect(chat).toContain('<ChatReplyDots />');
    const markup = renderToStaticMarkup(createElement(ChatReplyDots));
    expect(markup).toContain('aria-label="对方正在回复"');
    expect(markup.match(/animate-bounce/g)).toHaveLength(3);
  });

  it('keeps stop, reroll and the manual trigger on the ordinary typing state', () => {
    expect(chat).toContain('rerollInProgressRef.current');
    expect(chat).toContain("triggerIcon={replyUiTyping ? 'stop' : 'lightning'}");
    expect(chat).toContain('if (isTyping || instantChatPending)');
    expect(chat).not.toContain('lifeReplyVisible');
  });
});
