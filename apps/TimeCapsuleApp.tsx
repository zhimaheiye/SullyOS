import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, CaretLeft, ClockCountdown, EnvelopeSimpleOpen, HourglassMedium,
  Check, LockKey, PencilSimple, Plus, Stop, Trash, UserCirclePlus, UsersThree, WarningCircle,
} from '@phosphor-icons/react';
import { TIME_CAPSULE_UPDATED_EVENT } from '../components/timeCapsule/TimeCapsuleRuntime';
import { useOS } from '../context/OSContext';
import type { CharacterProfile, TimeCapsuleEntry, TimeCapsuleInviteBatch, TimeCapsuleRecord, TimeCapsuleSettings } from '../types';
import { DB } from '../utils/db';
import {
  createUserTimeCapsule, DEFAULT_TIME_CAPSULE_SETTINGS, formatTimeCapsuleDistance,
  maxTimeCapsuleUnlockAt, toLocalDateTimeInput, createTimeCapsuleInviteBatch,
  safeTimeCapsuleInviteError, timeCapsuleCharacterSignatureHash,
} from '../utils/timeCapsule';
import {isManualRelayEnabled, subscribeManualRelay} from '../utils/manualModelRelay';
import { requestCharacterTimeCapsule } from '../utils/timeCapsuleService';

type Tab = 'archive' | 'write' | 'invite' | 'visitors';

const Avatar: React.FC<{ char: Pick<CharacterProfile, 'name' | 'avatar'>; size?: string }> = ({ char, size = 'h-12 w-12' }) => (
  <div className={`${size} shrink-0 overflow-hidden rounded-full bg-[#efe4cc] ring-2 ring-white`}>
    {char.avatar
      ? <img src={char.avatar} alt={char.name} className="h-full w-full object-cover" />
      : <div className="flex h-full w-full items-center justify-center font-black text-[#7a433b]">{char.name.slice(0, 1)}</div>}
  </div>
);

const formatDate = (time: number) => new Date(time).toLocaleString('zh-CN', {
  year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

const sourceLabel = (capsule: TimeCapsuleEntry) => {
  if (capsule.source === 'user') return '由你封存';
  if (capsule.source === 'auto') return `${capsule.charName || '角色'}来访时留下`;
  return `你邀请${capsule.charName || '角色'}留下`;
};

const inviteStatusLabel={waiting:'等待中',running:'正在写',saved:'已封存',failed:'未完成',interrupted:'已中断'} as const;
const executorId=()=>{
  const key='sully.timeCapsule.inviteExecutor.v1';
  try{const old=sessionStorage.getItem(key);if(old)return old;const next=`tab_${Date.now()}_${Math.random().toString(36).slice(2)}`;sessionStorage.setItem(key,next);return next;}catch{return `tab_${Date.now()}_${Math.random().toString(36).slice(2)}`;}
};

const TimeCapsuleApp: React.FC = () => {
  const {
    closeApp, registerBackHandler, characters, userProfile, groups, apiConfig, realtimeConfig, addToast,
  } = useOS();
  const [tab, setTab] = useState<Tab>('archive');
  const [records, setRecords] = useState<TimeCapsuleRecord[]>([]);
  const [now, setNow] = useState(Date.now());
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [unlockValue, setUnlockValue] = useState(() => toLocalDateTimeInput(Date.now() + 30 * 86_400_000));
  const [inviteCharIds, setInviteCharIds] = useState<string[]>([]);
  const [busyItemId, setBusyItemId] = useState('');
  const [dismissedBatchId,setDismissedBatchId]=useState('');
  const [pendingSave,setPendingSave]=useState<{op:{batchId:string;itemId:string;attempt:number;charId:string};capsule:TimeCapsuleEntry;character:CharacterProfile}|null>(null);
  const executor = useRef(executorId());
  const invitation = useRef<{controller:AbortController;batchId:string;itemId:string;attempt:number;charId:string}|null>(null);
  const cancelInvitation=useCallback(()=>{invitation.current?.controller.abort();setBusyItemId('');},[]);
  useEffect(()=>{
    const reset=()=>{cancelInvitation();setPendingSave(null);};
    window.addEventListener('time-capsule-reset',reset);
    return()=>{window.removeEventListener('time-capsule-reset',reset);invitation.current?.controller.abort();};
  },[cancelInvitation]);
  useEffect(()=>{
    if(invitation.current&&tab!=='invite')cancelInvitation();
  },[tab,cancelInvitation]);


  const capsules = useMemo(() => records
    .filter((item): item is TimeCapsuleEntry => item.kind === 'capsule')
    .sort((a, b) => b.createdAt - a.createdAt), [records]);
  const settings = useMemo(() => records.find((item): item is TimeCapsuleSettings => item.kind === 'settings') || DEFAULT_TIME_CAPSULE_SETTINGS, [records]);
  const inviteBatches=useMemo(()=>records.filter((item):item is TimeCapsuleInviteBatch=>item.kind==='invite_batch').sort((a,b)=>b.updatedAt-a.updatedAt),[records]);
  const activeInviteBatch=inviteBatches[0];
  const shownInviteBatch=activeInviteBatch?.id===dismissedBatchId?undefined:activeInviteBatch;
  const eligibleCharacters=characters;

  const load = useCallback(async () => setRecords(await DB.getTimeCapsuleRecords()), []);
  useEffect(() => {
    void DB.recoverTimeCapsuleInviteBatches(executor.current).then(load).catch(() => addToast('时间胶囊读取失败', 'error'));
    const onUpdate = () => void load();
    window.addEventListener(TIME_CAPSULE_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(TIME_CAPSULE_UPDATED_EVENT, onUpdate);
  }, [addToast, load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => setInviteCharIds(ids=>ids.filter(id=>eligibleCharacters.some(char=>char.id===id))), [eligibleCharacters]);

  const goBack = useCallback(() => {
    cancelInvitation();
    if (tab !== 'archive') { setTab('archive'); return true; }
    closeApp(); return true;
  }, [closeApp, tab, cancelInvitation]);
  useEffect(() => registerBackHandler(goBack), [goBack, registerBackHandler]);

  const saveSettings = async (patch: Partial<TimeCapsuleSettings>) => {
    await DB.saveTimeCapsuleRecord({ ...settings, ...patch, id: 'settings', kind: 'settings' });
    await load();
    window.dispatchEvent(new Event(TIME_CAPSULE_UPDATED_EVENT));
  };

  const sealOwn = async () => {
    try {
      const capsule = createUserTimeCapsule({ title, content, unlockAt: new Date(unlockValue).getTime() });
      await DB.saveTimeCapsuleRecord(capsule);
      setTitle(''); setContent('');
      setUnlockValue(toLocalDateTimeInput(Date.now() + 30 * 86_400_000));
      await load(); setTab('archive'); addToast('时间胶囊已封存', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '封存失败', 'error');
    }
  };

  const runInvitationBatch = async (batchId:string,onlyItemId?:string) => {
    if(invitation.current)return;
    const relayAtStart=isManualRelayEnabled();
    if(!relayAtStart&&!(apiConfig.baseUrl?.trim()&&apiConfig.model?.trim())){addToast('请先配置时间胶囊文本来源','error');return;}
    const frozenUser=structuredClone(userProfile),frozenGroups=structuredClone(groups),frozenApi=structuredClone(apiConfig),frozenRealtime=structuredClone(realtimeConfig);
    let nextItemId=onlyItemId;
    while(true){
      let claimed:Awaited<ReturnType<typeof DB.claimTimeCapsuleInviteItem>>;
      try{claimed=await DB.claimTimeCapsuleInviteItem(batchId,executor.current,nextItemId);}
      catch(error){if(error instanceof Error&&error.message==='没有可继续的邀请')break;addToast(safeTimeCapsuleInviteError(error),'error');break;}
      nextItemId=undefined;
      const {item}=claimed,controller=new AbortController();
      const op={controller,batchId,itemId:item.id,attempt:item.attempt,charId:item.charId};
      invitation.current=op;setBusyItemId(item.id);await load();
      const unsubscribe=subscribeManualRelay(()=>{if(relayAtStart&&!isManualRelayEnabled())controller.abort();});
      let continueQueue=!relayAtStart;
      let candidate:{capsule:TimeCapsuleEntry;character:CharacterProfile}|undefined;
      try{
        const latest=await DB.getCharacter(item.charId);
        if(!latest||timeCapsuleCharacterSignatureHash(latest)!==item.characterSignature){
          await DB.settleTimeCapsuleInviteItem({...op,executorId:executor.current,status:'failed',error:'角色已删除或身份已变化，请重新选择'});
        }else{
          const char=structuredClone(latest);
          const capsule=await requestCharacterTimeCapsule({char,userProfile:frozenUser,groups:frozenGroups,apiConfig:frozenApi,realtimeConfig:frozenRealtime,source:'invited',signal:controller.signal});
          candidate={capsule,character:char};
          controller.signal.throwIfAborted();
          await DB.finishTimeCapsuleInviteItem({...op,executorId:executor.current,capsule,character:char,signal:controller.signal});
          addToast(`${char.name}留下了一枚胶囊`,'success');
        }
      }catch(error){
        const aborted=controller.signal.aborted||error instanceof DOMException&&error.name==='AbortError';
        if(aborted){
          continueQueue=false;
          try{await DB.settleTimeCapsuleInviteItem({...op,executorId:executor.current,status:'interrupted',error:'本轮已停止，可继续'});}catch{/* reset/import may have removed it */}
        }else{
          const message=safeTimeCapsuleInviteError(error);
          const identityFailure=/角色已变更|角色不一致/.test(message);
          const saveFailure=/保存失败|进度已变化|IndexedDB|database/i.test(message)&&!identityFailure;
          if(saveFailure){continueQueue=false;if(candidate)setPendingSave({op:{batchId:op.batchId,itemId:op.itemId,attempt:op.attempt,charId:op.charId},...candidate});addToast(candidate?'胶囊已生成但尚未保存；请重试保存，不会再次生成':'邀请进度保存失败，队列已暂停；请刷新后继续','error');}
          else try{await DB.settleTimeCapsuleInviteItem({...op,executorId:executor.current,status:'failed',error:message});}catch(settleError){continueQueue=false;addToast(safeTimeCapsuleInviteError(settleError),'error');}
        }
      }finally{
        unsubscribe();
        if(invitation.current===op)invitation.current=null;
        setBusyItemId('');await load();
      }
      if(!continueQueue)break;
    }
  };

  const startInvitationBatch=async()=>{
    const selected=inviteCharIds.map(id=>eligibleCharacters.find(char=>char.id===id)).filter((char):char is CharacterProfile=>!!char);
    if(!selected.length){addToast('请至少选择一位角色','error');return;}
    try{const batch=createTimeCapsuleInviteBatch(selected.map(char=>structuredClone(char)));await DB.saveTimeCapsuleRecord(batch);await load();await runInvitationBatch(batch.id);}
    catch(error){addToast(safeTimeCapsuleInviteError(error),'error');}
  };

  const retryPendingInviteSave=async()=>{
    if(!pendingSave||busyItemId)return;
    const controller=new AbortController();setBusyItemId(pendingSave.op.itemId);
    try{await DB.finishTimeCapsuleInviteItem({...pendingSave.op,executorId:executor.current,capsule:pendingSave.capsule,character:pendingSave.character,signal:controller.signal});setPendingSave(null);await load();addToast(`${pendingSave.character.name}的胶囊已保存`,'success');}
    catch(error){addToast(safeTimeCapsuleInviteError(error),'error');}
    finally{setBusyItemId('');}
  };

  const openCapsule = async (capsule: TimeCapsuleEntry) => {
    if (capsule.unlockAt > Date.now()) return;
    await DB.saveTimeCapsuleRecord({ ...capsule, openedAt: capsule.openedAt || Date.now() });
    await load();
  };

  const deleteCapsule = async (capsule: TimeCapsuleEntry) => {
    if (!window.confirm(`删除“${capsule.title}”？这枚胶囊将无法恢复。`)) return;
    await DB.deleteTimeCapsuleRecord(capsule.id); await load(); addToast('胶囊已删除', 'success');
  };

  const toggleVisitor = async (charId: string) => {
    const ids = settings.visitorCharIds.includes(charId)
      ? settings.visitorCharIds.filter(id => id !== charId)
      : [...settings.visitorCharIds, charId];
    await saveSettings({ visitorCharIds: ids, nextVisitorIndex: 0, enabled: ids.length ? settings.enabled : false });
  };
  const moveVisitor = async (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= settings.visitorCharIds.length) return;
    const ids = [...settings.visitorCharIds];
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await saveSettings({ visitorCharIds: ids, nextVisitorIndex: 0 });
  };

  const renderArchive = () => (
    <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+92px)] pt-3">
      <div className="flex items-end justify-between gap-4 border-b border-[#ddcdb3] pb-5">
        <h2 className="text-3xl font-black tracking-[-0.05em] text-[#272c3a]">写给以后的事</h2>
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[#d9c8aa] bg-[#f4ead6] text-[#8c5149]"><HourglassMedium size={27} weight="duotone" /></div>
      </div>
      <div className="mt-4 flex items-center justify-between text-xs text-[#7d7569]"><span>{capsules.length} 枚胶囊</span><span>{capsules.filter(item => !item.openedAt && item.unlockAt <= now).length} 枚等待开启</span></div>
      {capsules.length === 0 ? (
        <div className="py-24 text-center"><LockKey size={42} className="mx-auto text-[#cbb995]" /><p className="mt-4 text-sm font-bold text-[#665e54]">仓库还是空的</p><p className="mt-2 text-xs leading-5 text-[#9a9083]">写给未来的自己，或者请一位角色留下一段以后才会看到的话。</p></div>
      ) : <div className="mt-5 space-y-4">{capsules.map(capsule => {
        const due = capsule.unlockAt <= now;
        const opened = !!capsule.openedAt;
        const progress = Math.max(0, Math.min(100, ((now - capsule.createdAt) / Math.max(1, capsule.unlockAt - capsule.createdAt)) * 100));
        return <article key={capsule.id} className={`overflow-hidden rounded-[24px] border ${opened ? 'border-[#d8c8aa] bg-[#fffdf7]' : due ? 'border-[#bd6b60] bg-[#fff8ef]' : 'border-[#ded3c1] bg-[#f3ecdf]'}`}>
          <div className="p-5">
            <div className="flex items-start gap-3">
              {capsule.charName ? <Avatar char={{ name: capsule.charName, avatar: capsule.charAvatar || '' }} size="h-10 w-10" /> : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#273044] text-white"><PencilSimple size={18} /></div>}
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-[9px] font-black ${opened ? 'bg-[#e9dfc9] text-[#645b4d]' : due ? 'bg-[#a9534d] text-white' : 'bg-[#ddd0b8] text-[#655b4b]'}`}>{opened ? '已开启' : due ? '时间到了' : '封存中'}</span><span className="truncate text-[10px] text-[#94897a]">{sourceLabel(capsule)}</span></div><h3 className="mt-2 truncate text-base font-black text-[#2b3040]">{capsule.title}</h3></div>
              <button onClick={() => void deleteCapsule(capsule)} className="p-2 text-[#a3776e]" aria-label="删除胶囊"><Trash size={17} /></button>
            </div>
            {opened ? <div className="mt-5 border-t border-[#e6dac5] pt-4"><p className="whitespace-pre-wrap text-sm leading-7 text-[#46443f]">{capsule.content}</p><p className="mt-5 text-[10px] text-[#9a8f7f]">封存于 {formatDate(capsule.createdAt)}</p></div>
              : due ? <div className="mt-5"><p className="text-xs leading-5 text-[#7e685e]">它已经在这里等你了。正文只会在你按下开启后出现。</p><button onClick={() => void openCapsule(capsule)} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#a9534d] text-xs font-black text-white"><EnvelopeSimpleOpen size={18} />开启这枚胶囊</button></div>
              : <div className="mt-5 border-t border-[#dfd2bd] pt-4"><div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-xs font-bold text-[#6d6356]"><LockKey size={15} />{formatTimeCapsuleDistance(capsule.unlockAt, now)}</span><span className="text-[10px] text-[#988c7b]">{formatDate(capsule.unlockAt)}</span></div><div className="mt-3 h-1 overflow-hidden rounded-full bg-[#ddd0bb]"><div className="h-full rounded-full bg-[#a9534d]" style={{ width: `${progress}%` }} /></div></div>}
          </div>
        </article>;
      })}</div>}
    </main>
  );

  const renderWrite = () => (
    <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+92px)] pt-3">
      <h2 className="text-2xl font-black tracking-[-0.04em] text-[#272c3a]">埋下一枚</h2><p className="mt-2 text-sm leading-6 text-[#786f63]">封存后不能编辑。到达开启时间前，仓库不会展示正文。</p>
      <label className="mt-7 block"><span className="mb-2 block text-[10px] font-black tracking-[0.18em] text-[#8c5149]">封面题签</span><input value={title} onChange={event => setTitle(event.target.value)} maxLength={80} placeholder="给未来的我" className="h-12 w-full rounded-2xl border border-[#d9cbb5] bg-[#fffdf8] px-4 text-sm outline-none focus:border-[#a9534d]" /></label>
      <label className="mt-5 block"><span className="mb-2 block text-[10px] font-black tracking-[0.18em] text-[#8c5149]">胶囊正文</span><textarea value={content} onChange={event => setContent(event.target.value)} maxLength={12000} placeholder="现在想留下什么？" className="h-56 w-full resize-none rounded-2xl border border-[#d9cbb5] bg-[#fffdf8] p-4 text-sm leading-6 outline-none focus:border-[#a9534d]" /></label>
      <label className="mt-5 block"><span className="mb-2 block text-[10px] font-black tracking-[0.18em] text-[#8c5149]">开启时间 · 一年以内</span><input type="datetime-local" value={unlockValue} min={toLocalDateTimeInput(Date.now() + 60_000)} max={toLocalDateTimeInput(maxTimeCapsuleUnlockAt())} onChange={event => setUnlockValue(event.target.value)} className="h-12 w-full rounded-2xl border border-[#d9cbb5] bg-[#fffdf8] px-4 text-sm outline-none focus:border-[#a9534d]" /></label>
      <button onClick={() => void sealOwn()} className="mt-7 flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-[#273044] py-4 text-sm font-black text-white"><LockKey size={19} />确认封存</button>
    </main>
  );

  const renderInvite = () => (
    <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+92px)] pt-3">
      <h2 className="text-2xl font-black tracking-[-0.04em] text-[#272c3a]">请角色留一枚</h2><p className="mt-2 text-sm leading-6 text-[#786f63]">每位角色只读取自己的身份、语境与记忆，按选择顺序逐个写入。正文到期前保持密封。</p>
      {shownInviteBatch ? <section className="mt-7 space-y-3" aria-label="本批邀请进度">
        {shownInviteBatch.items.map(item=><article key={item.id} className="rounded-[20px] border border-[#ddd1bf] bg-[#fffdf8] p-4">
          <div className="flex items-center gap-3"><Avatar char={{name:item.charName,avatar:item.charAvatar||''}} size="h-10 w-10"/><div className="min-w-0 flex-1"><b className="block truncate text-sm text-[#343844]">{item.charName}</b><span className={`mt-1 inline-flex items-center gap-1 text-xs ${item.status==='failed'?'text-[#a14e45]':item.status==='saved'?'text-[#4d765c]':'text-[#887b6c]'}`}>{item.status==='saved'?<Check size={13}/>:item.status==='failed'?<WarningCircle size={13}/>:null}{inviteStatusLabel[item.status]}</span></div>
          {item.status==='failed'&&<button data-manual-relay-action disabled={!!busyItemId} onClick={()=>void runInvitationBatch(shownInviteBatch.id,item.id)} className="rounded-xl border border-[#cda99f] px-3 py-2 text-xs font-black text-[#8c5149] disabled:opacity-40">单独重试</button>}{pendingSave?.op.itemId===item.id&&<button disabled={!!busyItemId} onClick={()=>void retryPendingInviteSave()} className="rounded-xl border border-[#cda99f] px-3 py-2 text-xs font-black text-[#8c5149] disabled:opacity-40">重试保存</button>}</div>
          {item.error&&item.status!=='saved'&&<p className="mt-3 break-words text-xs leading-5 text-[#8b6f68]">{item.error}</p>}
        </article>)}
        <div className="flex gap-2 pt-2">{busyItemId?pendingSave?<button disabled className="h-12 flex-1 rounded-2xl bg-[#ece1d4] text-sm font-black text-[#755f56]">正在保存…</button>:<button onClick={cancelInvitation} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#ece1d4] text-sm font-black text-[#755f56]"><Stop size={18}/>停止本轮</button>:pendingSave?<button onClick={()=>void retryPendingInviteSave()} className="h-12 flex-1 rounded-2xl bg-[#a9534d] text-sm font-black text-white">重试保存生成结果</button>:shownInviteBatch.items.some(item=>item.status==='waiting'||item.status==='interrupted')?<button data-manual-relay-action onClick={()=>void runInvitationBatch(shownInviteBatch.id)} className="h-12 flex-1 rounded-2xl bg-[#a9534d] text-sm font-black text-white">{isManualRelayEnabled()?'继续下一位':'继续未完成邀请'}</button>:<button onClick={()=>{setDismissedBatchId(shownInviteBatch.id);setInviteCharIds([]);}} className="h-12 flex-1 rounded-2xl bg-[#273044] text-sm font-black text-white">新建一批邀请</button>}</div>
      </section>:<>
        {eligibleCharacters.length === 0 ? <div className="py-20 text-center text-sm text-[#968b7d]">先去神经链接创建角色，才能发起邀请。</div> : <><div className="mt-6 flex items-center justify-between"><span className="text-xs font-bold text-[#776b5e]">已选 {inviteCharIds.length} 位</span><button onClick={()=>setInviteCharIds(inviteCharIds.length===eligibleCharacters.length?[]:eligibleCharacters.map(char=>char.id))} className="text-xs font-black text-[#8c5149]">{inviteCharIds.length===eligibleCharacters.length?'清空':'全选'}</button></div><div className="mt-3 grid grid-cols-3 gap-3">{eligibleCharacters.map(char => {
          const selected = inviteCharIds.includes(char.id);
          return <button key={char.id} aria-pressed={selected} onClick={() => setInviteCharIds(ids=>selected?ids.filter(id=>id!==char.id):[...ids,char.id])} className={`relative flex flex-col items-center gap-2 rounded-[20px] border py-4 ${selected ? 'border-[#a9534d] bg-[#f6e7dc]' : 'border-[#ddd1bf] bg-[#fffdf8]'}`}><Avatar char={char} />{selected&&<span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#a9534d] text-white"><Check size={12} weight="bold"/></span>}<span className="w-full truncate px-2 text-xs font-black text-[#3c3d43]">{char.name}</span></button>;
        })}</div></>}
        <div className="mt-8 rounded-2xl border border-dashed border-[#cdbb9e] p-4"><p className="text-xs font-black text-[#6d514b]">只保存在这里</p><p className="mt-2 text-xs leading-5 text-[#81776b]">不发到聊天、不写长期记忆，也不会调用 MCP。失败会跳过，已成功的角色不会重复生成。</p></div>
        <button data-manual-relay-action disabled={!inviteCharIds.length || !!busyItemId} onClick={() => void startInvitationBatch()} className="mt-6 flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-[#a9534d] py-4 text-sm font-black text-white disabled:opacity-50"><UserCirclePlus size={19} />邀请 {inviteCharIds.length||0} 位角色</button>
      </>}
    </main>
  );

  const renderVisitors = () => (
    <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+92px)] pt-3">
      <h2 className="text-2xl font-black tracking-[-0.04em] text-[#272c3a]">来访名单</h2><p className="mt-2 text-sm leading-6 text-[#786f63]">像任务工坊一样按名单轮流来访。第一版仅在 SullyOS 打开且页面可见时运行。</p>
      <section className="mt-7 border-y border-[#d9cbb5] py-5"><div className="flex items-center justify-between"><div><h3 className="text-sm font-black text-[#343844]">自动来访</h3><p className="mt-1 text-xs text-[#8b8174]">同一角色有未开启自动胶囊时不会继续堆积</p></div><button disabled={!settings.visitorCharIds.length} onClick={() => void saveSettings({ enabled: !settings.enabled, lastVisitAt: settings.enabled ? settings.lastVisitAt : Date.now() })} className={`relative h-7 w-12 rounded-full transition-colors disabled:opacity-40 ${settings.enabled ? 'bg-[#a9534d]' : 'bg-[#d7cbbb]'}`}><span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${settings.enabled ? 'translate-x-5' : ''}`} /></button></div>
        <label className="mt-5 block"><span className="mb-2 block text-[10px] font-black tracking-[0.15em] text-[#8c5149]">来访间隔</span><select value={settings.intervalMinutes} onChange={event => void saveSettings({ intervalMinutes: Number(event.target.value) })} className="h-11 w-full rounded-xl border border-[#d9cbb5] bg-[#fffdf8] px-3 text-sm"><option value={15}>15 分钟</option><option value={60}>1 小时</option><option value={360}>6 小时</option><option value={720}>12 小时</option><option value={1440}>24 小时</option><option value={4320}>3 天</option><option value={10080}>7 天</option></select></label></section>
      <div className="mt-6 grid grid-cols-4 gap-3">{characters.map(char => { const selected = settings.visitorCharIds.includes(char.id); return <button key={char.id} onClick={() => void toggleVisitor(char.id)} className={`flex flex-col items-center gap-1.5 rounded-2xl py-3 ${selected ? 'bg-[#f0ded2] text-[#71463f]' : 'bg-[#fffdf8] text-[#8c8174]'}`}><Avatar char={char} size="h-11 w-11" /><span className="w-full truncate px-1 text-[10px] font-bold">{char.name}</span></button>; })}</div>
      {settings.visitorCharIds.length > 0 && <div className="mt-7 divide-y divide-[#e2d7c7] border-t border-[#d9cbb5]">{settings.visitorCharIds.map((charId, index) => { const char = characters.find(item => item.id === charId); if (!char) return null; return <div key={charId} className="flex items-center gap-3 py-3"><span className="w-5 text-center text-xs font-black text-[#a69076]">{index + 1}</span><Avatar char={char} size="h-9 w-9" /><b className="min-w-0 flex-1 truncate text-xs text-[#3c3d43]">{char.name}</b><button disabled={index === 0} onClick={() => void moveVisitor(index, -1)} className="p-2 text-[#8c5149] disabled:opacity-20"><ArrowUp size={15} /></button><button disabled={index === settings.visitorCharIds.length - 1} onClick={() => void moveVisitor(index, 1)} className="p-2 text-[#8c5149] disabled:opacity-20"><ArrowDown size={15} /></button></div>; })}</div>}
    </main>
  );

  const nav = [
    ['archive', '仓库', HourglassMedium], ['write', '我来写', Plus], ['invite', '邀请', UserCirclePlus], ['visitors', '来访', UsersThree],
  ] as const;

  return <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#f8f3e9] text-slate-900">
    <header className="shrink-0 border-b border-[#dfd3c1] bg-[#fbf7ef]" style={{ paddingTop: 'var(--safe-top)' }}><div className="flex h-16 items-center justify-between px-4"><button onClick={goBack} className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-[#333846]" aria-label="返回"><CaretLeft size={27} /></button><h1 className="font-black tracking-[-0.02em] text-[#272c3a]">时间胶囊</h1><ClockCountdown size={23} className="mr-2 text-[#8c5149]" /></div></header>
    {tab === 'archive' ? renderArchive() : tab === 'write' ? renderWrite() : tab === 'invite' ? renderInvite() : renderVisitors()}
    <nav className="absolute inset-x-0 bottom-0 grid grid-cols-4 border-t border-[#dfd3c1] bg-[#fffaf1]/95 px-2 pb-[var(--safe-bottom)]"><div className="contents">{nav.map(([id, label, Icon]) => <button key={id} onClick={() => {if(id!==tab)cancelInvitation();setTab(id);}} className={`flex h-16 flex-col items-center justify-center gap-1 text-[10px] font-black ${tab === id ? 'text-[#a14f48]' : 'text-[#9a8e7f]'}`}><Icon size={21} weight={tab === id ? 'fill' : 'regular'} />{label}</button>)}</div></nav>
  </div>;
};

export default TimeCapsuleApp;
