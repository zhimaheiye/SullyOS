import React, { useEffect, useState } from 'react';
import Modal from '../os/Modal';
import type { APIConfig, CharacterImageGenerationConfig, CharacterProfile } from '../../types';
import { isImageApiVerified } from '../../utils/imageGeneration';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    char: CharacterProfile;
    apiConfig: APIConfig;
    updateCharacter: (id: string, updates: Partial<CharacterProfile>) => void;
    addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const inputClass = 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10';

/**
 * 角色级生图设置：开关、外貌锚点、参考脸图。全局生图 API（URL + Key + Model）
 * 统一在「设置 → 生图 API」配置，角色不单独选模型；这里只显示配置状态。
 */
const ImageGenerationSettingsModal: React.FC<Props> = ({
    isOpen,
    onClose,
    char,
    apiConfig,
    updateCharacter,
    addToast,
}) => {
    const savedChar = char.imageGeneration;
    const savedReferenceUrl = /^https?:\/\//i.test(savedChar?.referenceImage || '') ? savedChar!.referenceImage! : '';
    const [enabled, setEnabled] = useState(!!savedChar?.enabled);
    const [allowProactive, setAllowProactive] = useState(!!savedChar?.allowProactive);
    const [anchors, setAnchors] = useState(savedChar?.appearanceAnchors || '');
    const [referenceImage, setReferenceImage] = useState(savedReferenceUrl);
    const [outputMode, setOutputMode] = useState<'api' | 'prompt'>(savedChar?.mode === 'prompt' ? 'prompt' : 'api');
    const [referencePreview, setReferencePreview] = useState(savedReferenceUrl);
    const [referenceStatus, setReferenceStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(savedReferenceUrl ? 'loading' : 'idle');
    const [previewNonce, setPreviewNonce] = useState(0);

    useEffect(() => {
        if (!isOpen) return;
        setEnabled(!!savedChar?.enabled);
        setAllowProactive(!!savedChar?.allowProactive);
        setAnchors(savedChar?.appearanceAnchors || '');
        setOutputMode(savedChar?.mode === 'prompt' ? 'prompt' : 'api');
        const nextReference = /^https?:\/\//i.test(savedChar?.referenceImage || '') ? savedChar!.referenceImage! : '';
        setReferenceImage(nextReference);
        setReferencePreview(nextReference);
        setReferenceStatus(nextReference ? 'loading' : 'idle');
        setPreviewNonce(value => value + 1);
    }, [isOpen, char.id, savedChar]);

    if (!isOpen) return null;

    const globalApi = apiConfig.imageGeneration;
    const apiReady = !!(globalApi?.baseUrl?.trim() && globalApi?.model?.trim());
    const apiVerified = isImageApiVerified(globalApi);

    const validatedReference = (): string | null => {
        const value = referenceImage.trim();
        if (!value) return '';
        try {
            const parsed = new URL(value);
            if (!/^https?:$/.test(parsed.protocol)) throw new Error();
        } catch {
            addToast('参考图必须是完整的 http(s) 图片 URL', 'error');
            return null;
        }
        if (referenceStatus !== 'success' || referencePreview !== value) {
            addToast('请先点「加载预览」，确认参考图可以正常打开', 'error');
            return null;
        }
        return value;
    };

    const save = () => {
        const referenceUrl = validatedReference();
        if (referenceUrl === null) return;
        updateCharacter(char.id, {
            imageGeneration: {
                enabled,
                allowProactive,
                mode: outputMode,
                appearanceAnchors: anchors.trim(),
                referenceImage: referenceUrl || undefined,
            },
        });
        addToast(outputMode === 'prompt' ? '提示词模式已保存' : '生图设置已保存', 'success');
        onClose();
    };

    const loadReferencePreview = () => {
        const value = referenceImage.trim();
        if (!value) {
            setReferencePreview('');
            setReferenceStatus('idle');
            return;
        }
        try {
            const parsed = new URL(value);
            if (!/^https?:$/.test(parsed.protocol)) throw new Error();
            setReferenceImage(value);
            setReferencePreview(value);
            setReferenceStatus('loading');
            setPreviewNonce(nonce => nonce + 1);
        } catch {
            setReferencePreview('');
            setReferenceStatus('error');
            addToast('请输入完整的 http(s) 图片 URL', 'error');
        }
    };

    const ToggleRow: React.FC<{ title: string; description: string; value: boolean; onChange: () => void; activeClass?: string }> = ({ title, description, value, onChange, activeClass = 'bg-primary' }) => (
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3 first:border-0 first:pt-0">
            <div>
                <div className="text-sm font-semibold text-slate-700">{title}</div>
                <div className="mt-1 text-[11px] text-slate-400">{description}</div>
            </div>
            <button type="button" onClick={onChange} className={`relative h-6 w-10 shrink-0 rounded-full p-1 transition-colors ${value ? activeClass : 'bg-slate-200'}`}>
                <span className={`block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${value ? 'translate-x-4' : ''}`} />
            </button>
        </div>
    );

    return (
        <Modal isOpen={isOpen} title={`${char.name} · 生图`} onClose={onClose}>
            <div className="space-y-5">
                <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                    <div>
                        <h3 className="font-bold text-slate-800">输出方式</h3>
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">没有单独选过的角色仍走 API 生图。提示词模式只保存可编辑、可复制的画面摘要和完整提示词，不调用生图接口。</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setOutputMode('api')} className={`rounded-2xl px-3 py-2.5 text-xs font-bold ${outputMode === 'api' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'}`}>API 生图</button>
                        <button type="button" onClick={() => setOutputMode('prompt')} className={`rounded-2xl px-3 py-2.5 text-xs font-bold ${outputMode === 'prompt' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'}`}>提示词模式</button>
                    </div>
                </section>

                <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                    <ToggleRow
                        title={outputMode === 'prompt' ? '开启画面提示词' : '开启角色生图'}
                        description={outputMode === 'prompt' ? '开启后，明确索图会保存提示词卡片，不调用生图 API' : '开启后，明确索图会直接调用 API，不再二次确认'}
                        value={enabled}
                        onChange={() => setEnabled(v => !v)}
                    />
                    <ToggleRow
                        title={outputMode === 'prompt' ? '允许角色主动给提示词' : '允许角色主动发图'}
                        description="默认关闭；开启后角色仍会被要求极低频使用"
                        value={allowProactive}
                        onChange={() => setAllowProactive(v => !v)}
                        activeClass="bg-violet-500"
                    />
                </section>

                <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                    <div className="flex items-center justify-between">
                        <h3 className="font-bold text-slate-800">生图 API</h3>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${apiVerified ? 'bg-emerald-50 text-emerald-600' : apiReady ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-400'}`}>
                            {apiVerified ? '已连通' : apiReady ? '已配置' : '未配置'}
                        </span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-400">
                        {outputMode === 'prompt'
                            ? '提示词模式使用角色当前聊天 API，或线下见面里已配置的普通文本副 API。这里的生图 API 不会被调用。'
                            : globalApi?.baseUrl?.trim()
                            ? `使用全局配置：${globalApi.model?.trim() || '（未选模型）'}`
                            : '还没有配置生图 API。请到「设置 → 生图 API」填写地址、Key 并选择模型；所有角色共用这一套配置。'}
                    </p>
                </section>

                <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                    <div>
                        <h3 className="font-bold text-slate-800">人物锚点</h3>
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">只写固定外形，例如发型、发色、瞳色和常见服饰特征。场景、动作与穿着可由当前聊天决定。</p>
                    </div>
                    <textarea
                        className={`${inputClass} min-h-28 resize-none leading-relaxed`}
                        value={anchors}
                        onChange={e => setAnchors(e.target.value)}
                        placeholder="例如：黑色微卷短发，灰蓝色瞳孔，眉眼锋利；常穿深色衬衫或长外套。"
                    />
                </section>

                <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                    <div>
                        <h3 className="font-bold text-slate-800">参考图（可选）</h3>
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">填写一条 http(s) 图片直链，并先加载预览。当前版本不会把这张图上传到生图接口。写提示词时会注明，用户可以在自己的生图客户端附上这张参考脸图。API 生图只使用人物锚点和场景文字。</p>
                    </div>
                    <div className="flex gap-2">
                        <input
                            className={inputClass}
                            value={referenceImage}
                            onChange={e => {
                                setReferenceImage(e.target.value);
                                setReferencePreview('');
                                setReferenceStatus('idle');
                            }}
                            placeholder="https://example.com/character.jpg"
                            inputMode="url"
                        />
                        <button type="button" onClick={loadReferencePreview} className="shrink-0 rounded-2xl bg-primary px-4 text-xs font-bold text-white">
                            加载
                        </button>
                    </div>
                    {referencePreview ? (
                        <div className="relative overflow-hidden rounded-2xl bg-slate-100">
                            <img
                                key={previewNonce}
                                src={referencePreview}
                                className="h-56 w-full object-contain"
                                alt="角色参考图预览"
                                referrerPolicy="no-referrer"
                                onLoad={() => setReferenceStatus('success')}
                                onError={() => setReferenceStatus('error')}
                            />
                            <button type="button" onClick={() => { setReferenceImage(''); setReferencePreview(''); setReferenceStatus('idle'); }} className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur">
                                ✕
                            </button>
                            <span className={`absolute bottom-2 left-2 rounded-full px-2.5 py-1 text-[11px] font-bold backdrop-blur ${referenceStatus === 'success' ? 'bg-emerald-500/90 text-white' : referenceStatus === 'error' ? 'bg-rose-500/90 text-white' : 'bg-black/55 text-white'}`}>
                                {referenceStatus === 'success' ? '加载成功' : referenceStatus === 'error' ? '加载失败' : '正在加载…'}
                            </span>
                        </div>
                    ) : (
                        <div className="flex h-28 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 text-slate-300">
                            <span className="text-xs font-bold">加载成功后在这里显示预览</span>
                        </div>
                    )}
                    {referenceStatus === 'error' && <p className="text-xs text-rose-500">图片无法打开。请确认它是图片直链，并且没有登录或防盗链限制。</p>}
                </section>

                <button type="button" onClick={save} className="w-full rounded-2xl bg-primary py-3.5 text-sm font-bold text-white shadow-lg shadow-primary/20">
                    保存设置
                </button>
                <p className="text-center text-[10px] leading-relaxed text-slate-400">{outputMode === 'prompt' ? '提示词卡片只保存文字，不调用生图 API。' : '图片自动进入聊天与相册。'}API Key 只保存在你的本地数据与完整备份中。</p>
            </div>
        </Modal>
    );
};

export default ImageGenerationSettingsModal;
