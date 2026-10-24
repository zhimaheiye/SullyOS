import dark from '../presets/chat/acid-orbit.json';
import lavender from '../presets/chat/acid-orbit-lavender.json';
import {validateDecoration} from './chatDecoration';
import {LEGACY_BUILTIN_WHITEBOX_PRESETS} from './legacyBuiltinWhitebox';

/** Bundled outfits stay local; read returns a fresh validated preset for editing/applying. */
export const BUILTIN_WHITEBOX_PRESETS = [
 {id:'builtin-acid-orbit',name:'星轨 · 深空',read:()=>validateDecoration(structuredClone(dark))},
 {id:'builtin-acid-orbit-lavender',name:'星轨 · 雾紫',read:()=>validateDecoration(structuredClone(lavender))},
 ...LEGACY_BUILTIN_WHITEBOX_PRESETS.map(({id,name,code,swatch})=>({
  id,name,swatch,read:()=>validateDecoration({format:'sullyos-chat-decoration',version:1,name,parts:{css:code}}),
 })),
];
