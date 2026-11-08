import { useEffect, useRef, useState } from 'react';
import { CircleCheck, MousePointer2, PanelsTopLeft, Radio, SlidersHorizontal, Sun, Moon } from 'lucide-react';
import type { MinibarState } from '../../../common/types';
import { getMiniBarRenderScale } from '../../../common/minibar-settings';
import { TRAFFIC_COLORS, type TrafficState, type TrafficSnapshot } from '../../../common/codex-traffic';
import { calculateEdgeTabBounds, getMiniBarCollapsedSize, isHorizontalDock, type DockSide } from '../../../main/services/minibar-geometry';
import { useMiniBar } from '../../hooks/useMiniBar';
import { useMiniBarSettings } from '../../hooks/useMiniBarSettings';
import { Toggle } from '../pulse/ui';
import { MiniBarDock } from './MiniBarDock';
import { MiniBarEdge } from './MiniBarEdge';
import { MiniBarDetails } from './MiniBarDetails';
import { DETAIL_WIDTH, DETAIL_HEIGHT, DETAIL_GAP, CAPSULE_GUTTER, getMiniBarEdgeInset } from '../../../common/minibar-layout';

const PREVIEW_STATES: { state: TrafficState; label: string }[] = [
  { state: 'waiting', label: '等待中' },
  { state: 'working', label: '执行中' },
  { state: 'done', label: '已完成' },
  { state: 'idle', label: '空闲' },
];
const PREVIEW_SIDES: { side: DockSide; label: string }[] = [
  { side: 'top', label: '上侧' },
  { side: 'bottom', label: '下侧' },
  { side: 'left', label: '左侧' },
  { side: 'right', label: '右侧' },
];

export function FloatingWindowPage({ quota, embedded = false }: { quota: MinibarState | null; embedded?: boolean }) {
  const visibility = useMiniBar();
  const { settings, loading, saving, error, update } = useMiniBarSettings();
  const [orientation, setOrientation] = useState<DockSide>('top');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [previewState, setPreviewState] = useState<TrafficState | null>(null);
  const [stageSize, setStageSize] = useState({ width: 480, height: 380 });
  const previewStage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = previewStage.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setStageSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const previewTraffic: TrafficSnapshot | undefined = previewState === null ? quota?.traffic : {
    state: previewState, sampledAt: Date.now(), counts: { idle: 0, working: 0, waiting: 0, done: 0 }, expiresAt: null,
  };
  const capsuleSize = getMiniBarCollapsedSize(orientation, 1, settings.showStatusText);
  const edgePreview = settings.displayMode === 'edge-tab';
  const horizontal = isHorizontalDock(orientation);
  const showDetails = detailsOpen && !edgePreview;
  const previewSize = edgePreview ? calculateEdgeTabBounds({ x: 0, y: 0 }, orientation, capsuleSize.height, 1)
    : showDetails ? { width: horizontal ? Math.max(456, capsuleSize.width) : 456, height: horizontal ? capsuleSize.height + DETAIL_GAP + DETAIL_HEIGHT + CAPSULE_GUTTER : capsuleSize.height } : capsuleSize;
  const previewOffset = {
    x: showDetails ? horizontal ? (previewSize.width - capsuleSize.width) / 2 : orientation === 'right' ? previewSize.width - capsuleSize.width : 0 : 0,
    y: showDetails && orientation === 'bottom' ? DETAIL_HEIGHT + DETAIL_GAP + CAPSULE_GUTTER : 0,
  };
  const renderScale = getMiniBarRenderScale(settings.capsuleScale);
  const previewScale = Math.min(renderScale, Math.max(1, stageSize.width - 24 - settings.edgeGap * 2) / previewSize.width, Math.max(1, stageSize.height - 24 - settings.edgeGap * 2) / previewSize.height);
  const previewInset = edgePreview ? 0 : getMiniBarEdgeInset(settings.edgeGap, renderScale) * previewScale / renderScale;
  const transparency = Math.round((1 - settings.backgroundOpacity) * 100);
  const currentPreviewState = previewTraffic?.state ?? 'idle';

  return <div className={`${embedded ? 'workspace-floating-page' : 'nexo-page'} floating-editor`}>
    <div className="floating-editor-heading">
      <h2>桌面悬浮窗</h2>
      <div className="floating-visibility-control" data-visible={visibility.visible}>
        <span>显示</span>
        <Toggle label="显示悬浮窗" checked={visibility.visible} disabled={visibility.busy || loading} onChange={enabled => void visibility.setVisible(enabled)} />
      </div>
    </div>
    {(error || visibility.error) && <p className="floating-editor-error" role="alert">{error || visibility.error}</p>}
    <div className="floating-editor-grid">
      <div className="floating-editor-controls">
        <section className="nexo-floating-settings-card floating-editor-card">
          <div className="nexo-section-heading"><SlidersHorizontal size={21} /><h3>外观设置</h3></div>
          <div className="floating-control-label">任务状态文字</div>
          <div className="nexo-floating-choice-group" role="group" aria-label="任务状态文字">
            {[false, true].map(withText => <button type="button" key={String(withText)} aria-pressed={settings.showStatusText === withText} disabled={loading} onClick={() => void update({ showStatusText: withText })}>{withText ? '显示文字' : '不显示文字'}</button>)}
          </div>
          <div className="floating-control-label">悬浮窗外观</div>
          <div className="nexo-floating-choice-group floating-appearance-options" role="group" aria-label="悬浮窗外观">
            {([{ value: 'light', label: '浅色外观', icon: Sun }, { value: 'dark', label: '深色外观', icon: Moon }] as const).map(({ value, label, icon: Icon }) => <button key={value} type="button" disabled={loading} aria-pressed={settings.appearance === value} onClick={() => void update({ appearance: value, detailTextTheme: value === 'light' ? 'dark' : 'light' })}><Icon size={17} />{label}</button>)}
          </div>
          <div className="floating-range-grid">
            <div><label htmlFor="minibar-transparency">背景透明度<strong>{transparency}%</strong></label><input id="minibar-transparency" type="range" min="0" max="100" step="1" value={transparency} disabled={loading} onChange={event => void update({ backgroundOpacity: 1 - Number(event.target.value) / 100 })} /></div>
            <div><label htmlFor="minibar-scale">胶囊大小<strong>{Math.round(settings.capsuleScale * 100)}%</strong></label><input id="minibar-scale" type="range" min="75" max="150" step="5" value={Math.round(settings.capsuleScale * 100)} disabled={loading} onChange={event => void update({ capsuleScale: Number(event.target.value) / 100 })} /></div>
          </div>
          <div className="floating-control-label">显示形态</div>
          <div className="nexo-floating-choice-group">
            {([{ value: 'full', label: '完整胶囊' }, { value: 'edge-tab', label: '边缘标签' }] as const).map(item => <button key={item.value} type="button" disabled={loading} aria-pressed={settings.displayMode === item.value} onClick={() => { setDetailsOpen(false); void update({ displayMode: item.value }); }}>{item.label}</button>)}
          </div>
          <div className="floating-control-label">详情字体颜色</div>
          <div className="nexo-floating-choice-group" role="group" aria-label="详情字体颜色">
            {([{ value: 'light', label: '浅色字体' }, { value: 'dark', label: '深色字体' }] as const).map(item => <button key={item.value} type="button" disabled={loading} aria-pressed={settings.detailTextTheme === item.value} onClick={() => void update({ detailTextTheme: item.value })}>{item.label}</button>)}
          </div>
        </section>

        <section className="nexo-floating-settings-card floating-editor-card">
          <div className="nexo-section-heading"><MousePointer2 size={21} /><h3>停靠设置</h3></div>
          <div className="floating-hover-setting"><span>悬停展开边缘标签</span><Toggle label="悬停展开边缘标签" checked={settings.hoverReveal} disabled={loading} onChange={hoverReveal => void update({ hoverReveal })} /></div>
          <div className="floating-gap-control">
            <div className="floating-gap-heading"><label htmlFor="minibar-edge-gap">边缘距离</label><span><input type="number" aria-label="边缘距离数值" min="0" max="64" step="1" value={settings.edgeGap} disabled={loading} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) void update({ edgeGap: value }); }} /><span>px</span></span></div>
            <input id="minibar-edge-gap" type="range" min="0" max="64" step="1" value={settings.edgeGap} disabled={loading} onChange={event => void update({ edgeGap: Number(event.target.value) })} />
            <div className="floating-gap-presets">{[0, 12, 24].map(gap => <button type="button" key={gap} disabled={loading} aria-pressed={settings.edgeGap === gap} onClick={() => void update({ edgeGap: gap })}>{gap === 0 ? '紧贴边缘' : `${gap}px`}</button>)}<span>完整胶囊边距</span></div>
          </div>
          <div className="floating-control-label">启动停靠位置</div>
          <div className="nexo-floating-choice-group floating-startup-choices">
            {([{ value: 'left', label: '靠左' }, { value: 'right', label: '靠右' }, { value: 'top', label: '靠上' }, { value: 'bottom', label: '靠下' }, { value: 'remember', label: '记住当前位置' }] as const).map(item => <button key={item.value} type="button" disabled={loading} aria-pressed={settings.dockPreference === item.value} onClick={() => void update({ dockPreference: item.value })}>{item.label}</button>)}
          </div>
        </section>
      </div>

      <section className="nexo-floating-settings-card floating-editor-card floating-live-preview">
        <div className="workspace-card-header"><div className="nexo-section-heading"><PanelsTopLeft size={21} /><h3>效果预览</h3></div><span className="floating-save-badge" role="status"><CircleCheck size={14} />{saving ? '保存中' : loading ? '读取中' : '自动保存'}</span></div>
        <div className="floating-preview-toolbar"><span>停靠预览</span><div className="floating-side-options">
          {PREVIEW_SIDES.map(item => <button type="button" key={item.side} aria-pressed={orientation === item.side} onClick={() => { setOrientation(item.side); setDetailsOpen(false); }}>{item.label}</button>)}
        </div></div>
        <div ref={previewStage} className="floating-screen-surface" data-side={orientation} data-mode={settings.displayMode}>
          <span className="floating-screen-center" aria-hidden="true"><PanelsTopLeft size={24} /></span>
          <div className="floating-screen-dock" style={{ width: previewSize.width * previewScale, height: previewSize.height * previewScale,
            left: horizontal ? '50%' : orientation === 'left' ? previewInset : undefined, right: orientation === 'right' ? previewInset : undefined,
            top: horizontal ? orientation === 'top' ? previewInset : undefined : '50%', bottom: orientation === 'bottom' ? previewInset : undefined,
            transform: horizontal ? 'translateX(-50%)' : 'translateY(-50%)' }}>
            <div style={{ position: 'relative', width: previewSize.width, height: previewSize.height, transform: `scale(${previewScale})`, transformOrigin: 'top left' }}>
              {edgePreview ? <MiniBarEdge side={orientation} opacity={settings.backgroundOpacity} appearance={settings.appearance} /> : <MiniBarDock agents={['codex']} quotas={quota?.quotas} traffic={previewTraffic} showStatusText={settings.showStatusText} appearance={settings.appearance} dockSide={orientation} opacity={settings.backgroundOpacity} offset={previewOffset} selectedAgent={showDetails ? 'codex' : null} onAgentDoubleClick={() => { void window.pulse?.openCodexWindow().catch(console.warn); }} onAgentEnter={() => setDetailsOpen(true)} onAgentLeave={() => setDetailsOpen(false)} />}
              {showDetails && <div className="floating-preview-details" style={{ position: 'absolute', width: DETAIL_WIDTH, height: DETAIL_HEIGHT,
                left: horizontal ? (previewSize.width - DETAIL_WIDTH) / 2 : orientation === 'right' ? previewOffset.x - DETAIL_GAP - DETAIL_WIDTH : capsuleSize.width + DETAIL_GAP,
                top: horizontal ? orientation === 'top' ? capsuleSize.height + DETAIL_GAP : CAPSULE_GUTTER : capsuleSize.height - CAPSULE_GUTTER - DETAIL_HEIGHT }}><MiniBarDetails quotas={quota?.quotas} opacity={settings.backgroundOpacity} textTheme={settings.detailTextTheme} appearance={settings.appearance} /></div>}
            </div>
          </div>
        </div>
        <div className="floating-state-heading"><span>试亮任务灯</span><button type="button" aria-pressed={previewState === null} onClick={() => setPreviewState(null)}><Radio size={13} />{previewState === null ? '实时状态' : '返回实时'}</button></div>
        <div className="floating-state-options">
          {PREVIEW_STATES.map(item => <button type="button" key={item.state} aria-pressed={currentPreviewState === item.state} onClick={() => setPreviewState(item.state)}><span style={{ backgroundColor: item.state === 'idle' ? '#77747F' : TRAFFIC_COLORS[item.state] }} />{item.label}</button>)}
        </div>
        <div className="floating-preview-footer"><span>悬停查看额度详情 · 双击打开 Codex</span><span>{horizontal ? '横版' : '竖版'} · {edgePreview ? '标签贴边' : `${settings.edgeGap}px`}</span></div>
      </section>
    </div>
  </div>;
}
