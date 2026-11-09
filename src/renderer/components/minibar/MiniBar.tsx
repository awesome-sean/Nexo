import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Sliders, EyeOff, ChevronLeft, Sun, Moon } from 'lucide-react';
import type { MinibarState } from '../../../common/types';
import { useMiniBarSettings } from '../../hooks/useMiniBarSettings';
import { MiniBarDock } from './MiniBarDock';
import { visibleAgentConfigs } from './agent-config';
import { MiniBarDetails } from './MiniBarDetails';
import { MiniBarEdge } from './MiniBarEdge';
import { MINIBAR_PALETTES } from './minibar-palette';
import { DETAIL_WIDTH, DETAIL_HEIGHT, DETAIL_GAP, CAPSULE_GUTTER, MINIBAR_MENU_WIDTH, MINIBAR_MENU_VERTICAL_HEIGHT, MINIBAR_MENU_HORIZONTAL_HEIGHT } from '../../../common/minibar-layout';
import { getMiniBarCollapsedSize } from '../../../main/services/minibar-geometry';

export interface MiniBarProps {
  theme?: 'light' | 'dark';
}

export const MiniBar: React.FC<MiniBarProps> = ({ theme = 'dark' }) => {
  const [state, setState] = useState<MinibarState | null>(null);
  const stateRef = useRef<MinibarState | null>(null);
  stateRef.current = state;
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);

  // 详情卡挂载与动画解耦状态（彻底解决窗口提前缩小导致的硬件裁剪闪退）
  const [mountedAgent, setMountedAgent] = useState<string | null>(null);
  const [cardVisible, setCardVisible] = useState(false);

  const { settings: preferences, error: preferencesError, update: updatePreferences } = useMiniBarSettings();
  const bgOpacity = preferences.backgroundOpacity;
  const agentConfigs = visibleAgentConfigs(preferences.visibleAgents, preferences.customAgents);
  // 右键上下文菜单状态
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
  }>({
    visible: false,
    x: 0,
    y: 0,
  });

  const leaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // 边缘标签拖拽防误触参考（位移 >4px 判定为拖拽）
  const tabDragRef = useRef<{ startX: number; startY: number; moved: boolean }>({
    startX: 0,
    startY: 0,
    moved: false,
  });
  // 手动拖拽进行中标记：用于松手/失焦时上报主进程吸附
  const draggingRef = useRef(false);

  // 吸附方向与显示模式
  const dockSide = state?.dockSide ?? 'right';
  const isLeftDock = dockSide === 'left';
  const isHorizontal = dockSide === 'top' || dockSide === 'bottom';
  const dockAtTop = dockSide === 'top';
  const isEdgeTab = state?.displayMode === 'edge-tab';

  // 详情只跟随图标悬停或键盘焦点。
  const targetAgent = hoveredAgent;

  useEffect(() => {
    if (hoveredAgent && !preferences.visibleAgents.includes(hoveredAgent)) setHoveredAgent(null);
  }, [preferences.visibleAgents, hoveredAgent]);

  useEffect(() => {
    if (isEdgeTab) { setHoveredAgent(null); setContextMenu((menu) => ({ ...menu, visible: false })); }
  }, [isEdgeTab]);

  // 订阅真实数据源推送
  useEffect(() => {
    if (!window.codeisland) return;
    let alive = true;

    window.codeisland.getMinibarState?.().then((s) => {
      if (alive && s) setState(s);
    });

    const unsub = window.codeisland.onMinibarState?.((s) => {
      if (alive && s) setState(s as MinibarState);
    });

    return () => {
      alive = false;
      unsub?.();
    };
  }, []);

  // 向主进程同步物理窗口展开/收缩几何
  const syncExpandedToMain = useCallback((expanded: boolean) => {
    if (window.codeisland?.setMinibarExpanded) {
      window.codeisland.setMinibarExpanded(expanded, contextMenu.visible ? 'menu' : 'details');
    } else if (window.codeisland?.toggleMinibarExpanded && state?.isExpanded !== expanded) {
      window.codeisland.toggleMinibarExpanded();
    }
  }, [state?.isExpanded, contextMenu.visible]);

  const handleOpacityChange = (newOpacity: number) => {
    void updatePreferences({ backgroundOpacity: newOpacity });
  };
  // 动画状态机：根据 targetAgent 控制卡片挂载与淡入淡出动画
  // （物理窗口展开与否统一由下方单一来源 effect 决定，卡片与菜单共用一套扩宽/收起逻辑）
  useEffect(() => {
    if (isEdgeTab) {
      // 边缘标签模式下收起并卸载卡片
      if (mountedAgent) {
        setMountedAgent(null);
        setCardVisible(false);
      }
      return;
    }

    if (targetAgent) {
      // 目标存在：立即取消正在进行的退出倒计时
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }

      // 若卡片尚未挂载，先挂载卡片并触发淡入
      if (!mountedAgent) {
        setMountedAgent(targetAgent);
        const raf = requestAnimationFrame(() => {
          setCardVisible(true);
        });
        return () => cancelAnimationFrame(raf);
      } else {
        // 卡片已挂载（在不同 Agent 之间切换）：直接切换内容，保持展开，不闪烁
        setMountedAgent(targetAgent);
        setCardVisible(true);
      }
    } else if (mountedAgent) {
      // 目标消失且卡片当前仍挂载：先触发 CSS 优雅淡出，动画结束后才卸载 DOM
      setCardVisible(false);
      closeTimerRef.current = setTimeout(() => {
        setMountedAgent(null);
        closeTimerRef.current = null;
      }, 160); // 160ms 优雅淡出动画时长
    }
  }, [targetAgent, mountedAgent, isEdgeTab]);

  // 物理窗口展开/收起单一来源：卡片挂载或右键菜单打开即扩宽，二者都关闭才收起。
  useEffect(() => {
    syncExpandedToMain(!isEdgeTab && (!!mountedAgent || contextMenu.visible));
  }, [mountedAgent, contextMenu.visible, isEdgeTab, syncExpandedToMain]);

  // 清理所有定时器
  useEffect(() => {
    return () => {
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);

    };
  }, []);

  // 关闭右键上下文菜单
  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => {
      if (!prev.visible) return prev;
      return { ...prev, visible: false };
    });
  }, []);

  // 右键上下文菜单生命周期与多通道关闭逻辑
  useEffect(() => {
    if (!contextMenu.visible) return;

    // 1. 宿主窗口失焦时自动关闭（例如用户点击其他桌面应用、任务栏或桌面）
    const unsubBlur = window.codeisland?.onWindowBlur?.(() => {
      closeContextMenu();
    });

    // 2. 指针事件捕获阶段拦截：
    //    - 点击在菜单内部（如拖动背景不透明度滑块），正常放行
    //    - 点击在菜单外部，立即关闭菜单；若是鼠标右键，阻断冒泡防止在同一次操作中原地重开
    const handleCapturePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.minibar-context-menu')) {
        return;
      }
      closeContextMenu();
      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // 3. 全局 Esc 快捷键关闭
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();
      }
    };

    window.addEventListener('pointerdown', handleCapturePointerDown, { capture: true });
    window.addEventListener('keydown', handleGlobalKeyDown);

    return () => {
      unsubBlur?.();
      window.removeEventListener('pointerdown', handleCapturePointerDown, { capture: true });
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [contextMenu.visible, closeContextMenu]);

  // 移出整个交互区域后收回临时展开的边缘标签。
  const handleContainerMouseLeave = () => {
    if (contextMenu.visible) {
      // 菜单打开时绝对不自动收起
      return;
    }
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
    }
    leaveTimerRef.current = setTimeout(() => {
      if (draggingRef.current) return;
      if (stateRef.current?.edgePeekActive) {
        setHoveredAgent(null);
        closeContextMenu();
        window.codeisland?.setMinibarEdgePeek?.(false);
        return;
      }
      setHoveredAgent(null);
    }, 250);
  };

  // 移入卡片或侧栏交互桥时清除收起计时
  const handleInteractiveMouseEnter = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }

  };

  // 拖拽热区被按下时，立即清空展开态并通知主进程切回纯侧栏尺寸，绝不允许方块悬空拖动
  const handleDragRegionPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || draggingRef.current || (event.target as HTMLElement).closest('.no-drag, button, input')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setContextMenu((prev) => ({ ...prev, visible: false }));
    setHoveredAgent(null);
    setMountedAgent(null);
    setCardVisible(false);
    draggingRef.current = true;
    window.codeisland?.notifyDragStart?.();
    syncExpandedToMain(false);
  };

  // 手动拖拽结束上报：鼠标松开或窗口失焦时通知主进程停止跟随并吸附
  useEffect(() => {
    const endDrag = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        window.codeisland?.notifyDragEnd?.();
      }
    };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    window.addEventListener('blur', endDrag);
    return () => {
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      window.removeEventListener('blur', endDrag);
    };
  }, []);

  // Esc 关闭详情或菜单。
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (contextMenu.visible) {
        closeContextMenu();
        return;
      }
        setHoveredAgent(null);
    }
  };

  const handleClose = () => {
    setHoveredAgent(null);
    closeContextMenu();
    window.codeisland?.closeMinibar?.();
  };

  // 切换为边缘标签微型模式
  const handleCollapseToEdgeTab = () => {
    setHoveredAgent(null);
    setMountedAgent(null);
    setCardVisible(false);
    closeContextMenu();
    window.codeisland?.setMinibarDisplayMode?.('edge-tab');
  };

  // 从边缘标签恢复为完整侧栏
  const handleRestoreFromEdgeTab = () => {
    window.codeisland?.setMinibarDisplayMode?.('full');
  };

  // 打开右键上下文菜单
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }

    // 仅在显式右键呼出菜单时通知主进程给予窗口前台焦点，以便响应系统 blur 与 Esc
    // 普通鼠标悬停绝不抢占焦点
    window.codeisland?.notifyMenuOpen?.();

    if (isEdgeTab) {
      // 边缘标签模式（物理窗口 18×48 / 48×18）由主进程直接弹出原生菜单，不受窗口物理边界裁剪
      return;
    }

    const rect = containerRef.current?.getBoundingClientRect();
    const relY = rect ? e.clientY - rect.top : e.clientY;

    const expandedWidth = 456;
    const expandedHeight = isHorizontal ? MINIBAR_MENU_HORIZONTAL_HEIGHT : MINIBAR_MENU_VERTICAL_HEIGHT;
    const menuX = isHorizontal ? (expandedWidth - MINIBAR_MENU_WIDTH) / 2 : isLeftDock ? 128 : 16;
    const menuY = isHorizontal ? (dockAtTop ? 124 : 16) : Math.max(16, Math.min(relY - 24, expandedHeight - 700));

    setContextMenu({
      visible: true,
      x: menuX,
      y: menuY,
    });
  };

  const quotas = state?.quotas;
  const activeKeyForCard = mountedAgent;
  const currentAgentConfig = agentConfigs.find((config) => config.key === activeKeyForCard);
  const renderContextMenu = () => (
    <div role="menu" aria-label="悬浮窗个性化菜单"
      className="fixed z-[100] minibar-context-menu overflow-y-auto custom-scrollbar" data-appearance={preferences.appearance}
      style={{ width: MINIBAR_MENU_WIDTH, left: contextMenu.x, top: contextMenu.y, maxHeight: `calc(100vh - ${contextMenu.y + 8}px)`, backgroundColor: `rgba(${MINIBAR_PALETTES[preferences.appearance].menuRgb},.98)`, color: MINIBAR_PALETTES[preferences.appearance].menuText }}
      onClick={(event) => event.stopPropagation()}>
      <button type="button" className="nexo-floating-menu-button" onClick={() => { closeContextMenu(); void window.pulse?.openMiniBarSettings(); }}>
        <Sliders size={19} />打开个性化设置
      </button>
      <section className="nexo-menu-group" aria-label="外观与显示">
        <h4>外观与显示</h4>
        <div className="nexo-menu-appearance" role="group" aria-label="悬浮窗外观">
          <button type="button" aria-pressed={preferences.appearance === 'light'} onClick={() => void updatePreferences({ appearance: 'light' })}><Sun size={17} />浅色</button>
          <button type="button" aria-pressed={preferences.appearance === 'dark'} onClick={() => void updatePreferences({ appearance: 'dark' })}><Moon size={17} />深色</button>
        </div>
        <div className="nexo-floating-menu-section">
          <label htmlFor="minibar-menu-opacity"><span>背景透明度</span><strong>{Math.round((1 - bgOpacity) * 100)}%</strong></label>
          <input id="minibar-menu-opacity" style={{ '--menu-range-progress': Math.round((1 - bgOpacity) * 100) + '%' } as React.CSSProperties} aria-label="背景透明度" type="range" min="0" max="100" step="1" value={Math.round((1 - bgOpacity) * 100)} onChange={event => handleOpacityChange(1 - Number(event.target.value) / 100)} className="minibar-slider" />
        </div>
        <div className="nexo-floating-menu-section">
          <label htmlFor="minibar-menu-scale"><span>胶囊大小</span><strong>{Math.round(preferences.capsuleScale * 100)}%</strong></label>
          <input id="minibar-menu-scale" style={{ '--menu-range-progress': ((preferences.capsuleScale - 0.75) / 0.75 * 100) + '%' } as React.CSSProperties} type="range" min="75" max="150" step="5" value={Math.round(preferences.capsuleScale * 100)} onChange={event => void updatePreferences({ capsuleScale: Number(event.target.value) / 100 })} className="minibar-slider" />
        </div>
        <label className="nexo-floating-menu-check"><span>显示任务文字</span><input type="checkbox" checked={preferences.showStatusText} onChange={event => void updatePreferences({ showStatusText: event.target.checked })} /></label>
      </section>
      <section className="nexo-menu-group" aria-label="停靠与交互">
        <h4>停靠与交互</h4>
        <div className="nexo-floating-menu-section">
          <label htmlFor="minibar-menu-edge-gap"><span>边缘距离</span><strong>{preferences.edgeGap} px</strong></label>
          <input id="minibar-menu-edge-gap" style={{ '--menu-range-progress': (preferences.edgeGap / 64 * 100) + '%' } as React.CSSProperties} type="range" min="0" max="64" step="1" value={preferences.edgeGap} onChange={event => void updatePreferences({ edgeGap: Number(event.target.value) })} className="minibar-slider" />
        </div>
        <label className="nexo-floating-menu-check"><span>边缘标签悬停展开</span><input type="checkbox" checked={preferences.hoverReveal} onChange={event => void updatePreferences({ hoverReveal: event.target.checked })} /></label>
      </section>
      <button type="button" className="nexo-floating-menu-button" onClick={handleCollapseToEdgeTab}><ChevronLeft size={19} />收起为边缘标签</button>
      <button type="button" className="nexo-floating-menu-button text-rose-300" onClick={handleClose}><EyeOff size={19} />隐藏悬浮窗</button>
      {preferencesError && <p role="alert" className="px-2 text-[10px] text-rose-300">{preferencesError}</p>}
    </div>
  );

  const dockSize = getMiniBarCollapsedSize(dockSide, 1, preferences.showStatusText);
  const dockOffset = state?.dockOffset ?? {
    x: isHorizontal ? (state?.isExpanded ? (Math.max(456, dockSize.width) - dockSize.width) / 2 : 0) : (!isLeftDock && state?.isExpanded ? 456 - dockSize.width : 0),
    y: isHorizontal && !dockAtTop && state?.isExpanded ? 480 - dockSize.height : 0,
  };

  if (isEdgeTab) {
    return (
      <div ref={containerRef} data-theme={theme} className="w-full h-full relative select-none minibar-sidebar-container minibar-edge-container outline-none"
        onContextMenu={handleContextMenu} onMouseLeave={handleContainerMouseLeave} tabIndex={0} role="region" aria-label="Agent 额度微型边缘标签">
        <button type="button" className="nexo-traffic-edge-button w-full h-full cursor-pointer"
          
          title={preferences.hoverReveal ? '悬停展开悬浮窗' : '点击展开悬浮窗'}
          onMouseEnter={() => { if (preferences.hoverReveal) window.codeisland?.setMinibarEdgePeek?.(true); }}
          onClick={() => { if (!preferences.hoverReveal && !tabDragRef.current.moved) handleRestoreFromEdgeTab(); }}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleRestoreFromEdgeTab(); } }}
          onPointerDown={(event) => { if (event.button === 0) tabDragRef.current = { startX: event.screenX, startY: event.screenY, moved: false }; }}
          onPointerMove={(event) => {
            if (event.buttons !== 1) return;
            if (Math.hypot(event.screenX - tabDragRef.current.startX, event.screenY - tabDragRef.current.startY) > 4) {
              tabDragRef.current.moved = true;
              if (!draggingRef.current) { event.currentTarget.setPointerCapture(event.pointerId); draggingRef.current = true; window.codeisland?.notifyDragStart?.(); }
            }
          }}>
          <MiniBarEdge side={dockSide} opacity={bgOpacity} appearance={preferences.appearance} />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} data-theme={theme} className="w-full h-full relative select-none minibar-sidebar-container outline-none"
      onMouseEnter={handleInteractiveMouseEnter} onMouseLeave={handleContainerMouseLeave}
      onContextMenu={handleContextMenu} onKeyDown={handleKeyDown} tabIndex={0} role="region" aria-label="Agent 额度悬浮组件">
      {currentAgentConfig && (
        <div className={`nexo-traffic-details-panel minibar-card-anim ${cardVisible ? 'opacity-100' : 'opacity-0'}`}
          style={{ position: 'absolute', width: DETAIL_WIDTH, height: DETAIL_HEIGHT,
            top: isHorizontal ? (dockAtTop ? dockOffset.y + dockSize.height + DETAIL_GAP : dockOffset.y - DETAIL_HEIGHT - DETAIL_GAP) : dockOffset.y + dockSize.height - CAPSULE_GUTTER - DETAIL_HEIGHT,
            left: isHorizontal ? dockOffset.x + (dockSize.width - DETAIL_WIDTH) / 2 : (isLeftDock ? dockOffset.x + dockSize.width + DETAIL_GAP : dockOffset.x - DETAIL_WIDTH - DETAIL_GAP) }}
          onMouseEnter={handleInteractiveMouseEnter} role="dialog" aria-modal="false" aria-label="GPT 额度详情">
          <MiniBarDetails quotas={quotas} opacity={bgOpacity} textTheme={preferences.detailTextTheme} appearance={preferences.appearance} />
        </div>
      )}
      <MiniBarDock agents={['codex']} quotas={quotas} traffic={state?.traffic} showStatusText={preferences.showStatusText} appearance={preferences.appearance} dockSide={dockSide} opacity={bgOpacity} offset={dockOffset}
        selectedAgent={targetAgent} onAgentDoubleClick={() => { void window.pulse?.openCodexWindow().catch(console.warn); }} onAgentEnter={setHoveredAgent} onAgentLeave={() => setHoveredAgent(null)} onDragStart={handleDragRegionPointerDown} onMouseEnter={handleInteractiveMouseEnter} onMouseLeave={handleContainerMouseLeave} />
      {contextMenu.visible && renderContextMenu()}
    </div>
  );
};
