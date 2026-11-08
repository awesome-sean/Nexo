import type { AgentKind, MinibarDisplayMode } from './types';
import type { CustomAgentSummary } from './custom-agents';
export interface MiniBarSettings {
  backgroundOpacity:number;
  capsuleScale:number;
  visibleAgents:string[];
  customAgents:CustomAgentSummary[];
  hoverReveal:boolean;
  dockPreference:'remember'|'left'|'right'|'top'|'bottom';
  displayMode:MinibarDisplayMode;
  showStatusText:boolean;
  edgeGap:number;
  detailTextTheme:'light'|'dark';
  appearance:'light'|'dark';
}
export const MINIBAR_BASE_SCALE=0.6;
export function getMiniBarRenderScale(displayScale:number):number {return MINIBAR_BASE_SCALE*displayScale;}
export const MINIBAR_AGENTS:AgentKind[]=['codex'];
export function resolveMiniBarSettings(value:Partial<MiniBarSettings>={}):MiniBarSettings {
  return {
    backgroundOpacity:typeof value.backgroundOpacity==='number' && Number.isFinite(value.backgroundOpacity) ? Math.round(Math.max(0,Math.min(1,value.backgroundOpacity))*100)/100 : 0.94,
    capsuleScale:typeof value.capsuleScale==='number' && Number.isFinite(value.capsuleScale) ? Math.max(0.75,Math.min(1.5,value.capsuleScale)) : 1,
    visibleAgents:['codex'],customAgents:[],
    hoverReveal:typeof value.hoverReveal==='boolean' ? value.hoverReveal : true,
    dockPreference:value.dockPreference==='left'||value.dockPreference==='right'||value.dockPreference==='top'||value.dockPreference==='bottom' ? value.dockPreference : 'remember',
    displayMode:value.displayMode==='edge-tab' ? 'edge-tab' : 'full',
    showStatusText:typeof value.showStatusText==='boolean' ? value.showStatusText : false,
    edgeGap:typeof value.edgeGap==='number' && Number.isFinite(value.edgeGap) ? Math.round(Math.max(0,Math.min(64,value.edgeGap))) : 12,
    detailTextTheme:value.detailTextTheme==='dark' ? 'dark' : 'light',
    appearance:value.appearance==='light' ? 'light' : 'dark',
  };
}
