import {describe,it,expect} from 'vitest';
import {BUILTIN_WHITEBOX_PRESETS} from './builtinWhitebox';
import {decorationPatches,resolveDecorationTheme} from './chatDecoration';
import {prepareDecorationApplication} from './decorationApplication';
import {LEGACY_BUILTIN_WHITEBOX_PRESETS} from './legacyBuiltinWhitebox';
import {portableCssImages} from './cssImageAssets';

// Export may use base64 instead of percent-encoded SVG; compare decoded assets and CSS.
const normalizeImages=(css:string)=>css.replace(/data:image\/svg\+xml(;base64)?,([^"\n]*)/g,(_,base64,body)=>
 'svg:'+JSON.stringify(base64?Buffer.from(body,'base64').toString('utf8'):decodeURIComponent(body)));

describe('bundled whitebox outfits',()=>{
 it('keeps the seven original CSS styles beside the two star outfits',()=>{
  expect(BUILTIN_WHITEBOX_PRESETS).toHaveLength(9);
  expect(BUILTIN_WHITEBOX_PRESETS.map(item=>item.name)).toEqual(['星轨 · 深空','星轨 · 雾紫','奶油少女','霓虹夜','薄荷奶绿','暮光紫','极简白','淡紫毛绒','和风温泉']);
  expect(new Set(BUILTIN_WHITEBOX_PRESETS.map(item=>item.id)).size).toBe(9);
  for(const classic of LEGACY_BUILTIN_WHITEBOX_PRESETS){
   const preset=BUILTIN_WHITEBOX_PRESETS.find(item=>item.id===classic.id)!.read();
   expect(preset.parts).toEqual({css:classic.code});
  }
 });
 it.each(BUILTIN_WHITEBOX_PRESETS.slice(0,2))('$name is portable and applies a complete outfit without changing sounds',async item=>{
  const preset=item.read();
  expect(preset.parts.layout?.chatAvatarSize).toBe('medium');
  expect(preset.parts.css).toContain('data:image/svg+xml');
  expect(preset.parts.css).not.toMatch(/url\(["']?https?:/);
  const patch=await decorationPatches(preset,['layout','bubbles','background','psyche','css'],'character',{id:'sample',chatSound:{src:'ding'}} as any,{} as any);
  expect(patch.character.chromeCustomCss).toContain('blobref:');expect(normalizeImages(await portableCssImages(patch.character.chromeCustomCss!))).toBe(normalizeImages(preset.parts.css!));
  expect(patch.character.chatAppearance?.chatAvatarSize).toBe('medium');
  expect(patch.character.chatSound).toEqual({src:'ding'});
 });
 it('keeps builtins unchanged when a returned copy is edited',()=>{
  const item=BUILTIN_WHITEBOX_PRESETS[0];const p=item.read();p.parts.css='changed';
  expect(item.read().parts.css).not.toBe('changed');
 });
 it.each(['薄荷奶绿','淡紫毛绒','极简白'])('$name replaces only the selected character CSS and survives a readback',async name=>{
  const preset=BUILTIN_WHITEBOX_PRESETS.find(item=>item.name===name)!.read();
  const theme={chatChromeCustomCss:'.sully-chat-header{background:red!important}',chatSound:{src:'global'}} as any;
  const original={id:'selected',chromeCustomCss:'.sully-chat-header{background:black!important}',chatDecorationCssIsolated:false,chatAppearance:{chatHeaderStyle:'minimal'},chatFineTune:{enabled:true},bubbleStyle:'saved-bubble',chatBackground:'saved-background',thinkingChainStyle:'echo',thinkingChainCustomCss:'.thought{}',chatSound:{src:'ding'},chatSoundBound:false,systemPrompt:'keep'} as any;
  const other={...original,id:'other',chromeCustomCss:'.other{}'};
  const {prepared,bubbles}=await prepareDecorationApplication(preset,['css'],[original],theme,[],{kind:'builtin'},async()=>({kind:'builtin'}));
  expect(bubbles).toEqual([]);expect(prepared).toHaveLength(1);
  expect(prepared[0].changes.character).toEqual({chromeCustomCss:preset.parts.css,chatDecorationCssIsolated:true,chatSoundBound:false,chatSound:{src:'ding'}});
  const stored=JSON.parse(JSON.stringify({...original,...prepared[0].changes.character}));
  expect(stored.chromeCustomCss).toBe(preset.parts.css);
  expect(resolveDecorationTheme(theme,stored).chatChromeCustomCss).toBeUndefined();
  expect(stored).toMatchObject({chatAppearance:original.chatAppearance,chatFineTune:original.chatFineTune,bubbleStyle:'saved-bubble',chatBackground:'saved-background',thinkingChainStyle:'echo',thinkingChainCustomCss:'.thought{}',chatSound:{src:'ding'},systemPrompt:'keep'});
  expect(other.chromeCustomCss).toBe('.other{}');expect(theme.chatChromeCustomCss).toContain('background:red');
 });
 it('can switch star CSS to mint and lavender and back without keeping old CSS',async()=>{
  const star=BUILTIN_WHITEBOX_PRESETS[0].read();
  const mint=BUILTIN_WHITEBOX_PRESETS.find(item=>item.name==='薄荷奶绿')!.read();
  const lavender=BUILTIN_WHITEBOX_PRESETS.find(item=>item.name==='淡紫毛绒')!.read();
  let character={id:'selected',chatSound:{src:'ding'}} as any;
  for(const preset of [star,mint,lavender,star]){
   const patch=await decorationPatches(preset,['css'],'character',character,{} as any);
   character={...character,...patch.character};
   expect(normalizeImages(await portableCssImages(character.chromeCustomCss))).toBe(normalizeImages(preset.parts.css!));
   expect(character.chatDecorationCssIsolated).toBe(true);
   expect(character.chatSound).toEqual({src:'ding'});
  }
 });
});
