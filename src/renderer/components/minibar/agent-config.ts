import type { CustomAgentSummary } from '../../../common/custom-agents';
export const MINIBAR_AGENT_CONFIGS = [{key:'codex' as const,name:'GPT',color:'#30D158'}];
// Old stored Agent lists are deliberately ignored during the GPT-only migration.
export function allAgentConfigs(_legacyCustomAgents:CustomAgentSummary[] = []) {
  return MINIBAR_AGENT_CONFIGS.map(item=>({...item,icon:'codex' as const}));
}
export function visibleAgentConfigs(_legacyAgents:string[],_legacyCustomAgents:CustomAgentSummary[] = []) {
  return allAgentConfigs().map(config=>({...config,centerY:68,left:20}));
}
