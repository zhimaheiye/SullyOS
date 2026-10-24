import { buildInvestigatorView, buildPlayerView, seatForChar, type MurderMysteryEvent, type MurderMysterySession } from './session';

const transcript = (session: MurderMysterySession, events: Array<{ revision: number; channel: string; speakerCharId?: string; speakerActorId?: string; seatId?: string; content: string }>) =>
  events.map(event => `#${event.revision} [${event.channel}] ${event.seatId ? session.scriptSnapshot.seats.find(seat => seat.id === event.seatId)?.name || event.seatId
    : session.scriptSnapshot.investigator && event.speakerActorId === session.scriptSnapshot.investigator.id ? session.scriptSnapshot.investigator.name
    : event.speakerCharId || '主持人'}：${event.content}`).join('\n');

export function buildHostMysteryReport(session: MurderMysterySession, events: MurderMysteryEvent[]): string {
  const script = session.scriptSnapshot;
  return [
    `剧本杀战报：${script.title}`,
    `状态：${session.status}；阶段：${script.phases.find(phase => phase.id === session.phaseId)?.title || '无'}`,
    `席位：${script.seats.map(seat => `${seat.name}=${session.participation?.humanSeatIds.includes(seat.id) ? '用户真人' : session.seats[seat.id]}`).join('、')}${session.participation ? `；调查者=${session.participation.investigatorCharId}` : ''}`,
    `主持人裁定：${session.outcome?.verdict || '尚未结算'}`,
    `胜出席位：${session.outcome?.winnerSeatIds.map(id => script.seats.find(seat => seat.id === id)?.name || id).join('、') || '无／未设胜负'}`,
    `客观真相：\n${script.objectiveFacts.map(fact => fact.text).join('\n')}`,
    `完整事件（含秘密与皮下）：\n${transcript(session, events)}`,
  ].join('\n\n');
}

export function buildPlayerMysteryReport(session: MurderMysterySession, events: MurderMysteryEvent[], charId: string): string {
  if (session.participation?.investigatorCharId === charId) {
    const view = buildInvestigatorView(session, events, charId);
    return [`剧本杀调查者战报：${view.title}`, `本局身份：${session.scriptSnapshot.investigator?.name || '调查者'}`,
      `已公开的结局：${view.events.filter(event => event.action === 'game_end').map(event => event.content).join('\n') || '尚未公开'}`,
      `本人调查笔记：${view.note}`, `合法可见事件：\n${transcript(session, view.events)}`].join('\n\n');
  }
  const view = buildPlayerView(session, events, charId);
  const seatId = seatForChar(session, charId);
  return [
    `剧本杀个人战报：${view.title}`,
    `你扮演：${session.scriptSnapshot.seats.find(seat => seat.id === seatId)?.name || seatId}`,
    `已公开的结局：${view.events.filter(event => event.action === 'game_end').map(event => event.content).join('\n') || '尚未公开'}`,
    `你合法获知的事件：\n${transcript(session, view.events)}`,
  ].join('\n\n');
}

export function buildMysteryRealitySummary(session: MurderMysterySession, charId: string): string {
  if (session.participation?.investigatorCharId === charId) return `我与用户一起玩过剧本杀《${session.scriptSnapshot.title}》，我在这场游戏中担任独立调查者。这是一段共同游戏经历；剧本情节不是我现实中的经历。`;
  const seatId = seatForChar(session, charId);
  const seatName = session.scriptSnapshot.seats.find(seat => seat.id === seatId)?.name || seatId;
  return `我与用户一起玩过剧本杀《${session.scriptSnapshot.title}》，我在这场游戏中扮演「${seatName}」。这是一段共同游戏经历；剧本里的行为是虚构角色的情节，不是我现实中的经历。`;
}
