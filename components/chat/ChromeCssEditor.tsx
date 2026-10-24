import BeautyConfirmDialog from '../share/BeautyConfirmDialog';
import {LEGACY_BUILTIN_WHITEBOX_PRESETS as PRESETS} from '../../utils/legacyBuiltinWhitebox';
import {readCssAttribution,stampBeautyCss} from '../../utils/beautyCssAttribution';
import BeautyPresetPreview from '../share/BeautyPresetPreview';
import {WHITEBOX_AI_PROMPT as AI_PROMPT} from '../../utils/chatWhitebox';
import {portableCssImages} from '../../utils/cssImageAssets';
import React, { useEffect, useRef, useState } from 'react';
import { DB } from '../../utils/db';
import { shareOrDownloadFile } from '../../utils/shareExport';
import { readShareText } from '../../utils/pngShare';
import { FileOrImageImport } from '../share/FileOrImageImport';

// 聊天「白框」自定义 CSS 编辑器（Appearance 全局默认 与 单角色定制 共用）。
// 选择器钩子覆盖顶栏、输入栏、整屏背景与普通消息布局；完整清单见下方 AI_PROMPT。

const PRESET_STORE_KEY = 'sully_chrome_css_presets_v1';

// 丢给别的 AI 的提示词（让它按想要的风格生成整段 CSS）。
type Preset = { name: string; code: string; swatch?: string };

// 从一段 CSS 里尽力抠出 .sully-chat-header 的背景值，给「我的预设」生成缩略色块（抠不到则用中性灰）。
const extractSwatch = (code: string): string => {
    const block = code.match(/\.sully-chat-header\s*\{([^}]*)\}/);
    const body = block ? block[1] : code;
    const m = body.match(/background(?:-color)?\s*:\s*([^;!]+)/i);
    const val = m ? m[1].trim() : '';
    return val && !/url\(/i.test(val) ? val : '#e2e8f0';
};

// 自定义预设存 IndexedDB（STORE_ASSETS，随 app 备份/导出一起走）；旧 localStorage 自动一次性迁移过来。
const PRESET_ASSET_KEY = 'chrome_css_presets';

const loadCustom = async (): Promise<Preset[]> => {
    try { const fromDb = await DB.getAssetRaw(PRESET_ASSET_KEY); if (Array.isArray(fromDb)) return fromDb; } catch { /* ignore */ }
    // 迁移旧 localStorage → IndexedDB
    try {
        const raw = localStorage.getItem(PRESET_STORE_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        if (Array.isArray(arr) && arr.length) { await DB.saveAssetRaw(PRESET_ASSET_KEY, arr); localStorage.removeItem(PRESET_STORE_KEY); return arr; }
    } catch { /* ignore */ }
    return [];
};
const persistCustom = async (list: Preset[]) => { try { await DB.saveAssetRaw(PRESET_ASSET_KEY, list); } catch { /* ignore */ } };

// 导出码：SULLYCSS1: + base64(utf8(JSON))，方便整段复制分享/换机带走。
const encodePresets = (list: Preset[]): string => 'SULLYCSS1:' + btoa(unescape(encodeURIComponent(JSON.stringify(list))));
const decodePresets = (code: string): Preset[] => {
    const body = code.trim().replace(/^SULLYCSS1:/, '');
    const json = decodeURIComponent(escape(atob(body)));
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((p: any) => p && typeof p.name === 'string' && typeof p.code === 'string') : [];
};

const copyText = async (text: string): Promise<boolean> => {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
    } catch { return false; }
};

const ChromeCssEditor: React.FC<{ value: string; onChange: (css: string) => void }> = ({ value, onChange }) => {
    const [exportMode,setExportMode]=useState<'current'|'batch'|null>(null);
    const [exportCredit,setExportCredit]=useState(()=>{try{return JSON.parse(localStorage.getItem('sully-beauty-author-defaults-v1')||'{}').credit||'';}catch{return '';}});
    const [exportNotice,setExportNotice]=useState('');
    const signedCss=(css:string,name:string)=>{const old=readCssAttribution(css);if(old?.allowRedistribute===false)throw Error('作者禁止二次传播');return stampBeautyCss(css,old||{name,credit:exportCredit,category:'whitebox'});};
    const [copied, setCopied] = useState(false);
    const [custom, setCustom] = useState<Preset[]>([]);
    const presetImageRef = useRef<HTMLInputElement>(null);
    const [previewOpen,setPreviewOpen]=useState(false);
    const previewPack=React.useMemo(()=>({format:'sullyos-chat-decoration',version:1,name:'白框预览',parts:{css:value}}),[value]);

    useEffect(() => {
        let alive = true;
        loadCustom().then((list) => { if (alive) setCustom(list); });
        return () => { alive = false; };
    }, []);

    const commitCustom = (next: Preset[]) => { setCustom(next); persistCustom(next); };

    const handleCopyPrompt = async () => {
        if (await copyText(AI_PROMPT)) { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    };
    const handleSavePreset = () => {
        if (!value.trim() || typeof window === 'undefined') return;
        const name = window.prompt('给这套装扮 CSS 预设起个名字（所有角色通用）：', '我的预设')?.trim();
        if (!name) return;
        commitCustom([...custom.filter((p) => p.name !== name), { name, code: value }]);
    };
    const handleDeletePreset = (name: string) => commitCustom(custom.filter((p) => p.name !== name));

    const handleTxtImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            const css = (await readShareText(file, 'chrome-css')).replace(/^\uFEFF/, '');
            if (!css.trim()) {
                window.alert('TXT 文件内容为空。');
                return;
            }
            onChange(css);
        } catch (error: any) {
            window.alert(error?.message || '样式导入失败，请确认文件可以正常读取。');
        } finally {
            event.target.value = '';
        }
    };

    const handleTxtExport = () => setExportMode('current');
    const handleExport = () => setExportMode('batch');
    const confirmShare=async()=>{
        if(exportMode==='batch'){
            const list=await Promise.all(custom.map(async item=>({...item,code:signedCss(await portableCssImages(item.code),item.name)})));
            if(!await copyText(encodePresets(list)))throw Error('复制失败，请重试');
            setExportNotice(`已复制 ${list.length} 套带署名的预设`);
        }else{
            const content=signedCss(await portableCssImages(value),'白框样式');const author=readCssAttribution(content)!.credit;
            await shareOrDownloadFile({card:{kind:'chrome-css',title:'白框样式',author},content,fileName:'sullyos-whitebox.css',mimeType:'text/css;charset=utf-8',shareTitle:'SullyOS·糯米机 白框样式'});
        }
    };
    const handleImport = () => {
        if (typeof window === 'undefined') return;
        const code = window.prompt('粘贴预设导出码（SULLYCSS1:...）：', '')?.trim();
        if (!code) return;
        importPresetCode(code);
    };
    const importPresetCode = (code: string) => {
        let incoming: Preset[] = [];
        try { incoming = decodePresets(code); } catch { window.alert('导出码无法识别，请确认完整粘贴。'); return; }
        if (!incoming.length) { window.alert('没解析到有效预设。'); return; }
        // 同名覆盖，其余追加
        const map = new Map(custom.map((p) => [p.name, p] as const));
        incoming.forEach((p) => map.set(p.name, p));
        commitCustom(Array.from(map.values()));
        window.alert(`已导入 ${incoming.length} 套预设。`);
    };

    const cardCls = 'group relative h-14 w-[78px] shrink-0 overflow-hidden rounded-xl border border-black/5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md active:scale-95';
    const cardLabelCls = 'absolute inset-x-0 bottom-0 truncate px-1.5 py-1 text-[10px] font-bold text-white';

    return (
        <div className="space-y-4">
            {exportNotice&&<p role="status">{exportNotice}</p>}
            {exportMode&&<BeautyConfirmDialog title="带上作者署名" confirm={exportMode==='batch'?'复制预设':'分享 CSS'} onClose={()=>setExportMode(null)} onConfirm={confirmShare}><p>已有署名会原样保留。为没有署名的样式填写作者名称。</p><label>作者署名<input maxLength={60} value={exportCredit} onChange={e=>setExportCredit(e.target.value)}/></label></BeautyConfirmDialog>}

            <details className="mb-4" onToggle={event=>setPreviewOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm py-2">预览完整聊天 · 虚构示例</summary>{previewOpen&&<BeautyPresetPreview data={previewPack}/>}</details>
            {/* 需要灵感：复制提示词给 AI */}
            <button onClick={handleCopyPrompt}
                className="flex w-full items-center gap-2.5 rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-violet-50 px-3.5 py-3 text-left transition-all hover:from-indigo-100 hover:to-violet-100 active:scale-[0.99]">
                <span className="text-lg leading-none">{copied ? '✓' : '🪄'}</span>
                <span className="min-w-0">
                    <span className="block text-[12px] font-bold text-indigo-700">{copied ? '已复制！丢给任意 AI 即可' : '让 AI 帮你写一套'}</span>
                    <span className="block text-[10px] leading-snug text-indigo-400">复制提示词 → 发给任何 AI，说出你想要的风格，把它给的 CSS 粘回来</span>
                </span>
            </button>

            {/* 内置风格：缩略色块卡片 */}
            <div>
                <div className="mb-2 text-[11px] font-bold text-slate-500">内置风格 <span className="font-normal text-slate-400">· 点一下套用</span></div>
                <div className="flex flex-wrap gap-2">
                    {PRESETS.map((p) => (
                        <button key={p.name} onClick={() => onChange(p.code)} title={p.name} className={cardCls}>
                            <span className="absolute inset-0" style={{ background: p.swatch }} />
                            <span className={cardLabelCls} style={{ background: 'linear-gradient(to top, rgba(0,0,0,.5), transparent)' }}>{p.name}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* 我的预设：全角色通用，存 IndexedDB（随备份走），可导入导出 */}
            <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
                    <span className="text-[11px] font-bold text-slate-500">我的预设 <span className="font-normal text-slate-400">· 全角色通用</span></span>
                    <div className="flex items-center gap-1">
                        <input ref={presetImageRef} type="file" accept=".png,.txt,image/png,text/plain" hidden onChange={async event => {
                            const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
                            try { importPresetCode(await readShareText(file, 'chrome-presets')); }
                            catch (error: any) { window.alert(error?.message || '预设导入失败'); }
                        }} />
                        <button onClick={() => presetImageRef.current?.click()} className="rounded-md px-2 py-1 text-[10px] font-semibold text-indigo-500">图片导入</button>
                        <button disabled={!custom.length} onClick={async () => {
                            try { await shareOrDownloadFile({ content: encodePresets(custom), fileName: '白框预设集.txt', mimeType: 'text/plain', card: { kind: 'chrome-presets', title: '白框预设集' } }); }
                            catch (error: any) { window.alert(error?.message || '预设导出失败'); }
                        }} className="rounded-md px-2 py-1 text-[10px] font-semibold text-indigo-500 disabled:opacity-30">图片分享</button>
                        <button onClick={handleImport} className="rounded-md px-2 py-1 text-[10px] font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-600">导入</button>
                        <button onClick={handleExport} disabled={!custom.length} className={`rounded-md px-2 py-1 text-[10px] font-semibold ${custom.length ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-600' : 'text-slate-300'}`}>导出</button>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {custom.map((p) => (
                        <div key={p.name} className={cardCls}>
                            <button onClick={() => onChange(p.code)} title={p.name} className="absolute inset-0">
                                <span className="absolute inset-0" style={{ background: extractSwatch(p.code) }} />
                                <span className={cardLabelCls} style={{ background: 'linear-gradient(to top, rgba(0,0,0,.5), transparent)' }}>{p.name}</span>
                            </button>
                            <button onClick={() => handleDeletePreset(p.name)} title="删除"
                                className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/45 text-[10px] leading-none text-white opacity-80 hover:bg-rose-500">×</button>
                        </div>
                    ))}
                    {/* 保存当前为预设 */}
                    <button onClick={handleSavePreset} disabled={!value.trim()} title={value.trim() ? '把当前 CSS 存为预设' : '先写点 CSS'}
                        className={`flex h-14 w-[78px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed text-[10px] font-bold transition-all active:scale-95 ${value.trim() ? 'border-emerald-300 text-emerald-600 hover:bg-emerald-50' : 'border-slate-200 text-slate-300'}`}>
                        <span className="text-lg leading-none">＋</span>存当前
                    </button>
                </div>
            </div>

            {/* CSS 代码区 */}
            <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-slate-500">CSS 代码 <span className="font-normal text-slate-400">· 可手改 / 粘贴</span></span>
                    <div className="flex items-center gap-1">
                        <FileOrImageImport onChange={handleTxtImport} className="rounded-lg px-2 py-1 text-[10px] font-semibold text-indigo-500 hover:bg-indigo-50" />
                        <button onClick={handleTxtExport} disabled={!value.trim()} className={`rounded-lg px-2 py-1 text-[10px] font-semibold ${value.trim() ? 'text-indigo-500 hover:bg-indigo-50' : 'text-slate-300'}`}>导出分享</button>
                        {value && <button onClick={() => onChange('')} className="rounded-lg px-2 py-1 text-[10px] font-semibold text-rose-400 hover:bg-rose-50 hover:text-rose-500">清空</button>}
                    </div>
                </div>
                <textarea
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={'/* 点上面任一套，或在这里直接写 / 粘贴 CSS */\n.sully-chat-header{\n  background: linear-gradient(135deg,#ffe3ef,#f1e7ff) !important;\n  border-bottom: none !important;\n}'}
                    spellCheck={false}
                    rows={8}
                    className="w-full resize-y rounded-2xl border border-slate-700 bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-200 outline-none focus:border-primary/50 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                />
                <div className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
                    可用选择器：<code className="rounded bg-slate-100 px-1 text-slate-500">.sully-chat-header / -avatar / -name / -buffs / -token / -trigger / -back / -status / -inputbar / -panel / -root</code>
                </div>
                <div className="mt-1 text-[10px] leading-relaxed text-slate-400">
                    日程修改动效：<code className="rounded bg-slate-100 px-1 text-slate-500">.sully-schedule-change / -head / -mark / -kicker / -list / -row / -time / -before / -arrow / -after / -shine</code>
                </div>
            </div>
        </div>
    );
};

export default ChromeCssEditor;
