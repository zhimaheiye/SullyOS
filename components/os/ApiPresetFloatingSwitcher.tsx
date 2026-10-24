import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { commitApiConfig } from '../../utils/apiConfigCommit';
import {
  loadApiPresetFloatingSettings,
  subscribeApiPresetFloatingSettings,
  updateApiPresetFloatingSettings,
} from '../../utils/apiPresetFloatingSettings';
import { configFromPreset, findActivePresetId } from '../../utils/apiPresetSwitch';

const BUTTON_SIZE = 54;
const EDGE_GAP = 12;
const PANEL_GAP = 8;
const DRAG_THRESHOLD = 6;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

type Point = { x: number; y: number };
type DragState = Point & {
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  moved: boolean;
};

const ApiPresetFloatingSwitcher: React.FC = () => {
  const { apiConfig, apiPresets, updateApiConfig, addToast } = useOS();
  const [settings, setSettings] = useState(loadApiPresetFloatingSettings);
  const [open, setOpen] = useState(false);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [dragPosition, setDragPosition] = useState<Point | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => subscribeApiPresetFloatingSettings(setSettings), []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const rect = root.getBoundingClientRect();
      setBounds({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(root);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [settings.enabled]);

  const activePresetId = useMemo(
    () => findActivePresetId(apiPresets, apiConfig),
    [apiPresets, apiConfig.baseUrl, apiConfig.apiKey, apiConfig.model],
  );

  if (!settings.enabled) return null;

  const persistedTop = clamp(settings.yRatio * bounds.height - BUTTON_SIZE / 2, EDGE_GAP, bounds.height - BUTTON_SIZE - EDGE_GAP);
  const buttonPosition = dragPosition ?? {
    x: settings.side === 'left' ? EDGE_GAP : bounds.width - BUTTON_SIZE - EDGE_GAP,
    y: persistedTop,
  };
  const panelWidth = Math.max(0, Math.min(280, bounds.width - BUTTON_SIZE - EDGE_GAP * 2 - PANEL_GAP));
  const panelMaxHeight = Math.max(0, Math.min(360, bounds.height - EDGE_GAP * 2));
  const panelLeft = settings.side === 'left'
    ? clamp(buttonPosition.x + BUTTON_SIZE + PANEL_GAP, EDGE_GAP, bounds.width - panelWidth - EDGE_GAP)
    : clamp(buttonPosition.x - panelWidth - PANEL_GAP, EDGE_GAP, bounds.width - panelWidth - EDGE_GAP);
  const panelTop = clamp(buttonPosition.y, EDGE_GAP, bounds.height - panelMaxHeight - EDGE_GAP);

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - buttonPosition.x,
      offsetY: event.clientY - buttonPosition.y,
      x: buttonPosition.x,
      y: buttonPosition.y,
      moved: false,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) return;
    drag.moved = true;
    setOpen(false);
    drag.x = clamp(event.clientX - drag.offsetX, EDGE_GAP, bounds.width - BUTTON_SIZE - EDGE_GAP);
    drag.y = clamp(event.clientY - drag.offsetY, EDGE_GAP, bounds.height - BUTTON_SIZE - EDGE_GAP);
    setDragPosition({ x: drag.x, y: drag.y });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (!drag.moved) return;
    suppressClickRef.current = true;
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    const next = updateApiPresetFloatingSettings({
      side: drag.x + BUTTON_SIZE / 2 < bounds.width / 2 ? 'left' : 'right',
      yRatio: bounds.height > 0 ? (drag.y + BUTTON_SIZE / 2) / bounds.height : settings.yRatio,
    });
    setSettings(next);
    setDragPosition(null);
  };

  const handlePointerCancel = () => {
    dragRef.current = null;
    setDragPosition(null);
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (suppressClickRef.current) return;
    setOpen((value) => !value);
  };

  const handleSelectPreset = (preset: (typeof apiPresets)[number]) => {
    commitApiConfig({ apiConfig, patch: configFromPreset(preset), updateApiConfig, addToast });
    addToast(`已切换到「${preset.name}」`, 'success');
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="absolute inset-0 pointer-events-none">
      {open && (
        <div
          aria-hidden="true"
          className="absolute inset-0 z-[53] pointer-events-auto"
          onPointerDown={() => setOpen(false)}
        />
      )}

      {open && bounds.width > 0 && (
        <div
          className="absolute z-[54] pointer-events-auto flex flex-col gap-2 rounded-2xl border border-slate-200/80 bg-slate-50/95 p-2.5 shadow-2xl backdrop-blur-xl"
          style={{ left: panelLeft, top: panelTop, width: panelWidth, maxHeight: panelMaxHeight }}
        >
          <div className="px-1 text-[11px] font-bold text-slate-500">API 预设</div>
          {apiPresets.length === 0 ? (
            <div className="rounded-xl bg-white px-4 py-5 text-center shadow-sm">
              <div className="text-sm font-bold text-slate-700">暂无 API 预设</div>
              <div className="mt-1 text-[11px] text-slate-400">请先前往设置中添加预设</div>
            </div>
          ) : (
            <div className="min-h-0 space-y-2 overflow-y-auto overscroll-contain">
              {apiPresets.map((preset) => {
                const active = activePresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left shadow-sm transition-colors ${
                      active ? 'border-primary/50 bg-primary/5' : 'border-slate-200 bg-white active:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`min-w-0 flex-1 truncate text-sm font-bold ${active ? 'text-primary' : 'text-slate-700'}`}>
                        {preset.name}
                      </span>
                      {active && <Check aria-label="使用中" className="h-4 w-4 shrink-0 text-primary" weight="bold" />}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-400">{preset.config.model}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {bounds.width > 0 && (
        <button
          type="button"
          aria-label="切换 API 预设"
          aria-expanded={open}
          onClick={() => {
            if (!suppressClickRef.current) setOpen((value) => !value);
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onContextMenu={handleContextMenu}
          className="absolute z-[54] pointer-events-auto flex h-[54px] w-[54px] touch-none items-center justify-center rounded-full border border-slate-200/70 bg-white/60 text-slate-500 shadow-lg shadow-slate-900/10 backdrop-blur-md active:bg-white/75"
          style={{ left: buttonPosition.x, top: buttonPosition.y }}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-7 w-7">
            <path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default ApiPresetFloatingSwitcher;
