import { buildChatRequestPayload } from './chatRequestPayload';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { DB, openDB } from './db';
import type { Message, VisionApiConfig } from '../types';
import { VISION_API_TEST_IMAGE_DATA_URL, materializeVisionDescriptions } from './visionApi';
import { collectVisionItems, describePreflightItem, commitPreflightItem, emojiVisionItems, editEmojiVision, editPreflightVision, seedVisionDescriptions, visionPreflightError } from './visionPreflight';
import { findStableVisionAsset, identifyVisionBlob, readVisionAsset, readVisionBlob, visionAssetVersion, visionCacheEpoch, VISION_CACHE_EPOCH } from './visionAssetCache';
import { isExplicitVisionRequest } from './explicitVisionAction';
import { armManualRelay, disarmManualRelay, getManualRelayState, maybeInterceptTextCompletion, noteManualRelayUserAction, cancelManualRelay } from './manualModelRelay';
import { ChatPrompts } from './chatPrompts';
import { stripBackupImages } from './backupExport';

const image = VISION_API_TEST_IMAGE_DATA_URL, char = { id: 'vision-qa', name: '合成角色', contextLimit: 500 } as any;
const config: VisionApiConfig = { enabled: false, baseUrl: 'https://vision.invalid/v1', apiKey: 'synthetic-secret', model: 'synthetic-vision' };
const source = (patch: Partial<Message> = {}) => ({ charId: char.id, role: 'user', type: 'image', content: image, timestamp: 100, ...patch } as Message);
const add = async (patch: Partial<Message> = {}) => { const row = source(patch); const id = await DB.saveMessage(row); return { ...row, id }; };
const fetchMock = () => vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
  expect(String(url)).toBe('https://vision.invalid/v1/chat/completions');
  expect(isExplicitVisionRequest(String(url), options)).toBe(true);
  expect((options as any).__sullyPrivateTransient).toBe(true);
  const body = JSON.parse(String(options?.body)); expect(body.messages).toHaveLength(1); expect(body.tools).toBeUndefined();
  expect(body.messages[0].content.some((part: any) => part.type === 'image_url' && part.image_url.url.startsWith('data:image/'))).toBe(true);
  return new Response(JSON.stringify({ choices: [{ message: { content: '白底紫色圆点，合成描述。' } }] }), { headers: { 'content-type': 'application/json' } });
});
beforeEach(async () => { vi.stubGlobal('crypto', webcrypto); disarmManualRelay(); await DB.deleteDB(); await DB.saveCharacter(char); });
afterEach(() => { disarmManualRelay(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('explicit private image preflight', () => {
  it('rejects a stale scanned asset before charging, including an edit to the same content from a different source', async () => {
    await DB.saveEmoji('合成素材',image,'default');
    const row=await add({type:'emoji',metadata:{stickerVision:{eligible:true,name:'合成表情',description:'旧消息'}}}),signal=new AbortController().signal,epoch=await visionCacheEpoch();
    await seedVisionDescriptions(collectVisionItems([row]),signal,epoch);
    const asset=await findStableVisionAsset(image,'meme-v1'),item={...collectVisionItems([row])[0],assetSnapshot:{key:asset!.key,version:visionAssetVersion(asset)}};
    await editPreflightVision(emojiVisionItems(await DB.getEmojis())[0],'另一窗口手改',signal);
    const fetch=vi.spyOn(globalThis,'fetch');
    await expect(describePreflightItem(item,config,signal,epoch,undefined,{regenerate:true})).rejects.toThrow('另一操作');
    await expect(editPreflightVision(item,'旧窗口草稿',signal)).rejects.toThrow('另一操作');
    expect(fetch).not.toHaveBeenCalled();expect((await DB.peekMessagesByCharId(char.id))[0]).toEqual(row);
  });
  it('imports only the selected remote library image on manual save, so future sends reuse bytes rather than a mutable URL', async () => {
    const remote='https://source.invalid/selected';await DB.saveEmoji('远程合成素材',remote,'default');
    const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async url=>{expect(String(url)).toBe(remote);return new Response(new Uint8Array(Buffer.from(image.split(',')[1],'base64')),{headers:{'content-type':'image/png'}});});
    const saved=await editPreflightVision(emojiVisionItems(await DB.getEmojis())[0],'人工识别的合成图',new AbortController().signal);
    expect(saved?.ref).toMatch(/^blobref:/);expect(fetch).toHaveBeenCalledTimes(1);
    const future=await add({charId:'future',type:'emoji',content:saved!.ref,metadata:{stickerVision:{eligible:true,name:'合成'}}});
    expect((await DB.peekMessagesByCharId('future')).find(row=>row.id===future.id)?.metadata?.stickerVision.description).toBe('人工识别的合成图');
    expect(await findStableVisionAsset(remote,'meme-v1')).toBeNull();expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('can repair a text-only library record even when both original bytes and its old asset cache are missing', async () => {
    const key='vision-cache:meme-v1:'+'a'.repeat(64),db=await openDB();
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction('emojis','readwrite');tx.objectStore('emojis').put({name:'合成缺图',url:'',categoryId:'default',vision:{key,semantics:'meme-v1',description:'原描述',origin:'message',updatedAt:1}});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
    const fetch=vi.spyOn(globalThis,'fetch');const saved=await editPreflightVision(emojiVisionItems(await DB.getEmojis())[0],'缺图人工修正',new AbortController().signal);
    expect(saved?.description).toBe('缺图人工修正');expect((await readVisionAsset(key))?.description).toBe('缺图人工修正');expect(fetch).not.toHaveBeenCalled();
  });
  it('explicitly regenerates a described item exactly once and atomically repairs only the selected snapshot plus known library assets', async () => {
    await DB.saveEmoji('素材甲',image,'default');await DB.saveEmoji('别名',image,'default');
    const rows=[await add({type:'emoji',metadata:{keep:'untouched',stickerVision:{eligible:true,name:'合成',description:'历史描述'}}}),await add({type:'emoji',metadata:{stickerVision:{eligible:true,name:'合成',description:'历史描述'}}})];
    let item=collectVisionItems(rows)[0];const signal=new AbortController().signal,epoch=await visionCacheEpoch();
    await seedVisionDescriptions([item],signal,epoch);
    const fetch=fetchMock(),asset=await describePreflightItem(item,config,signal,epoch,undefined,{regenerate:true});
    expect(fetch).toHaveBeenCalledTimes(1);expect((await findStableVisionAsset(image,'meme-v1'))?.description).toBe('历史描述');
    const saved=await commitPreflightItem(item,asset,epoch,signal);item=saved.item;
    const stored=await DB.peekMessagesByCharId(char.id);
    expect(stored[0]).toMatchObject({id:rows[0].id,content:image,timestamp:100,metadata:{keep:'untouched',stickerVision:{eligible:true,description:'白底紫色圆点，合成描述。'}}});
    expect(stored[1]).toEqual(rows[1]);expect((await DB.getEmojis()).every(row=>row.vision?.description===saved.description)).toBe(true);
    const newId=await DB.saveMessage(source({charId:'second-role',type:'emoji',metadata:{stickerVision:{eligible:true,name:'新合成'}}}));
    expect((await DB.peekMessagesByCharId('second-role')).find(row=>row.id===newId)?.metadata?.stickerVision.description).toBe(saved.description);
    armManualRelay();const payload=await buildChatRequestPayload({char,userProfile:{name:'合成用户'} as any,groups:[],emojis:[],categories:[],historyMsgs:[stored[0]],contextLimit:500,disableTools:true,visionApiConfig:config,realtimeConfig:{weatherEnabled:false,newsEnabled:false} as any});
    expect(JSON.stringify(payload.fullMessages)).toContain(saved.description);expect(fetch).toHaveBeenCalledTimes(1);
    await seedVisionDescriptions([collectVisionItems(rows)[1]],signal,epoch);expect((await findStableVisionAsset(image,'meme-v1'))?.description).toBe(saved.description);
  });
  it('lets an explicit new regeneration replace manual text, but rejects a late result after a newer manual edit or source change', async () => {
    await DB.saveEmoji('素材',image,'default');let item=emojiVisionItems(await DB.getEmojis())[0];const signal=new AbortController().signal,epoch=await visionCacheEpoch();
    const first=await editPreflightVision(item,'人工一',signal);item=first!.item;fetchMock();
    const candidate=await describePreflightItem(item,config,signal,epoch,undefined,{regenerate:true});
    const edited=await editPreflightVision(item,'人工二',signal);
    await expect(commitPreflightItem(item,candidate,epoch,signal)).rejects.toThrow('另一操作');
    expect((await findStableVisionAsset(image,'meme-v1'))?.description).toBe('人工二');
    item=edited!.item;const next=await describePreflightItem(item,config,signal,epoch,undefined,{regenerate:true});
    expect((await commitPreflightItem(item,next,epoch,signal)).description).toContain('紫色圆点');
    const msg=await add({type:'emoji',metadata:{stickerVision:{eligible:false,description:'原描述'}}}),sourceItem=collectVisionItems([msg])[0];
    const pending=await describePreflightItem(sourceItem,config,signal,epoch,undefined,{regenerate:true});await DB.updateMessage(msg.id,image+'changed');
    const before=(await findStableVisionAsset(image,'meme-v1'))?.description;
    await expect(commitPreflightItem(sourceItem,pending,epoch,signal)).rejects.toThrow('已变化');expect((await findStableVisionAsset(image,'meme-v1'))?.description).toBe(before);
  });
  it('preserves old text on invalid regeneration/cancel/epoch replacement and never retries automatically', async () => {
    const row=await add({metadata:{visionDescription:'有效旧描述'}}),item=collectVisionItems([row])[0],signal=new AbortController().signal,epoch=await visionCacheEpoch();
    await seedVisionDescriptions([item],signal,epoch);
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:'',reasoning_content:'合成分析通道'},finish_reason:'length'}]}),{headers:{'content-type':'application/json'}}));
    await expect(describePreflightItem(item,config,signal,epoch,undefined,{regenerate:true})).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
    expect((await findStableVisionAsset(image,'photo-v1'))?.description).toBe('有效旧描述');expect((await DB.peekMessagesByCharId(char.id))[0]).toEqual(row);
    fetch.mockRestore();fetchMock();const candidate=await describePreflightItem(item,config,signal,epoch,undefined,{regenerate:true});
    const ac=new AbortController();ac.abort();await expect(commitPreflightItem(item,candidate,epoch,ac.signal)).rejects.toMatchObject({name:'AbortError'});
    const full=await DB.exportFullData();await DB.importFullData(full as any);await expect(commitPreflightItem(item,candidate,epoch,signal)).rejects.toMatchObject({name:'AbortError'});
  });
  it('keeps full manual text, refuses over-limit input, skips unchanged saves, and respects intentional blank on default fill and relay', async () => {
    const row=await add({type:'emoji',metadata:{stickerVision:{eligible:true,name:'合成',description:'原描述'}}});let item=collectVisionItems([row])[0];const signal=new AbortController().signal;
    const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('不得调用'));
    expect(await editPreflightVision(item,item.description,signal)).toBeNull();
    await expect(editPreflightVision(item,'长'.repeat(4001),signal)).rejects.toThrow('最多4000');
    const text='  '+ '长'.repeat(3990)+'\n尾部  ';const saved=await editPreflightVision(item,text,signal);expect(saved?.description).toBe(text);item=saved!.item;
    const blank=await editPreflightVision(item,' \n ',signal);expect(blank?.item.manualBlank).toBe(true);
    const persisted=(await DB.peekMessagesByCharId(char.id))[0];expect(persisted.metadata?.stickerVision.eligible).toBe(true);
    const epoch=await visionCacheEpoch();expect((await describePreflightItem(blank!.item,config,signal,epoch)).description).toBe('');
    const {materializeStickerVisionDescriptions}=await import('./visionApi');await materializeStickerVisionDescriptions([persisted],{...config,enabled:true});
    const newId=await DB.saveMessage(source({charId:'blank-role',type:'emoji',metadata:{stickerVision:{eligible:true,name:'新合成'}}}));
    const future=(await DB.peekMessagesByCharId('blank-role')).find(row=>row.id===newId)!;expect(future.metadata?.visionPreflightState.sticker.manualBlank).toBe(true);
    armManualRelay();await expect(buildChatRequestPayload({char,userProfile:{name:'合成用户'} as any,groups:[],emojis:[],categories:[],historyMsgs:[persisted],contextLimit:500,disableTools:true,visionApiConfig:config,realtimeConfig:{weatherEnabled:false,newsEnabled:false} as any})).resolves.toBeDefined();expect(fetch).not.toHaveBeenCalled();
  });
  it('edits missing originals and forward snapshots without inventing identity, changing eligibility or overwriting unselected history', async () => {
    const row=await add({content:'',type:'emoji',metadata:{stickerVision:{eligible:false,name:'旧合成',description:'原图已丢失的旧描述'},keep:7}}),signal=new AbortController().signal;
    const item=collectVisionItems([row])[0];const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('不得调用'));
    const saved=await editPreflightVision(item,'完整人工修正',signal);expect(saved?.description).toBe('完整人工修正');expect((await DB.peekMessagesByCharId(char.id))[0]).toMatchObject({content:'',timestamp:100,metadata:{keep:7,stickerVision:{eligible:false,description:'完整人工修正'}}});
    await expect(describePreflightItem(saved!.item,config,signal,await visionCacheEpoch(),undefined,{regenerate:true})).rejects.toThrow('原图');
    const forward=await add({type:'chat_forward',content:JSON.stringify({messages:[{type:'emoji',content:image,stickerVision:{eligible:true,description:'转发冻结描述'}}]})});
    const before=forward.content,updated=await editPreflightVision(collectVisionItems([forward])[0],'',signal);expect(updated?.description).toBe('');
    const stored=(await DB.peekMessagesByCharId(char.id)).find(row=>row.id===forward.id)!;expect(stored.content).toBe(before);expect(collectVisionItems([stored])[0].description).toBe('');
    const prompt=JSON.stringify(ChatPrompts.buildMessageHistory([stored],10,char,{name:'合成用户'} as any,[],undefined,{useVisionDescriptions:true}).apiMessages);expect(prompt).not.toContain('转发冻结描述');expect(fetch).not.toHaveBeenCalled();
  });
  it('deduplicates selected messages, persists exact metadata only, then restores text for relay with Vision OFF', async () => {
    const rows = [await add(), await add()], items = collectVisionItems(rows), fetch = fetchMock(), epoch = await visionCacheEpoch(), signal = new AbortController().signal;
    armManualRelay();
    for (const item of items) await commitPreflightItem(item, await describePreflightItem(item, config, signal, epoch), epoch, signal);
    expect(fetch).toHaveBeenCalledTimes(1); expect(getManualRelayState().status).toBe('armed');
    const saved = await DB.peekMessagesByCharId(char.id); expect(saved).toHaveLength(2);
    expect(saved.map(m => [m.id, m.content, m.timestamp])).toEqual(rows.map(m => [m.id, m.content, m.timestamp]));
    for (const message of saved) expect(message.metadata?.visionDescription).toContain('紫色圆点');
    expect(await describePreflightItem(items[0], undefined, signal, epoch)).toMatchObject({ description: expect.stringContaining('紫色圆点') });
    expect(fetch).toHaveBeenCalledTimes(1);
    const prompt = ChatPrompts.buildMessageHistory(saved, 10, char, { name: '合成用户' } as any, [], undefined, { useVisionDescriptions: true });
    expect(JSON.stringify(prompt.apiMessages)).not.toContain('image_url'); expect(JSON.stringify(prompt.apiMessages)).toContain('紫色圆点');
  });
  it('does not automatically retry a failed same-asset request within a batch', async () => {
    const items = collectVisionItems([await add(), await add()]), signal = new AbortController().signal, epoch = await visionCacheEpoch(), failures = new Set<string>();
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'synthetic unavailable' }), { status: 429, headers: { 'content-type': 'application/json' } }));
    await expect(describePreflightItem(items[0], config, signal, epoch, failures)).rejects.toThrow();
    await expect(describePreflightItem(items[1], config, signal, epoch, failures)).rejects.toThrow('本批识图已失败');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('never borrows the manual waiting slot or automatically charges when ordinary materialization runs', async () => {
    const row = await add(), item = collectVisionItems([row])[0], fetch = fetchMock(); armManualRelay(); noteManualRelayUserAction();
    const waiting = maybeInterceptTextCompletion({ body: { messages: [{ role: 'user', content: '合成等待正文' }] } })!;
    const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' }); const id = getManualRelayState().request!.id;
    await materializeVisionDescriptions([row], { ...config, enabled: true }); expect(fetch).not.toHaveBeenCalled();
    const epoch = await visionCacheEpoch(), signal = new AbortController().signal;
    await commitPreflightItem(item, await describePreflightItem(item, config, signal, epoch), epoch, signal);
    expect(getManualRelayState().request?.id).toBe(id); expect(fetch).toHaveBeenCalledTimes(1); cancelManualRelay(id); await rejected;
  });
  it('separates photo and meme semantics, snapshots eligible new sends across roles, and preserves old ineligible history', async () => {
    const rows = [await add(), await add({ type: 'emoji', metadata: { stickerVision: { eligible: true, name: '合成表情' } } })];
    const epoch = await visionCacheEpoch(), signal = new AbortController().signal, fetch = fetchMock();
    for (const item of collectVisionItems(rows)) await commitPreflightItem(item, await describePreflightItem(item, config, signal, epoch), epoch, signal);
    expect(fetch).toHaveBeenCalledTimes(2);
    const other = await add({ charId: 'other', type: 'emoji', metadata: { stickerVision: { eligible: true, name: '不同名称' } } });
    const old = await add({ type: 'emoji' });
    const saved = await DB.peekMessagesByCharId('other'); expect(saved[0].metadata?.stickerVision.description).toContain('紫色圆点');
    expect((await DB.peekMessagesByCharId(char.id)).find(m => m.id === old.id)?.metadata?.stickerVision).toBeUndefined(); expect(other.content).toBe(image);
  });
  it('reuses selected-scope old successful descriptions without calling a model; manual edits win and survive rename/category moves', async () => {
    const old = await add({ type: 'emoji', metadata: { stickerVision: { eligible: true, description: '旧消息已成功的描述', name: '旧名' } } });
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('禁止请求')); const signal = new AbortController().signal, epoch = await visionCacheEpoch();
    await seedVisionDescriptions(collectVisionItems([old]), signal, epoch);
    await DB.saveEmoji('素材甲', image, 'cat-a'); let item = emojiVisionItems(await DB.getEmojis())[0];
    const asset = await describePreflightItem(item, undefined, signal, epoch); expect(asset.description).toBe('旧消息已成功的描述'); await commitPreflightItem(item, asset, epoch, signal);
    item = emojiVisionItems(await DB.getEmojis())[0];
    await editEmojiVision(item, '手动改过的素材说明', signal); await DB.renameEmoji('素材甲', '素材乙'); await DB.saveEmoji('素材乙', image, 'cat-b');
    expect((await DB.getEmojis())[0]).toMatchObject({ name: '素材乙', categoryId: 'cat-b', vision: { description: '手动改过的素材说明', origin: 'manual' } });
    expect((await findStableVisionAsset(image, 'meme-v1'))?.description).toBe('手动改过的素材说明');
    expect((await DB.peekMessagesByCharId(char.id))[0].metadata?.stickerVision.description).toBe('旧消息已成功的描述'); expect(fetch).not.toHaveBeenCalled();
    await DB.saveEmoji('素材乙', image + '#replacement', 'cat-b'); expect((await DB.getEmojis())[0].vision).toBeUndefined();
  });
  it('does not report success after a source edit, deletion, cancelled signal or archive epoch change', async () => {
    const row = await add(), item = collectVisionItems([row])[0], signal = new AbortController().signal, epoch = await visionCacheEpoch(); fetchMock();
    const asset = await describePreflightItem(item, config, signal, epoch);
    await DB.updateMessage(row.id, image + 'changed'); await expect(commitPreflightItem(item, asset, epoch, signal)).rejects.toThrow('已变化');
    const ac = new AbortController(); ac.abort(); await expect(commitPreflightItem(item, asset, epoch, ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const db = await openDB(); await new Promise<void>((resolve, reject) => { const tx = db.transaction('assets', 'readwrite'); tx.objectStore('assets').delete(VISION_CACHE_EPOCH); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    await visionCacheEpoch(); await expect(commitPreflightItem(item, asset, epoch, signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('retains only message-local forward/share descriptions and ignores old ineligible stickers by default', () => {
    const rows = [source({ id: 1, type: 'emoji' }), source({ id: 2, type: 'friend_feed_share_card', metadata: { friendFeedShare: { imagesEnabled: true, imageRefs: [image], originalComments: [], comments: [], imageCount: 1 } } }), source({ id: 3, type: 'chat_forward', content: JSON.stringify({ messages: [{ type: 'emoji', content: image, stickerVision: { eligible: true } }, { type: 'emoji', content: image }] }) })];
    const items = collectVisionItems(rows); expect(items.map(i => i.path)).toEqual(['sticker', 'share:0', 'forward:0']); expect(items[0].eligible).toBe(false);
  });
  it('builds the actual text-relay payload from saved photo/share/forward text with Vision disabled and rejects missing preflight without charging', async () => {
    const rows = [await add(), await add({ type: 'friend_feed_share_card', content: '合成分享', metadata: { friendFeedShare: { imagesEnabled: true, imageRefs: [image], originalComments: [], comments: [], imageCount: 1 } } }), await add({ type: 'chat_forward', content: JSON.stringify({ messages: [{ role: 'user', type: 'emoji', content: image, stickerVision: { eligible: true } }] }) })];
    const epoch = await visionCacheEpoch(), signal = new AbortController().signal, fetch = fetchMock(); armManualRelay();
    const input = { char, userProfile: { name: '合成用户' } as any, groups: [], emojis: [], categories: [], historyMsgs: rows, contextLimit: 500, disableTools: true, visionApiConfig: config, realtimeConfig: { weatherEnabled: false, newsEnabled: false } as any };
    await expect(buildChatRequestPayload(input)).rejects.toThrow('补全图片描述'); expect(fetch).not.toHaveBeenCalled();
    for (const item of collectVisionItems(rows)) await commitPreflightItem(item, await describePreflightItem(item, config, signal, epoch), epoch, signal);
    const count = fetch.mock.calls.length;
    const payload = await buildChatRequestPayload({ ...input, historyMsgs: await DB.peekMessagesByCharId(char.id) });
    const text = JSON.stringify(payload.fullMessages); expect(text).not.toContain('image_url'); expect(text).not.toContain('base64,'); expect(text).toContain('紫色圆点'); expect(fetch).toHaveBeenCalledTimes(count);
  });
  it('keeps description data through text/full backup and rejects a restored runtime epoch', async () => {
    const item = collectVisionItems([await add()])[0], signal = new AbortController().signal, epoch = await visionCacheEpoch(); fetchMock();
    await commitPreflightItem(item, await describePreflightItem(item, config, signal, epoch), epoch, signal);
    const text = stripBackupImages(await DB.exportFullData()); expect(text.messages[0].metadata.visionDescription).toContain('紫色圆点'); expect(text.messages[0].content).toBe('');
    const full = await DB.exportFullData(); await DB.importFullData(full as any); expect(await visionCacheEpoch()).not.toBe(epoch);
    expect((await findStableVisionAsset(image, 'photo-v1'))?.description).toContain('紫色圆点');
  });
  it('treats a remote URL as a locator and detects changed bytes instead of reusing its prior identity', async () => {
    let blue = false, paid = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
      if (String(url) === 'https://source.invalid/mutable') return new Response(blue ? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAIAAAAUMWhjAAAANElEQVR4nGPUqHjGQEvARFPTGUYtIAKMxgFBMBpEBMFoEBEEo0FEEIwGEUEwGkQEAc2DCAC68AG2ucj3qgAAAABJRU5ErkJggg==', 'base64') : new Uint8Array(Buffer.from(image.split(',')[1], 'base64')), { headers: { 'content-type': 'image/png' } });
      paid++; return new Response(JSON.stringify({ choices: [{ message: { content: blue ? '合成蓝色图' : '合成紫点图' } }] }), { headers: { 'content-type': 'application/json' } });
    });
    const item = { ...collectVisionItems([source({ id: 1 })])[0], ref: 'https://source.invalid/mutable' }, signal = new AbortController().signal, epoch = await visionCacheEpoch();
    const first = await describePreflightItem(item, config, signal, epoch); blue = true;
    const next = await describePreflightItem(item, config, signal, epoch); expect(next.key).not.toBe(first.key); expect(paid).toBe(2); expect(await findStableVisionAsset(item.ref, 'photo-v1')).toBeNull();
  });
  it('resolves a scanned remote locator at action time without blocking its existing content cache, while rejecting a late replacement', async () => {
    const remote = 'https://source.invalid/existing', signal = new AbortController().signal, epoch = await visionCacheEpoch();
    const local = collectVisionItems([await add()])[0];
    await editPreflightVision(local, '同字节已有描述', signal);
    let paid = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
      if (String(url) === remote) return new Response(new Uint8Array(Buffer.from(image.split(',')[1], 'base64')), { headers: { 'content-type': 'image/png' } });
      paid++; return new Response(JSON.stringify({ choices: [{ message: { content: '显式远程新描述' } }] }), { headers: { 'content-type': 'application/json' } });
    });
    const item = { ...collectVisionItems([await add({ content: remote })])[0], assetSnapshot: { key: null, version: null } };
    const candidate = await describePreflightItem(item, config, signal, epoch, undefined, { regenerate: true });
    expect(paid).toBe(1); expect(candidate.description).toBe('显式远程新描述');
    await editPreflightVision(item, '识图期间的新手改', signal);
    await expect(commitPreflightItem(item, candidate, epoch, signal)).rejects.toThrow('另一操作');
    expect((await findStableVisionAsset(image, 'photo-v1'))?.description).toBe('识图期间的新手改');
    const fresh = { ...collectVisionItems((await DB.peekMessagesByCharId(char.id)).filter(row => row.content === remote))[0], assetSnapshot: { key: null, version: null } };
    const saved = await commitPreflightItem(fresh, await describePreflightItem(fresh, config, signal, epoch, undefined, { regenerate: true }), epoch, signal);
    expect(saved.description).toBe('显式远程新描述'); expect(paid).toBe(2); expect(await findStableVisionAsset(remote, 'photo-v1')).toBeNull();
  });
  it('reports a failed message transaction without losing the original and retries from the saved asset without another model request', async () => {
    const row = await add(), item = collectVisionItems([row])[0], signal = new AbortController().signal, epoch = await visionCacheEpoch(), fetch = fetchMock();
    const asset = await describePreflightItem(item, config, signal, epoch), original = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value: any, key?: IDBValidKey) { if (this.name === 'messages') throw new DOMException('synthetic quota', 'QuotaExceededError'); return original.call(this, value, key); });
    await expect(commitPreflightItem(item, asset, epoch, signal)).rejects.toMatchObject({ name: 'QuotaExceededError' }); put.mockRestore();
    expect((await DB.peekMessagesByCharId(char.id))[0].metadata?.visionDescription).toBeUndefined();
    await commitPreflightItem(item, await describePreflightItem(item, config, signal, epoch), epoch, signal); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps failure diagnostics content-free and rejects missing originals before a paid call', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('禁止请求'));
    await expect(readVisionBlob('blobref:b_missing')).rejects.toThrow('原图已不可用'); expect(fetch).not.toHaveBeenCalled();
    expect(visionPreflightError(Error('HTTP 429 sk-private-secret data:image/png;base64,PRIVATE'))).toBe('识图请求失败（HTTP 429），请检查配置、额度或服务后重试');
    expect(visionPreflightError(Error('https://private.invalid/secret'))).not.toContain('private');
  });
  it('accepts long ordinary text/URLs while genuine media and tools remain rejected without rewriting', () => {
    armManualRelay(); noteManualRelayUserAction(); const content = 'https://example.invalid/' + 'A'.repeat(300) + '\n' + '1234567890'.repeat(100);
    const task = maybeInterceptTextCompletion({ body: { messages: [{ role: 'user', content }] } })!;
    expect(getManualRelayState().request?.messages[0].content).toBe(content); const reject = expect(task).rejects.toMatchObject({ name: 'AbortError' }); cancelManualRelay(getManualRelayState().request!.id);
    noteManualRelayUserAction(); expect(() => maybeInterceptTextCompletion({ body: { messages: [{ role: 'user', content: image }] } })).toThrow('媒体引用'); return reject;
  });
});
