export type LegacyBuiltinWhiteboxPreset = { id: string; name: string; code: string; swatch: string };

// 内置完整风格（点击=替换文本框、立刻生效）。
export const LEGACY_BUILTIN_WHITEBOX_PRESETS: LegacyBuiltinWhiteboxPreset[] = [
    {
        id: 'builtin-classic-cream',
        name: '奶油少女',
        swatch: 'linear-gradient(135deg,#ffe3ef,#fff2e2 55%,#f1e7ff)',
        code: `/* 奶油少女 */
.sully-chat-header{
  background:linear-gradient(135deg,#ffe3ef,#fff2e2 55%,#f1e7ff)!important;
  border-bottom:none!important;
  box-shadow:0 6px 18px rgba(214,160,180,.18);
  border-radius:0 0 22px 22px;
}
.sully-chat-name{color:#c2587f!important;}
.sully-chat-avatar{border:2px solid #ffb8d4!important;box-shadow:0 0 0 4px rgba(255,184,212,.25)!important;}
.sully-chat-buffs button{background:#fff0f6!important;color:#d6478b!important;border-color:#ffc6df!important;}
.sully-chat-trigger{color:#e86aa6!important;}
.sully-chat-token{background:#fff0f6!important;color:#c76aa0!important;border-color:#ffd4e6!important;}`,
    },
    {
        id: 'builtin-classic-neon',
        name: '霓虹夜',
        swatch: 'radial-gradient(circle at 30% 30%,#3b1d63,#0e0b1e 75%)',
        code: `/* 霓虹夜 */
.sully-chat-header{
  background:#0e0b1e!important;
  border-bottom:1px solid rgba(168,85,247,.45)!important;
  box-shadow:0 0 26px rgba(168,85,247,.3);
}
.sully-chat-name{color:#e9d5ff!important;text-shadow:0 0 10px rgba(192,132,252,.9);}
.sully-chat-status{color:#a78bfa!important;}
.sully-chat-back,.sully-chat-trigger{color:#67e8f9!important;}
.sully-chat-avatar{border:2px solid #67e8f9!important;box-shadow:0 0 12px rgba(103,232,249,.6)!important;}
.sully-chat-buffs button{background:rgba(103,232,249,.12)!important;color:#a5f3fc!important;border-color:rgba(103,232,249,.4)!important;}
.sully-chat-token{background:rgba(168,85,247,.15)!important;color:#d8b4fe!important;border-color:rgba(168,85,247,.4)!important;}`,
    },
    {
        id: 'builtin-classic-mint',
        name: '薄荷奶绿',
        swatch: 'linear-gradient(135deg,#e3f9ee,#f0fff4 60%,#e0f5ff)',
        code: `/* 薄荷奶绿 */
.sully-chat-header{
  background:linear-gradient(135deg,#e3f9ee,#f0fff4 60%,#e0f5ff)!important;
  border-bottom:none!important;
  box-shadow:0 6px 16px rgba(120,190,160,.16);
  border-radius:0 0 20px 20px;
}
.sully-chat-name{color:#2f8f6b!important;}
.sully-chat-avatar{border:2px solid #8fe0bf!important;box-shadow:0 0 0 4px rgba(143,224,191,.25)!important;}
.sully-chat-buffs button{background:#e7faf0!important;color:#22936a!important;border-color:#abe6cd!important;}
.sully-chat-trigger{color:#2bb088!important;}
.sully-chat-token{background:#e7faf0!important;color:#3a9b76!important;border-color:#bdebd6!important;}`,
    },
    {
        id: 'builtin-classic-twilight',
        name: '暮光紫',
        swatch: 'linear-gradient(135deg,#3b2a63,#5a3f86 55%,#7e5aa6)',
        code: `/* 暮光紫 */
.sully-chat-header{
  background:linear-gradient(135deg,#3b2a63,#5a3f86 55%,#7e5aa6)!important;
  border-bottom:none!important;
  box-shadow:0 8px 22px rgba(80,50,130,.3);
  border-radius:0 0 18px 18px;
}
.sully-chat-name{color:#fce7ff!important;}
.sully-chat-status{color:#d6bcfa!important;}
.sully-chat-back,.sully-chat-trigger{color:#f5d0fe!important;}
.sully-chat-avatar{border:2px solid rgba(255,255,255,.7)!important;box-shadow:0 4px 14px rgba(0,0,0,.3)!important;}
.sully-chat-buffs button{background:rgba(255,255,255,.16)!important;color:#fbe8ff!important;border-color:rgba(255,255,255,.3)!important;}
.sully-chat-token{background:rgba(255,255,255,.14)!important;color:#f0e0ff!important;border-color:rgba(255,255,255,.25)!important;}`,
    },
    {
        id: 'builtin-classic-minimal',
        name: '极简白',
        swatch: 'linear-gradient(135deg,#ffffff,#f3f4f6)',
        code: `/* 极简白 */
.sully-chat-header{background:#ffffff!important;border-bottom:1px solid #eef1f5!important;box-shadow:none!important;}
.sully-chat-name{color:#1f2937!important;}
.sully-chat-avatar{border:1.5px solid #e5e7eb!important;}
.sully-chat-buffs button{background:#f5f6f8!important;color:#6b7280!important;border-color:#e5e7eb!important;}
.sully-chat-trigger{color:#6366f1!important;}
.sully-chat-token{background:#f5f6f8!important;color:#9ca3af!important;border-color:#e5e7eb!important;}`,
    },
    {
        id: 'builtin-classic-lavender',
        name: '淡紫毛绒',
        swatch: 'radial-gradient(150% 120% at 50% -30%,#ddc9ff,#c9b2f4 45%,#bda0ee)',
        code: `/* ===== 淡紫毛绒 · 温柔风 ===== */
.sully-chat-root{
  background:
    radial-gradient(120% 80% at 18% 0%, #f4ecff 0%, transparent 58%),
    radial-gradient(120% 80% at 92% 8%, #ffe9f7 0%, transparent 52%),
    linear-gradient(180deg, #efe6ff 0%, #f6f1ff 48%, #fcf9ff 100%) !important;
}
.sully-chat-header{
  overflow:visible !important;
  background:radial-gradient(150% 120% at 50% -30%, #ddc9ff 0%, #c9b2f4 45%, #bda0ee 100%) !important;
  border:none !important;
  border-radius:0 0 24px 24px !important;
  box-shadow:inset 0 2px 6px rgba(255,255,255,.6), inset 0 -10px 20px rgba(150,108,222,.35), 0 10px 26px rgba(178,142,236,.4) !important;
}
.sully-chat-header::before{
  content:"" !important;position:absolute !important;
  top:calc(var(--safe-top) + 4px) !important;right:14px !important;
  width:60px !important;height:60px !important;border-radius:50% !important;
  background:radial-gradient(circle, rgba(255,255,255,.55) 0%, transparent 70%) !important;
  filter:blur(2px) !important;pointer-events:none !important;
}
.sully-chat-back{
  color:#8a6bc4 !important;background:rgba(255,255,255,.65) !important;border-radius:50% !important;
  box-shadow:inset 0 1px 2px rgba(255,255,255,.9), 0 2px 6px rgba(160,120,220,.35) !important;
}
.sully-chat-avatar{
  width:46px !important;height:46px !important;border-radius:50% !important;border:3px solid #fff !important;
  box-shadow:0 0 0 3px rgba(220,200,255,.75), 0 0 16px 3px rgba(200,160,245,.6), 0 4px 10px rgba(160,120,220,.45) !important;
  animation:sully-float 4.5s ease-in-out infinite !important;
}
@keyframes sully-float{0%,100%{transform:translateY(0);}50%{transform:translateY(-2.5px);}}
.sully-chat-name{color:#fff !important;font-weight:700 !important;letter-spacing:.5px !important;text-shadow:0 1px 4px rgba(135,95,205,.55), 0 0 10px rgba(255,255,255,.4) !important;}
.sully-chat-name::after{content:" ✦" !important;color:#fff3ff !important;font-size:.8em !important;text-shadow:0 0 6px rgba(255,255,255,.8) !important;}
.sully-chat-status{color:#f3ebff !important;font-size:.72rem !important;text-shadow:0 1px 2px rgba(130,90,200,.4) !important;}
.sully-chat-buffs button{
  background:rgba(255,255,255,.62) !important;color:#7a5bb0 !important;border:1.5px solid rgba(255,255,255,.85) !important;
  border-radius:999px !important;font-weight:600 !important;padding:2px 10px !important;
  box-shadow:0 2px 6px rgba(180,140,230,.3), inset 0 1px 2px rgba(255,255,255,.85) !important;backdrop-filter:blur(4px) !important;
}
.sully-chat-token{color:#8a6bc4 !important;background:rgba(255,255,255,.5) !important;border-radius:999px !important;padding:1px 8px !important;font-size:.66rem !important;box-shadow:inset 0 1px 2px rgba(255,255,255,.8) !important;}
.sully-chat-trigger{
  color:#fff !important;background:radial-gradient(circle at 35% 30%, #d9b8ff, #b98cf0) !important;border-radius:50% !important;
  box-shadow:0 0 0 2px rgba(255,255,255,.6), 0 0 14px 2px rgba(200,150,250,.7), 0 3px 8px rgba(150,100,210,.45) !important;
  animation:sully-breathe 3.2s ease-in-out infinite !important;
}
@keyframes sully-breathe{0%,100%{box-shadow:0 0 0 2px rgba(255,255,255,.6), 0 0 12px 2px rgba(200,150,250,.55), 0 3px 8px rgba(150,100,210,.45);}50%{box-shadow:0 0 0 2px rgba(255,255,255,.7), 0 0 20px 5px rgba(210,165,255,.85), 0 3px 8px rgba(150,100,210,.45);}}
.sully-chat-inputbar{
  background:linear-gradient(180deg, rgba(255,255,255,.85), rgba(245,238,255,.92)) !important;border:1.5px solid rgba(255,255,255,.9) !important;
  border-radius:22px 22px 0 0 !important;box-shadow:inset 0 2px 5px rgba(255,255,255,.9), 0 -6px 18px rgba(180,140,230,.28) !important;backdrop-filter:blur(8px) !important;
}`,
    },
    {
        id: 'builtin-classic-onsen',
        name: '和风温泉',
        swatch: 'linear-gradient(165deg,#ffe3c4,#ffd0b0 38%,#ffb9ad 62%,#f7a9b0 84%,#ef9bb0)',
        code: `/* ===== 和风温泉・晨光汤屋 ===== */
.sully-chat-root{background:linear-gradient(180deg,#fdf3e7 0%, #fbe9da 45%, #f6e4ea 100%) !important;}
.sully-chat-header{
  overflow:visible !important;border-bottom:none !important;box-shadow:0 .3rem .9rem rgba(180,120,110,.28) !important;
  background:
    radial-gradient(circle at 100% 50%, transparent 62%, rgba(122,74,68,.07) 63% 70%, transparent 71%) 0 0 / 1.1rem 1.9rem,
    radial-gradient(circle at 0 50%,   transparent 62%, rgba(122,74,68,.07) 63% 70%, transparent 71%) .55rem -.95rem / 1.1rem 1.9rem,
    linear-gradient(165deg,#ffe3c4 0%, #ffd0b0 38%, #ffb9ad 62%, #f7a9b0 84%, #ef9bb0 100%) !important;
}
.sully-chat-header::before{
  content:"";position:absolute;left:.6rem;right:.6rem;top:calc(var(--safe-top) + .1rem);height:2.6rem;pointer-events:none;z-index:0;
  background:
    radial-gradient(42% 60% at 22% 80%, rgba(255,255,255,.55), transparent 70%),
    radial-gradient(36% 55% at 52% 85%, rgba(255,255,255,.48), transparent 70%),
    radial-gradient(34% 50% at 80% 82%, rgba(255,255,255,.42), transparent 70%);
  filter:blur(3px);opacity:0;animation:sully-steam 7s ease-in-out infinite;
}
.sully-chat-header::after{
  content:"";position:absolute;left:0;right:0;bottom:-.55rem;height:1rem;pointer-events:none;z-index:2;
  background-image:
    radial-gradient(circle at .5rem .62rem, rgba(246,178,107,.98) 0 .3rem, rgba(212,96,74,.98) .3rem .34rem, transparent .36rem),
    linear-gradient(rgba(160,100,90,.6), rgba(160,100,90,.6));
  background-size:1.5rem 100%, 100% .07rem;background-position:0 0, 0 .18rem;background-repeat:repeat-x, repeat-x;
  filter:drop-shadow(0 .15rem .25rem rgba(212,96,74,.4));
}
.sully-chat-back{color:#7d4a44 !important;background:rgba(255,255,255,.5) !important;border:.08rem solid rgba(122,74,68,.3) !important;border-radius:50% !important;box-shadow:inset 0 0 .35rem rgba(255,255,255,.6), 0 .1rem .25rem rgba(180,120,110,.25) !important;}
.sully-chat-avatar{width:2.6rem !important;height:2.6rem !important;border-radius:50% !important;border:.12rem solid #fff7ee !important;object-fit:cover !important;box-shadow:0 0 0 .16rem rgba(212,96,74,.55), 0 0 .8rem rgba(246,178,107,.7), inset 0 0 .4rem rgba(0,0,0,.18) !important;}
.sully-chat-name{position:relative;z-index:1;color:#5a3243 !important;font-weight:700 !important;letter-spacing:.06em !important;text-shadow:0 .06rem 0 rgba(255,255,255,.5) !important;}
.sully-chat-status{position:relative;z-index:1;color:#3f8f6a !important;font-size:.66rem !important;letter-spacing:.04em !important;}
.sully-chat-status::before{content:"";display:inline-block;width:.42rem;height:.42rem;margin-right:.3rem;border-radius:50%;vertical-align:middle;background:#5cc486;box-shadow:0 0 .35rem rgba(92,196,134,.85);animation:sully-pulse 2.6s ease-in-out infinite;}
.sully-chat-buffs{gap:.3rem !important;position:relative;z-index:1;}
.sully-chat-buffs button{background:linear-gradient(#ffffff, #fdeede) !important;color:#8a4a44 !important;border:.07rem solid rgba(122,74,68,.4) !important;border-radius:.7rem !important;font-size:.66rem !important;font-weight:600 !important;letter-spacing:.02em !important;padding:.16rem .5rem !important;box-shadow:0 .1rem .25rem rgba(180,120,110,.3), inset 0 .05rem 0 rgba(255,255,255,.8) !important;}
.sully-chat-token{color:#6a3d38 !important;background:linear-gradient(#ffffff, #fbeede) !important;border:.06rem solid rgba(122,74,68,.35) !important;border-radius:.5rem !important;font-size:.62rem !important;letter-spacing:.02em !important;box-shadow:0 .1rem .25rem rgba(180,120,110,.28) !important;}
.sully-chat-trigger{color:#fff5e8 !important;background:radial-gradient(circle at 30% 30%, #f6b26b, #e0664a 72%) !important;border:.1rem solid rgba(255,255,255,.7) !important;border-radius:50% !important;animation:sully-ember 3.2s ease-in-out infinite;}
.sully-chat-inputbar{background:linear-gradient(180deg,#fff6ea,#ffece0) !important;border-top:.12rem solid rgba(212,96,74,.4) !important;border-radius:.9rem .9rem 0 0 !important;box-shadow:0 -.3rem .7rem rgba(180,120,110,.22), inset 0 .08rem 0 rgba(255,255,255,.7) !important;}
@keyframes sully-steam{0%{opacity:0;transform:translateY(.4rem) scaleY(.9);}50%{opacity:.5;}100%{opacity:0;transform:translateY(-.5rem) scaleY(1.12);}}
@keyframes sully-pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.5;transform:scale(.82);}}
@keyframes sully-ember{0%,100%{box-shadow:0 0 .5rem rgba(224,102,74,.6), inset 0 .1rem .2rem rgba(255,255,255,.35);}50%{box-shadow:0 0 .9rem rgba(246,178,107,.95), inset 0 .1rem .2rem rgba(255,255,255,.4);}}`,
    },
];
