import React, { useState } from 'react';
import { CaretLeft } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import PsychTestModule from './heartSync/PsychTestModule';
import QuestionnaireModule from './heartSync/QuestionnaireModule';

type View = 'home' | 'psych' | 'questionnaire';

const HeartSyncApp: React.FC = () => {
  const { closeApp } = useOS();
  const [view, setView] = useState<View>('home');

  if (view === 'psych') return <PsychTestModule onBack={() => setView('home')} />;
  if (view === 'questionnaire') return <QuestionnaireModule onBack={() => setView('home')} />;

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-rose-50 via-white to-amber-50/50">
      <div className="shrink-0 border-b border-rose-100/80 bg-white/85 backdrop-blur-xl" style={{ paddingTop: 'var(--safe-top)' }}>
        <div className="flex h-16 items-center justify-between px-4">
          <button onClick={closeApp} className="-ml-2 rounded-full p-2 text-slate-600 hover:bg-rose-50" aria-label="返回"><CaretLeft size={26} /></button>
          <div className="font-bold text-slate-800">心心相印</div>
          <div className="min-w-10" />
        </div>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-5 pb-[calc(24px+var(--safe-bottom))]">
        <section className="rounded-[30px] border border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50 p-5 text-amber-950">
          <div><div className="mb-3 text-3xl">🧠</div><h2 className="text-xl font-black">心理测试</h2><p className="mt-1 text-sm text-amber-800/70">换个角度，看见 TA 的内心</p></div>
          <button onClick={() => setView('psych')} className="mt-5 h-12 w-full rounded-2xl bg-orange-500 font-bold text-white">进入心理测试</button>
        </section>
        <section className="rounded-[30px] border border-rose-100 bg-rose-50 p-5 text-rose-950">
          <div><div className="mb-3 text-3xl">📋</div><h2 className="text-xl font-black">问卷填写</h2><p className="mt-1 text-sm text-rose-700/70">把想问 TA 的问题，整理成一份问卷</p></div>
          <button onClick={() => setView('questionnaire')} className="mt-5 h-12 w-full rounded-2xl bg-rose-500 font-bold text-white">打开问卷库</button>
        </section>
      </div>
    </div>
  );
};

export default HeartSyncApp;
