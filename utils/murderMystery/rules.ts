import type { MurderMysteryEvent, MurderMysterySession, MysterySpeechMode } from './session';
import { normalizeMurderMysterySession, publicAudience, seatAudience } from './session';
import { getMysteryAnswerOptions } from './script';

type EventDraft = Omit<MurderMysteryEvent, 'id' | 'sessionId' | 'revision' | 'timestamp'>;
export type MurderMysteryCommand =
  | { type: 'game_start' }
  | { type: 'investigator_question'; targetSeatId: string; content: string; note?: string }
  | { type: 'answer_question'; answer: string; speakerCharId?: string }
  | { type: 'investigator_reason'; content: string; note?: string }
  | { type: 'request_ability'; abilityId: string; targetSeatId: string }
  | { type: 'decline_ability' }
  | { type: 'accuse'; targetSeatId: string; content: string; speechMode: 'in_character' | 'out_of_character'; speakerCharId?: string }
  | { type: 'propose'; kind: 'phase' | 'victory'; targetId: string; reason: string; source: 'ai' | 'host' }
  | { type: 'confirm_phase'; phaseId: string }
  | { type: 'grant'; grantType: 'clue' | 'deliverable' | 'ability'; grantId: string }
  | { type: 'use_ability'; abilityId: string; holderSeatId: string; targetSeatId: string }
  | { type: 'advance_round' }
  | { type: 'open_private'; threadId: string; participantCharIds: [string, string]; sourceRequestId?: string }
  | { type: 'close_private'; threadId: string }
  | { type: 'private_message'; threadId: string; content: string; speakerCharId?: string; speechMode: MysterySpeechMode }
  | { type: 'host_game_message'; charId: string; content: string }
  | { type: 'correct_speech_mode'; eventId: string; speechMode: 'in_character' | 'out_of_character' }
  | { type: 'end_game'; endingId?: string; winnerSeatIds: string[]; verdict: string };

const system = (content: string, action: string, audienceIds: string[] = []): EventDraft =>
  ({ channel: audienceIds.length ? 'host_player_game' : 'host_system', audienceIds, speechMode: 'system', content, action });

export function planMurderMysteryCommand(raw: MurderMysterySession, command: MurderMysteryCommand, history: MurderMysteryEvent[] = []): { session: MurderMysterySession; events: EventDraft[] } {
  const session = normalizeMurderMysterySession(raw);
  const script = session.scriptSnapshot;
  const all = publicAudience(session);
  const requireSeat = (id: string) => { if (!script.seats.some(seat => seat.id === id)) throw new Error(`未知席位：${id}`); return seatAudience(session, id); };
  const requireAudience = (id: string) => id === script.investigator?.id && session.participation ? session.participation.investigatorCharId : requireSeat(id);
  const requirePlaying = () => { if (session.status === 'ended' || (session.participation && session.status !== 'playing')) throw new Error('对局尚未正式开始或已结束'); };
  const events: EventDraft[] = [];
  let next = { ...session };
  if (command.type === 'game_start') {
    if (!session.participation || session.status !== 'preparation') throw new Error('本局不能重复正式开场');
    next.status = 'playing';
    const phase = script.phases.find(item => item.id === session.phaseId);
    events.push({ channel: 'public_table', audienceIds: all, speechMode: 'system',
      content: `正式开场：${phase?.title || script.title}。${(phase?.publicRules || []).join(' ')}`, action: 'game_start' });
    for (const statement of script.investigator?.openingStatements || []) events.push({ channel: 'public_table', audienceIds: all,
      seatId: statement.seatId, speakerActorId: statement.seatId, speechMode: 'in_character', content: statement.text, action: 'opening_statement' });
  } else if (command.type === 'investigator_question') {
    requirePlaying();
    if (!session.participation || session.pendingQuestion || session.pendingAbility || session.pendingDecision) throw new Error('当前需先完成待处理事项');
    requireSeat(command.targetSeatId);
    if (session.activeEffects.some(effect => effect.targetSeatId === command.targetSeatId && effect.blocksPublicSpeech && effect.remainingRounds > 0)) throw new Error('目标当前不能公开回答');
    if (!command.content.trim() || !/[?？]/.test(command.content)) throw new Error('请提出明确问题');
    const options = getMysteryAnswerOptions(script.phases.find(item => item.id === session.phaseId), command.targetSeatId);
    if (options && (/(为什么|怎么|如何|什么|谁|何时|哪里|请说|解释|讲述|描述|讲讲|说说|经过|过程|理由|原因)/.test(command.content) || !/(吗|么|是否|是不是|有没有|能否|可否|对不对)/.test(command.content))) throw new Error('本幕请改问明确的封闭问题');
    next.pendingQuestion = { targetSeatId: command.targetSeatId, content: command.content.trim(), askedAtRevision: session.revision + 1 };
    if (command.note?.trim()) next.investigatorNote = command.note.trim().slice(0, 2000);
    events.push({ channel: 'public_table', audienceIds: all, speakerCharId: session.participation.investigatorCharId,
      speakerActorId: script.investigator?.id, speechMode: 'in_character', targetSeatId: command.targetSeatId,
      content: command.content.trim(), action: 'investigator_question' });
  } else if (command.type === 'answer_question') {
    requirePlaying();
    const pending = session.pendingQuestion;
    if (!pending) throw new Error('没有待回答的问题');
    const human = session.participation?.humanSeatIds.includes(pending.targetSeatId);
    if (human ? !!command.speakerCharId : session.seats[pending.targetSeatId] !== command.speakerCharId) throw new Error('回答者与目标不符');
    const options = getMysteryAnswerOptions(script.phases.find(item => item.id === session.phaseId), pending.targetSeatId);
    if (!command.answer.trim() || (options && !options.includes(command.answer.trim()))) throw new Error(`本幕该角色只能回答${options?.map(option => `“${option}”`).join('或') || '非空内容'}`);
    next.pendingQuestion = undefined;
    events.push({ channel: 'public_table', audienceIds: all, speakerCharId: command.speakerCharId,
      speakerActorId: pending.targetSeatId, seatId: pending.targetSeatId, speechMode: 'in_character',
      content: command.answer.trim(), action: 'investigator_answer' });
  } else if (command.type === 'investigator_reason') {
    requirePlaying(); if (!session.participation || session.pendingQuestion || !command.content.trim()) throw new Error('现在不能记录调查推理');
    next.investigatorNote = command.note?.trim().slice(0, 2000) || session.investigatorNote;
    events.push({ channel: 'public_table', audienceIds: all, speakerCharId: session.participation.investigatorCharId,
      speakerActorId: script.investigator?.id, speechMode: 'in_character', content: command.content.trim(), action: 'investigator_reason' });
  } else if (command.type === 'request_ability') {
    requirePlaying(); if (!session.participation || session.pendingQuestion || session.pendingAbility) throw new Error('当前有待处理事项');
    requireSeat(command.targetSeatId);
    const ability = script.abilities.find(item => item.id === command.abilityId && item.holderSeatIds.includes(script.investigator!.id));
    if (!ability || !session.grantedAbilityIds.includes(ability.id) || (session.abilityUses[`${ability.id}:${script.investigator!.id}`] || 0) >= ability.uses) throw new Error('调查者当前无权申请此能力');
    next.pendingAbility = { abilityId: ability.id, targetSeatId: command.targetSeatId };
    events.push(system(`调查者申请对 ${script.seats.find(item => item.id === command.targetSeatId)?.name} 使用「${ability.name}」，等待主持人批准。`, 'ability_request'));
  } else if (command.type === 'decline_ability') {
    requirePlaying(); if (!session.pendingAbility) throw new Error('没有待审批能力');
    next.pendingAbility = undefined; events.push(system('主持人拒绝了本次能力申请。', 'ability_declined'));
  } else if (command.type === 'accuse') {
    requirePlaying(); requireSeat(command.targetSeatId);
    if (session.participation && command.speakerCharId !== session.participation.investigatorCharId) throw new Error('V2 正式指认只能由调查者提交；主持人可另行提出私有候选');
    if (!script.communicationRules.publicTable) throw new Error('剧本禁止公共交流');
    if (command.speakerCharId && !all.includes(command.speakerCharId)) throw new Error('发言者未参与本局');
    events.push({ channel: 'public_table', audienceIds: all, speakerCharId: command.speakerCharId,
      seatId: command.speakerCharId ? Object.entries(session.seats).find(([, id]) => id === command.speakerCharId)?.[0] : undefined,
      speakerActorId: command.speakerCharId === session.participation?.investigatorCharId ? script.investigator?.id : undefined,
      speechMode: command.speechMode, content: command.content.trim(), action: 'accusation', targetSeatId: command.targetSeatId });
    if (!command.content.trim()) throw new Error('指认说明不能为空');
    const current = script.phases.find(phase => phase.id === session.phaseId);
    const targetIndex = script.phases.findIndex(phase => phase.id === current?.id) + 1;
    if (command.speechMode === 'in_character' && current?.completion?.action === 'accusation'
      && current.completion.acceptedSeatIds.includes(command.targetSeatId) && script.phases[targetIndex]) {
      next.pendingDecision = { kind: 'phase', targetId: script.phases[targetIndex].id,
        reason: `正式指认 ${script.seats.find(seat => seat.id === command.targetSeatId)?.name} 符合当前阶段的结构化条件。`, source: 'rule' };
      events.push(system(next.pendingDecision.reason, 'phase_candidate'));
    }
  } else if (command.type === 'propose') {
    requirePlaying();
    if (command.kind === 'phase' && !script.phases.some(item => item.id === command.targetId)) throw new Error('未知目标阶段');
    if (command.kind === 'victory' && !script.victoryConditions.some(item => item.id === command.targetId)) throw new Error('未知胜负条件');
    next.pendingDecision = { kind: command.kind, targetId: command.targetId, reason: command.reason.trim(), source: command.source };
    events.push(system(`候选${command.kind === 'phase' ? '阶段' : '胜负'}：${command.reason.trim()}`, 'gm_candidate'));
  } else if (command.type === 'confirm_phase') {
    requirePlaying();
    const phase = script.phases.find(item => item.id === command.phaseId);
    if (!phase || session.phaseId === phase.id) throw new Error('目标阶段无效');
    if (session.participation && script.phases[script.phases.findIndex(item => item.id === session.phaseId) + 1]?.id !== phase.id) throw new Error('V2 只能由主持人确认进入下一幕');
    next.phaseId = phase.id; next.pendingDecision = undefined; next.pendingQuestion = undefined; next.pendingAbility = undefined; next.status = 'playing';
    events.push(system(`主持人确认进入 ${phase.title}`, 'phase_confirm'));
    events.push({ channel: 'public_table', audienceIds: all, speechMode: 'system', content: `进入 ${phase.title}。${(phase.publicRules || []).join(' ')}`,
      action: 'phase_announcement' });
    for (const clue of script.clues.filter(item => item.grant.kind === 'phase' && item.grant.phaseId === phase.id && !session.grantedClueIds.includes(item.id))) {
      events.push({ ...system(clue.text, 'grant_clue', clue.initiallyPublic ? all : clue.audience.map(requireAudience)), grantId: clue.id });
      next.grantedClueIds = [...next.grantedClueIds, clue.id];
    }
    for (const item of script.deliverables.filter(item => item.grant.kind === 'phase' && item.grant.phaseId === phase.id && !session.grantedDeliverableIds.includes(item.id))) {
      events.push({ ...system(`${item.title}\n${item.text}`, 'grant_deliverable', item.audience.map(requireAudience)), grantId: item.id });
      next.grantedDeliverableIds = [...next.grantedDeliverableIds, item.id];
    }
    for (const item of script.abilities.filter(item => item.grant.kind === 'phase' && item.grant.phaseId === phase.id && !session.grantedAbilityIds.includes(item.id))) {
      events.push({ ...system(`获得能力：${item.name}。${item.effect}`, 'grant_ability', item.holderSeatIds.map(id => id === script.investigator?.id ? session.participation?.investigatorCharId || '' : requireSeat(id))), grantId: item.id });
      next.grantedAbilityIds = [...next.grantedAbilityIds, item.id];
    }
    if (phase.revealObjectiveFacts) events.push({ channel: 'public_table', audienceIds: all, speechMode: 'system',
      content: `主持人揭晓真相：\n${script.objectiveFacts.map(fact => fact.text).join('\n')}`, action: 'truth_reveal' });
  } else if (command.type === 'grant') {
    requirePlaying();
    const list = command.grantType === 'clue' ? script.clues : command.grantType === 'deliverable' ? script.deliverables : script.abilities;
    const item = list.find(value => value.id === command.grantId);
    if (!item) throw new Error('资料不存在');
    const granted = command.grantType === 'clue' ? session.grantedClueIds : command.grantType === 'deliverable' ? session.grantedDeliverableIds : session.grantedAbilityIds;
    if (granted.includes(item.id)) throw new Error('资料已经发放');
    const audienceIds = command.grantType === 'ability' ? (item as typeof script.abilities[number]).holderSeatIds.map(id => id === script.investigator?.id ? session.participation?.investigatorCharId || '' : requireSeat(id))
      : command.grantType === 'clue' && (item as typeof script.clues[number]).initiallyPublic ? all
      : (item as typeof script.clues[number]).audience.map(requireAudience);
    const content = command.grantType === 'clue' ? (item as typeof script.clues[number]).text
      : command.grantType === 'deliverable' ? `${(item as typeof script.deliverables[number]).title}\n${(item as typeof script.deliverables[number]).text}`
      : `获得能力：${(item as typeof script.abilities[number]).name}。${(item as typeof script.abilities[number]).effect}`;
    events.push({ ...system(content, `grant_${command.grantType}`, audienceIds), grantId: item.id });
    if (command.grantType === 'clue') next.grantedClueIds = [...session.grantedClueIds, item.id];
    else if (command.grantType === 'deliverable') next.grantedDeliverableIds = [...session.grantedDeliverableIds, item.id];
    else next.grantedAbilityIds = [...session.grantedAbilityIds, item.id];
  } else if (command.type === 'use_ability') {
    requirePlaying(); if (command.holderSeatId !== script.investigator?.id) requireSeat(command.holderSeatId); requireSeat(command.targetSeatId);
    const ability = script.abilities.find(item => item.id === command.abilityId);
    if (!ability || !ability.holderSeatIds.includes(command.holderSeatId) || !session.grantedAbilityIds.includes(ability.id)) throw new Error('此玩家无权使用该能力');
    if (session.participation && command.holderSeatId === script.investigator?.id && (session.pendingAbility?.abilityId !== ability.id || session.pendingAbility.targetSeatId !== command.targetSeatId)) throw new Error('调查者必须先申请此能力');
    const key = `${ability.id}:${command.holderSeatId}`;
    if ((session.abilityUses[key] || 0) >= ability.uses) throw new Error('能力次数已用完');
    const outcome = ability.outcomes?.find(item => item.targetSeatId === command.targetSeatId);
    const label = outcome?.label || ability.effect;
    const duration = ability.durationRounds || 0;
    next.abilityUses = { ...session.abilityUses, [key]: (session.abilityUses[key] || 0) + 1 };
    next.pendingAbility = undefined;
    if (duration) next.activeEffects = [...session.activeEffects, { id: crypto.randomUUID(), abilityId: ability.id, targetSeatId: command.targetSeatId,
      label, remainingRounds: duration, blocksPublicSpeech: outcome?.blocksPublicSpeech || false }];
    events.push(system(`主持人确认 ${command.holderSeatId === script.investigator?.id ? script.investigator.name : script.seats.find(seat => seat.id === command.holderSeatId)?.name} 使用「${ability.name}」作用于 ${script.seats.find(seat => seat.id === command.targetSeatId)?.name}；状态：${label}（${duration} 轮）。`, 'ability_used'));
    events.push(system(`你受到「${ability.name}」影响：${label}${duration ? `，持续 ${duration} 轮` : ''}。`, 'ability_effect', [requireSeat(command.targetSeatId), command.holderSeatId === script.investigator?.id ? session.participation?.investigatorCharId || '' : requireSeat(command.holderSeatId)]));
  } else if (command.type === 'advance_round') {
    requirePlaying(); next.roundNumber = session.roundNumber + 1;
    next.activeEffects = session.activeEffects.map(effect => ({ ...effect, remainingRounds: effect.remainingRounds - 1 })).filter(effect => effect.remainingRounds > 0);
    events.push(system(`主持人推进至第 ${next.roundNumber} 轮；持续状态由本地计数。`, 'round_advance'));
  } else if (command.type === 'open_private') {
    requirePlaying(); if (!script.communicationRules.playerPrivate) throw new Error('剧本禁止玩家秘密交流');
    const [a, b] = command.participantCharIds;
    if (!all.includes(a) || !all.includes(b) || a === b) throw new Error('秘密交流参与者无效');
    if (session.privateThreads.some(thread => thread.id === command.threadId)) throw new Error('秘密交流 ID 重复');
    next.privateThreads = [...session.privateThreads, { id: command.threadId, participantCharIds: [a, b], active: true, openedAt: Date.now(), sourceRequestId: command.sourceRequestId }];
    events.push({ channel: 'player_private', audienceIds: [a, b], threadId: command.threadId, speechMode: 'system', content: '主持人允许你们进行秘密交流。其他玩家不会看到本段。', action: 'private_open' });
  } else if (command.type === 'close_private') {
    requirePlaying(); const thread = session.privateThreads.find(item => item.id === command.threadId && item.active);
    if (!thread) throw new Error('秘密交流不存在或已结束');
    next.privateThreads = session.privateThreads.map(item => item.id === thread.id ? { ...item, active: false } : item);
    events.push({ channel: 'player_private', audienceIds: thread.participantCharIds, threadId: thread.id, speechMode: 'system', content: '主持人结束了秘密交流。', action: 'private_close' });
  } else if (command.type === 'private_message') {
    requirePlaying(); const thread = session.privateThreads.find(item => item.id === command.threadId && item.active);
    if (!thread) throw new Error('秘密交流未开放');
    if (command.speakerCharId && !thread.participantCharIds.includes(command.speakerCharId)) throw new Error('发言者不在秘密交流中');
    if (!command.content.trim()) throw new Error('消息不能为空');
    events.push({ channel: 'player_private', audienceIds: thread.participantCharIds, threadId: thread.id,
      speakerCharId: command.speakerCharId, seatId: command.speakerCharId ? Object.entries(session.seats).find(([, id]) => id === command.speakerCharId)?.[0] : undefined,
      speechMode: command.speechMode, content: command.content.trim(), action: 'private_message' });
  } else if (command.type === 'host_game_message') {
    requirePlaying(); if (!script.communicationRules.hostPlayerGame) throw new Error('剧本禁止正式主持人单独环节');
    if (!all.includes(command.charId) || !command.content.trim()) throw new Error('目标或内容无效');
    events.push({ channel: 'host_player_game', audienceIds: [command.charId], speechMode: 'in_character', content: command.content.trim(), action: 'host_game_message' });
  } else if (command.type === 'correct_speech_mode') {
    requirePlaying();
    const original = history.find(item => item.id === command.eventId && item.sessionId === session.id && item.channel === 'public_table' && item.speechMode !== 'system');
    if (!original) throw new Error('只能更正本局公开发言');
    events.push({ channel: 'public_table', audienceIds: original.audienceIds, speechMode: command.speechMode,
      content: `主持人更正第 ${original.revision} 条公开发言为${command.speechMode === 'in_character' ? '戏内发言' : '皮下公开发言'}。`,
      action: 'speech_mode_correction', correctsEventId: original.id });
    const current = script.phases.find(item => item.id === session.phaseId);
    const nextPhase = script.phases[script.phases.findIndex(item => item.id === current?.id) + 1];
    if (original.action === 'accusation' && current?.completion?.action === 'accusation') {
      if (command.speechMode === 'in_character' && current.completion.acceptedSeatIds.includes(original.targetSeatId || '') && nextPhase) {
        next.pendingDecision = { kind: 'phase', targetId: nextPhase.id, source: 'rule', reason: '主持人将符合条件的指认更正为正式戏内发言。' };
        events.push(system(next.pendingDecision.reason, 'phase_candidate'));
      } else if (command.speechMode === 'out_of_character' && session.pendingDecision?.source === 'rule') next.pendingDecision = undefined;
    }
  } else if (command.type === 'end_game') {
    requirePlaying(); if (!command.verdict.trim()) throw new Error('请填写主持人最终裁定');
    if (command.endingId && !script.endings.some(item => item.id === command.endingId)) throw new Error('未知结局');
    command.winnerSeatIds.forEach(requireSeat);
    next.status = 'ended'; next.pendingDecision = undefined;
    next.outcome = { endingId: command.endingId, winnerSeatIds: [...command.winnerSeatIds], verdict: command.verdict.trim() };
    events.push(system(`主持人最终裁定：${command.verdict.trim()}`, 'gm_verdict'));
    events.push({ channel: 'public_table', audienceIds: all, speechMode: 'system', content: `本局结束。${command.verdict.trim()}`, action: 'game_end' });
  }
  return { session: next, events };
}
