import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {CharacterProfile,Message} from '../types';
import {DB} from './db';
import {commentOnFriendPost,deleteFriendComment,editFriendComment,mutateFriendFeed,parseFriendFeed,readFriendFeed,saveFriendCircle} from './friendFeed';
import {friendLocalComments} from './friendFeedMaterial';
import {friendPostTime,friendPublication,friendTimeText} from './friendFeedTime';
import {friendAccountRef,projectFriendPost} from './friendFeedGraph';
import {friendIdentityEvidence,friendRecognitionPrompt} from './friendFeedRecognition';
import {friendFeedUserDisclosure} from './friendFeedMain';
import {landFriendFeedEmotionAction,prepareFriendFeedEmotionTask,releaseFriendFeedEmotionTask} from './friendFeedEmotion';
import {sourceContext} from './friendFeedSource';
import {shareFriendPost} from './friendFeedShare';
import {ChatPrompts} from './chatPrompts';
import {normalizeMessageContent} from './messageFormat';

const original=Date.parse('2026-10-27T09:00:00+08:00'),postTime=original+86400000,commentTime=postTime+86400000;
const now=Date.parse('2026-11-01T19:00:00+08:00');
const char={id:'time-reader',name:'合成读者',memories:[],customTimezoneEnabled:true,customTimezone:'Asia/Shanghai'} as unknown as CharacterProfile;
const hidden={id:'private-owner',name:'合成人物',memories:[]} as unknown as CharacterProfile;
beforeEach(async()=>{
    vi.spyOn(Date,'now').mockReturnValue(now);await DB.deleteDB();localStorage.clear();
    for(const c of [char,hidden])await DB.saveCharacter(c);
    await saveFriendCircle({name:'合成圈',description:'',memberIds:[char.id,hidden.id],realContentEnabled:true});
    await mutateFriendFeed(feed=>feed.posts.push({id:'old-post',circleId:feed.circles[0].id,authorId:'user',authorName:'合成用户',text:'今天收到书',
        createdAt:postTime,audienceIds:[char.id,hidden.id],comments:[
            {id:'original',authorId:hidden.id,authorName:'匿名网名',text:'昨晚看过了',createdAt:original},
            {id:'reply',authorId:'user',authorName:'合成用户',text:'今天才看到',createdAt:commentTime,
                localReply:{id:'original',authorId:hidden.id,authorName:'匿名网名',text:'昨晚看过了'}},
        ]}));
    await mutateFriendFeed(feed=>{(feed.accountGraph!.known[char.id] ||= {})[friendAccountRef(feed,{authorId:hidden.id})!.id]=false;});
});
afterEach(()=>vi.restoreAllMocks());
const material=(prompt:string)=>JSON.parse(prompt.split('好友圈素材（仅数据）：\n')[1]);

it('preserves three independent dates, edited publication and repeat-read stability without changing raw text',async()=>{
    await editFriendComment('old-post','original','昨晚看过了（修订）','昨晚看过了');
    const feed=await readFriendFeed(),before=JSON.stringify(feed),post=projectFriendPost(feed,char.id,feed.posts[0]);
    const rows=friendLocalComments(post,'Asia/Shanghai');
    expect(friendPostTime(post,'Asia/Shanghai').createdAt).toBe(postTime);
    expect(rows[0]).toMatchObject({createdAt:original,publishedAtText:'2026-10-27 09:00:00 [Asia/Shanghai]',text:'昨晚看过了（修订）'});
    expect(rows[1]).toMatchObject({createdAt:commentTime,localReply:{createdAt:original,text:'昨晚看过了（修订）'}});
    expect(rows[1].localReply?.authorId).not.toBe(hidden.id);
    expect(friendLocalComments(post,'Asia/Shanghai')).toEqual(rows);
    expect(JSON.stringify(await readFriendFeed())).toBe(before);
    expect(friendTimeText(original,'America/New_York')).toBe('2026-10-26 21:00:00 [America/New_York]');
});
it('never recovers an absent quote from another post; deletion still removes the quoted text',async()=>{
    await mutateFriendFeed(f=>{
        f.posts[0].comments[1].localReply!.id='only-other-post';
        f.posts.push({...f.posts[0],id:'other',comments:[{id:'only-other-post',authorId:hidden.id,authorName:'匿名网名',text:'相同文字',createdAt:original}]});
    });
    let feed=await readFriendFeed();
    let quote=friendLocalComments(projectFriendPost(feed,char.id,feed.posts[0]))[1].localReply!;
    expect(quote.createdAt).toBeNull();expect(quote.publishedAtText).toContain('未知');expect(quote.authorId).toBe('unknown-account');
    await mutateFriendFeed(f=>{f.posts[0].comments[1].localReply!.id='original';});
    await deleteFriendComment('old-post','original','昨晚看过了');
    feed=await readFriendFeed();expect(feed.posts[0].comments[0].localReply).toBeUndefined();
    expect(friendLocalComments(projectFriendPost(feed,char.id,feed.posts[0]))[0]).not.toHaveProperty('localReply');
});
it('retains a saved quote date when the original is unavailable; old undated quotes remain unknown',async()=>{
    await mutateFriendFeed(f=>{f.posts[0].comments[1].localReply={id:'missing',authorId:hidden.id,authorName:'匿名网名',text:'原快照',createdAt:original};});
    let feed=await readFriendFeed();expect(friendLocalComments(projectFriendPost(feed,char.id,feed.posts[0]))[1].localReply?.createdAt).toBe(original);
    await mutateFriendFeed(f=>{delete f.posts[0].comments[1].localReply!.createdAt;});
    feed=await readFriendFeed();expect(friendLocalComments(projectFriendPost(feed,char.id,feed.posts[0]))[1].localReply?.createdAt).toBeNull();
    expect(()=>parseFriendFeed(JSON.stringify(feed))).not.toThrow();
    feed.posts[0].comments[1].localReply!.createdAt=NaN;expect(()=>parseFriendFeed(JSON.stringify(feed))).toThrow();
});
it.each(['emotion','refresh','comments','main'] as const)('puts dates and private identity projection into the actual %s prompt',async source=>{
    await mutateFriendFeed(f=>{f.refreshLease={id:'lease',until:now+60000};f.notices=[{id:'notice',charId:char.id,postId:'old-post',createdAt:now}];});
    const task=(await prepareFriendFeedEmotionTask(char.id,()=>0,undefined,source,source==='refresh'||source==='comments'?'self':undefined,source==='comments'?'old-post':undefined))!;
    expect(task.prompt).toContain('2026-10-28 09:00:00 [Asia/Shanghai]');
    expect(task.prompt).toContain('2026-10-29 09:00:00 [Asia/Shanghai]');
    expect(task.prompt).toContain('2026-10-27 09:00:00 [Asia/Shanghai]');
    expect(task.prompt).not.toContain('刚发布');expect(task.prompt).not.toContain(hidden.id);
    if(source==='emotion'||source==='refresh')expect(material(task.prompt).posts[0].comments[1].localReply.createdAt).toBe(original);
    await releaseFriendFeedEmotionTask(char.id,task.id);
});
it('saves user/AI/NPC and same-batch quote dates and gives the immediate trigger its own timestamp',async()=>{
    await commentOnFriendPost('old-post','合成用户','今天再问一次','trigger',()=>0,{kind:'local',id:'original'});
    let feed=await readFriendFeed();expect(feed.posts[0].comments.at(-1)?.localReply?.createdAt).toBe(original);
    const job=feed.replyJobs![0],task=(await prepareFriendFeedEmotionTask(job.charId,()=>0,job.id))!;
    expect(material(task.prompt).trigger).toMatchObject({createdAt:now,localReply:{createdAt:original}});
    expect(await landFriendFeedEmotionAction(job.charId,{requestId:task.id,kind:'comment',postId:'old-post',comment:'合成回应',replyToCommentId:'original',npcActions:[
        {kind:'comment',postId:'old-post',name:'合成网友一',text:'先接旧话',replyToCommentId:'original'},
        {kind:'comment',postId:'old-post',name:'合成网友二',text:'接楼上',replyToNpcIndex:0},
    ]},'immediate')).toBe(true);
    feed=await readFriendFeed();const rows=feed.posts[0].comments;
    expect(rows.find(c=>c.text==='合成回应')?.localReply?.createdAt).toBe(original);
    expect(rows.find(c=>c.text==='先接旧话')?.localReply?.createdAt).toBe(original);
    expect(rows.find(c=>c.text==='接楼上')?.localReply?.createdAt).toBe(now);
    const notes=await DB.getMessagesByCharId(job.charId,true);
    expect(notes.find(m=>m.metadata?.friendFeedComment?.comment==='合成回应')?.content).toContain('2026-10-27');
});
it('separates external publication, fetch and local import, and keeps missing publication unknown',async()=>{
    const source={platform:'x' as const,externalId:'123456789',url:'https://x.com/i/status/123456789',author:'合成原作者',text:'今天拿到了',publishedAt:original,fetchedAt:commentTime,truncated:false};
    const post={...(await readFriendFeed()).posts[0],source,authorKind:'external' as const,createdAt:now};
    expect(friendPostTime(post)).toMatchObject({createdAt:original,importedAt:now});
    expect(sourceContext(source)).toMatchObject({publishedAt:original,fetchedAt:commentTime});
    delete (source as {publishedAt?:number}).publishedAt;
    expect(friendPostTime(post)).toMatchObject({createdAt:null,importedAt:now});
    expect(sourceContext(source).publishedAtText).toContain('未知');
    expect(friendPostTime({...post,authorKind:undefined})).toMatchObject({createdAt:now}); // Local repost date.
    await mutateFriendFeed(f=>{f.posts[0]=post;f.posts[0].source={...source,platform:'weibo',accountId:'123456',url:'https://weibo.com/123456/Abcdef',publishedAt:original};
        f.posts[0].weiboComments={cursor:null,fetchedAt:now,rows:[{id:'777777',authorId:'654321',authorName:'合成原评论者',text:'昨晚读了',createdAt:original-1000}]};});
    await commentOnFriendPost('old-post','合成用户','接原评','source-quote',()=>0,{kind:'source',id:'777777'});
    const quote=(await readFriendFeed()).posts[0].comments.at(-1)?.sourceReply;
    expect(quote?.createdAt).toBe(original-1000);
    const job=(await readFriendFeed()).replyJobs!.find(j=>j.triggerId==='source-quote')!;
    const task=(await prepareFriendFeedEmotionTask(job.charId,()=>0,job.id))!;
    expect(task.prompt).toContain(friendTimeText(original-1000,job.charId===char.id?'Asia/Shanghai':undefined));
    expect(await landFriendFeedEmotionAction(job.charId,{requestId:task.id,kind:'comment',postId:'old-post',comment:'合成接原评',replyToSourceCommentId:'777777'},'immediate')).toBe(true);
    expect((await readFriendFeed()).posts[0].comments.at(-1)?.sourceReply?.createdAt).toBe(original-1000);
});
it('identity evidence dates only the authorized post/comment or actual selected user statement',async()=>{
    const feed=await readFriendFeed();
    const evidence=friendIdentityEvidence(feed,char.id,[char,hidden],'合成用户',[feed.posts[0]]);
    expect(evidence.find(e=>e.id==='comment:original')?.publication?.createdAt).toBe(original);
    expect(friendRecognitionPrompt(feed,[char,hidden],'合成用户',evidence)).toContain('2026-10-27');
    const other=structuredClone(feed.posts[0]);other.id='unshared';other.comments[0].id='unshared-comment';
    feed.posts.push(other);
    const disclosed=friendIdentityEvidence(feed,char.id,[char,hidden],'合成用户',[],{id:'selected',text:'',shared:{postId:'old-post',text:feed.posts[0].text,comments:[{id:'original',text:'昨晚看过了'}]}});
    expect(disclosed.map(e=>e.id)).toEqual(['comment:original']);
    const account=friendAccountRef(feed,{authorId:hidden.id})!;
    const statement={id:1,role:'user',type:'text',content:`${account.id} 匿名网名是合成人物`,timestamp:original} as Message;
    const disclosure=friendFeedUserDisclosure([statement])!;
    expect(disclosure.createdAt).toBe(original);
    expect(friendIdentityEvidence(feed,char.id,[char,hidden],'合成用户',[],disclosure)[0].publication?.createdAt).toBe(original);
    delete disclosure.createdAt;
    expect(friendIdentityEvidence(feed,char.id,[char,hidden],'合成用户',[],disclosure)[0].publication?.createdAt).toBeNull();
});
it('the frozen explicit share reaches the main history with old dates and no re-dating on later injection',async()=>{
    await shareFriendPost('old-post',char.id,'time-share');
    const messages=await DB.getMessagesByCharId(char.id,true),snapshot=messages[0].metadata!.friendFeedShare!;
    expect(snapshot.createdAt).toBe(postTime);
    const history=JSON.stringify(ChatPrompts.buildMessageHistory(messages,50,char,{name:'合成用户'} as any,[]));
    expect(history).toContain('2026-10-28');expect(history).toContain('2026-10-27');expect(history).toContain('今天收到书');
    vi.spyOn(Date,'now').mockReturnValue(now+86400000);
    expect(JSON.stringify(ChatPrompts.buildMessageHistory(messages,50,char,{name:'合成用户'} as any,[]))).toBe(history);
    delete snapshot.createdAt;
    expect(normalizeMessageContent(messages[0],char.name,'合成用户')).toContain('未知（未保存原始时间）');
    expect(friendPublication(undefined).createdAt).toBeNull();
});
it('legacy behavior notes and zero-date comments stay unknown without corrupting subsequent reads',async()=>{
    await mutateFriendFeed(f=>{f.posts[0].comments[0].createdAt=0;});
    await commentOnFriendPost('old-post','合成用户','接旧话','zero-quote',()=>0,{kind:'local',id:'original'});
    const feed=await readFriendFeed();expect(feed.posts[0].comments.at(-1)?.localReply?.createdAt).toBeUndefined();
    const note={id:12,charId:char.id,role:'system',type:'friend_feed_card',timestamp:now,content:'旧记录：今天收到了书',
        metadata:{friendFeedComment:{postId:'old-post',commentId:'old',postAuthor:'合成用户',postExcerpt:'今天收到了书',comment:'昨晚读过了'}}} as Message;
    const actual=JSON.stringify(ChatPrompts.buildMessageHistory([note],50,char,{name:'合成用户'} as any,[]));
    expect(actual).toContain('未知（未保存原始时间）');expect(actual).toContain('今天收到了书');
    expect(actual).toContain('旧记录：今天收到了书');
    expect(actual).not.toContain('2026-11-01');expect(note.content).toBe('旧记录：今天收到了书');
});
it('does not add a different viewer’s private post or disabled source to temporal material',async()=>{
    await mutateFriendFeed(f=>{f.posts.push({...f.posts[0],id:'hidden',audienceIds:[hidden.id],text:'不可见的昨晚原话',comments:[]});});
    const task=(await prepareFriendFeedEmotionTask(char.id,()=>0))!;
    expect(task.prompt).not.toContain('不可见的昨晚原话');expect(material(task.prompt).posts).toHaveLength(1);
    await releaseFriendFeedEmotionTask(char.id,task.id);
});
