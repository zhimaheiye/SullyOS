import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DB } from './db';
import { createMcpServer, saveMcpServers, loadMcpServers, callPrivateMcpTool,exportMcpLocal } from './mcpClient';
import {stripBackupImages} from './backupExport';
import { blankObsidianDiary, saveObsidianDiary as saveTarget, loadObsidianDiary, diaryDirectory, restoreDiaryAsset, OBSIDIAN_DIARY_EPOCH, OBSIDIAN_DIARY_KEY } from './obsidianDiaryConfig';
import { enqueueObsidianDiary, saveObsidianDiary, listObsidianDiaries, cancelObsidianDiary, diaryPrompt, validateDiaryTools } from './obsidianDiary';
import { extractObsidianDiary } from './obsidianDiaryProtocol';
import { computeStreamPreviewBubbles } from './streamPreview';
import { classifyLLMOutput } from '../worker/amsg/src/classifier';
vi.mock('./mcpClient', async original => ({ ...await original<typeof import('./mcpClient')>(), callPrivateMcpTool: vi.fn() }));
const calls = vi.mocked(callPrivateMcpTool), vault = new Map<string,string>();
const source = {charId:'diary-owner',charName:'同名角色',title:'夜晚',content:'# 原文\n\n- [x] 留住换行\n> 引用',mood:'平静',sourceId:'reply-stable'};
let writes=0;
const target=()=>({...blankObsidianDiary(),enabled:true,autonomous:true,serverId:'synthetic-obsidian',directory:'合成日记/角色',charIds:[source.charId]});
const missing=(path:string)=>({success:false,error:`File not found: ${path}`,rawText:`File not found: ${path}`});
function mockVault(){calls.mockImplementation(async (_server,name,args={})=>{
 if(name==='get_vault_file'){expect(args.format).toBe('json');const content=vault.get(args.path);return content!==undefined?{success:true,data:{path:args.path,content,truncated:false,stat:{size:new TextEncoder().encode(content).byteLength}}}:missing(args.path);}
 expect(name).toBe('append_to_vault_file');expect(Object.keys(args).sort()).toEqual(['content','path']);
 writes++;vault.set(args.path,(vault.get(args.path)||'')+args.content);return {success:true,data:'OK',rawText:'OK'};
});}
const row=async(id:string)=>(await listObsidianDiaries()).find(r=>r.id===id)!;
beforeEach(async()=>{
 vi.stubGlobal('window',new EventTarget());vi.stubGlobal('document',{visibilityState:'visible'});
 await DB.deleteDB();localStorage.clear();vault.clear();writes=0;calls.mockReset();
 await DB.saveCharacter({id:source.charId,name:source.charName} as any);
 const server={...createMcpServer('合成服务','http://localhost:0/mcp'),id:'synthetic-obsidian',enabled:true,charIds:[source.charId],tools:[
  {name:'get_vault_file',annotations:{readOnlyHint:true},inputSchema:{type:'object',properties:{path:{type:'string'},format:{anyOf:[{const:'json'},{const:'text'}]}},required:['path']}},
  {name:'append_to_vault_file',description:'Appends content to a vault file. Creates the file (and any missing parent directories) if it does not exist.',annotations:{readOnlyHint:false,destructiveHint:false},inputSchema:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content']}}
 ]};saveMcpServers([server]);saveTarget(target());mockVault();
});
afterEach(()=>vi.unstubAllGlobals());
describe('private Obsidian outbox',()=>{
 it('persists Markdown before MCP, verifies the complete file and deduplicates stable replay',async()=>{
  const entry=await enqueueObsidianDiary(source);expect(entry.status).toBe('queued');expect(calls).not.toHaveBeenCalled();
  await saveObsidianDiary(entry.id);expect((await row(entry.id)).status).toBe('written');expect(vault.get(entry.path)).toBe(entry.markdown);
  expect(entry.markdown).toContain(source.content);expect(writes).toBe(1);
  const replay=await enqueueObsidianDiary({...source,content:'late replacement'});await saveObsidianDiary(replay.id);expect(replay.content).toBe(source.content);expect(writes).toBe(1);

 });
 it('allows separate same-day entries and keeps same-named character IDs independent',async()=>{
  await DB.saveCharacter({id:'other',name:source.charName} as any);const config=target();config.charIds.push('other');saveTarget(config);saveMcpServers(loadMcpServers().map(s=>({...s,charIds:config.charIds})));
  const a=await enqueueObsidianDiary(source),b=await enqueueObsidianDiary({...source,sourceId:'another-reply'}),c=await enqueueObsidianDiary({...source,charId:'other'});
  expect(new Set([a.path,b.path,c.path]).size).toBe(3);for(const item of [a,b,c])await saveObsidianDiary(item.id);expect(writes).toBe(3);
 });
 it('recovers a lost success receipt by reading the original file, never duplicates',async()=>{
  const normal=calls.getMockImplementation()!;calls.mockImplementation(async(...args)=>{const result=await normal(...args);if(args[1]==='append_to_vault_file')throw Error('lost receipt with private body');return result;});
  const entry=await enqueueObsidianDiary(source);await saveObsidianDiary(entry.id);expect((await row(entry.id)).status).toBe('uncertain');mockVault();await saveObsidianDiary(entry.id);expect((await row(entry.id)).status).toBe('written');expect(writes).toBe(1);
 });
 it('preserves an existing manual edit and the local original',async()=>{
  const entry=await enqueueObsidianDiary(source);vault.set(entry.path,'manual text');await saveObsidianDiary(entry.id);
  expect((await row(entry.id)).status).toBe('conflict');expect(writes).toBe(0);expect(vault.get(entry.path)).toBe('manual text');expect((await row(entry.id)).content).toBe(source.content);
 });
 it('coalesces concurrent saves and preserves edits made after an uncertain send',async()=>{
  const entry=await enqueueObsidianDiary(source);
  const normal=calls.getMockImplementation()!;calls.mockImplementation(async(...args)=>{const result=await normal(...args);if(args[1]==='append_to_vault_file')throw Error('lost');return result;});
  await Promise.all([saveObsidianDiary(entry.id),saveObsidianDiary(entry.id)]);expect(writes).toBe(1);
  vault.set(entry.path,entry.markdown+'人工后改');mockVault();await saveObsidianDiary(entry.id);
  expect((await row(entry.id)).status).toBe('conflict');expect(writes).toBe(1);expect(vault.get(entry.path)).toBe(entry.markdown+'人工后改');
 });
 it('retries after read-only connection failure without losing the draft',async()=>{
  const entry=await enqueueObsidianDiary(source);calls.mockResolvedValue({success:false,error:'MCP HTTP 503: private upstream response'});
  await saveObsidianDiary(entry.id);const failed=await row(entry.id);expect(failed.writeAttempted).toBe(false);expect(failed.message).toContain('503');expect(failed.message).not.toContain('private');
  mockVault();await saveObsidianDiary(entry.id);expect((await row(entry.id)).status).toBe('written');expect(writes).toBe(1);
 });
 it.each(['off','server-off','role-binding','directory','connection','deleted-role'] as const)('blocks scope changes: %s',async(mode)=>{
  const entry=await enqueueObsidianDiary(source);
  if(mode==='off')saveTarget({...target(),enabled:false});if(mode==='directory')saveTarget({...target(),directory:'different'});
  if(mode==='deleted-role')await DB.deleteCharacter(source.charId);
  if(['server-off','role-binding','connection'].includes(mode))saveMcpServers(loadMcpServers().map(s=>({...s,...(mode==='server-off'?{enabled:false}:mode==='role-binding'?{charIds:['unrelated']}:{url:'http://localhost:1/mcp'})})));
  await saveObsidianDiary(entry.id);expect((await row(entry.id)).status).toBe('blocked');expect(calls).not.toHaveBeenCalled();
 });
 it('requires exact absence and automatically adapts without legacy manual bindings',async()=>{
  const entry=await enqueueObsidianDiary(source);calls.mockResolvedValue({success:false,error:'File not found? private response'});await saveObsidianDiary(entry.id);expect((await row(entry.id)).status).toBe('blocked');expect(writes).toBe(0);
  saveTarget({...target(),createOnly:false});const b=await enqueueObsidianDiary({...source,sourceId:'automatic-contract'});mockVault();await saveObsidianDiary(b.id);expect((await row(b.id)).status).toBe('written');expect(writes).toBe(1);
 });
 it('does not re-send an uncertain write that is absent on a later read',async()=>{
  const entry=await enqueueObsidianDiary(source);await DB.saveAsset(entry.id,JSON.stringify({...entry,writeAttempted:true,target:{...entry.target,createOnly:false}}));saveTarget({...target(),createOnly:false});await saveObsidianDiary(entry.id);
  expect((await row(entry.id)).status).toBe('uncertain');expect(writes).toBe(0);
 });
 it('checks a write receipt against the complete readback',async()=>{
  const entry=await enqueueObsidianDiary(source);calls.mockImplementation(async(_s,name,args)=>name==='append_to_vault_file'?{success:true,data:'OK'}:missing(args!.path));
  await saveObsidianDiary(entry.id);expect((await row(entry.id)).status).toBe('uncertain');
 });
 it('a late cancelled call cannot mark saved and a reset epoch cannot modify restored records',async()=>{
  let release!:()=>void;const entered=new Promise<void>(resolve=>{calls.mockImplementation(async()=>{resolve();await new Promise<void>(r=>release=r);return {success:true,data:{exists:false}};});});
  const entry=await enqueueObsidianDiary(source),pending=saveObsidianDiary(entry.id);await entered;cancelObsidianDiary(entry.id);release();await pending;expect((await row(entry.id)).status).toBe('cancelled');expect(writes).toBe(0);
  const enteredAgain=new Promise<void>(resolve=>{calls.mockImplementation(async()=>{resolve();await new Promise<void>(r=>release=r);return {success:true,data:{exists:false}};});});
  const retry=saveObsidianDiary(entry.id);await enteredAgain;await DB.saveAsset(OBSIDIAN_DIARY_EPOCH,'new-archive');await DB.saveAsset(entry.id,JSON.stringify({...entry,status:'blocked',message:'restored'}));release();await retry;expect((await row(entry.id)).message).toBe('restored');
 });
 it('preserves truncated drafts without writing and normalizes restored in-flight records',async()=>{
  const entry=await enqueueObsidianDiary({...source,incomplete:true});await saveObsidianDiary(entry.id);expect((await row(entry.id)).status).toBe('blocked');expect(calls).not.toHaveBeenCalled();
  const restored=JSON.parse(restoreDiaryAsset({id:entry.id,data:JSON.stringify({...entry,status:'writing',operation:'old',leaseUntil:999})}).data);expect(restored.status).toBe('uncertain');expect(restored.operation).toBeUndefined();expect(restored.content).toBe(source.content);
 });
 it('validates paths, malformed local settings, declared parameters and private prompt scope',()=>{
  for(const value of ['../escape','C:\\vault','/root','a/../b','a//b','a/CON.md'])expect(()=>diaryDirectory(value)).toThrow();
  expect(diaryPrompt(source.charId)).toContain('OBS_DIARY_START');expect(diaryPrompt(source.charId)).not.toContain(target().directory);expect(diaryPrompt('other')).toBe('');
  const server=loadMcpServers()[0];expect(validateDiaryTools(server,{...target(),write:{...target().write,fixed:{mode:'overwrite'}}}).write.fixed).toEqual({});
  expect(()=>validateDiaryTools({...server,tools:server.tools!.slice(0,1)})).toThrow();
  expect(()=>validateDiaryTools({...server,tools:server.tools!.map(t=>({...t,annotations:{destructiveHint:true}}))})).toThrow();
  localStorage.setItem(OBSIDIAN_DIARY_KEY,JSON.stringify({charIds:null,read:null,write:7}));expect(loadObsidianDiary().charIds).toEqual([]);expect(loadObsidianDiary().write.name).toBe('');
 });
 it('round-trips text/full backup with target and original body, never restores a live operation',async()=>{
  const entry=await enqueueObsidianDiary(source);await DB.saveAsset(entry.id,JSON.stringify({...entry,status:'writing',operation:'old',leaseUntil:9999999999999}));
  const full=await DB.exportFullData(),text=stripBackupImages(structuredClone(full));
  expect(full.mcpLocal?.[OBSIDIAN_DIARY_KEY]).toBe(exportMcpLocal()?.[OBSIDIAN_DIARY_KEY]);
  expect(text.assets?.find((a:{id:string;data:string})=>a.id===entry.id)?.data).toContain(source.content.replace(/\n/g,'\\n'));
  await DB.importFullData(full as any);const restored=await row(entry.id);expect(restored.status).toBe('uncertain');expect(restored.content).toBe(source.content);expect(restored.operation).toBeUndefined();
  expect(await DB.getAsset(OBSIDIAN_DIARY_EPOCH)).toBeFalsy();
 });
 it('strips complete and truncated bodies from streaming and cloud notifications',()=>{
  const tag='[[OBS_DIARY_START: 夜晚 | 平静]]\n# 私人正文\n- 不进入聊天\n[[OBS_DIARY_END]]';
  expect(extractObsidianDiary('前文'+tag+'后文').text).toBe('前文后文');expect(extractObsidianDiary(tag).entries[0].content).toContain('# 私人正文');
  expect(computeStreamPreviewBubbles('前文\n'+tag+'\n后文\n').join('')).not.toContain('私人正文');
  const cloud=classifyLLMOutput('前文'+tag+'后文');expect(JSON.stringify(cloud)).toContain('obsidian_write_diary');expect(cloud.kind==='finish'?cloud.sanitizedBody:'unexpected').not.toContain('私人正文');
  const partial=tag.replace('[[OBS_DIARY_END]]','');expect(extractObsidianDiary(partial).entries[0].complete).toBe(false);expect(computeStreamPreviewBubbles(partial)).toEqual([]);expect(extractObsidianDiary(partial).text).not.toContain('私人正文');
 });
});
