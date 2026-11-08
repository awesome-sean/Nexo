import React from 'react';
import type { ApiTemplate, ManualApiDraft } from '../../../common/custom-agents';
export function sourceOrigin(endpoint: string): string {
  try { const url=new URL(endpoint); return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password ? url.origin : ''; } catch { return ''; }
}
interface Props {value:ManualApiDraft;previousOrigin?:string;consent:string;onChange:(patch:Partial<ManualApiDraft>)=>void;onConsent:(origin:string)=>void}
export const AgentSourceFields:React.FC<Props>=({value,previousOrigin,consent,onChange,onConsent})=>{
 const origin=sourceOrigin(value.endpoint||previousOrigin||'');
 return <div className="nexo-agent-source-fields">
  <label>API 地址<input aria-label="Agent API 服务地址" type="url" required={!previousOrigin} placeholder={previousOrigin||'https://api.example.com/v1'} value={value.endpoint} onChange={event=>onChange({endpoint:event.target.value})}/></label>
  <label>API 密钥<input aria-label="Agent API 密钥" type="password" autoComplete="off" required={!previousOrigin} placeholder={previousOrigin?'留空保留已有密钥':'粘贴 API Key'} value={value.apiKey} onChange={event=>onChange({apiKey:event.target.value})}/></label>
  <details className="nexo-api-advanced"><summary>高级设置 · 余额查询方式</summary>
   <p>模型接口可用于检测连接。余额接口由服务商单独提供，无法自动读取时可在这里选择。</p>
   <label>服务类型<select aria-label="额度查询模板" value={value.template} onChange={event=>onChange({template:event.target.value as ApiTemplate})}><option value="auto">自动识别</option><option value="json">自定义用量接口</option><option value="new-api">New API</option><option value="sub2api">Sub2API</option><option value="deepseek">DeepSeek</option><option value="openrouter">OpenRouter</option></select></label>
   {value.template==='new-api'&&<label>New API 用户 ID<input aria-label="New API 用户 ID" value={value.userId||''} onChange={event=>onChange({userId:event.target.value})}/></label>}
   {value.template==='json'&&<><p>API 地址填写完整的余额查询接口。</p>{([['remainingPath','剩余额度字段'],['usedPath','已用字段（可选）'],['totalPath','总额度字段（可选）'],['unit','单位']] as const).map(([key,label])=><label key={key}>{label}<input value={value[key]||''} onChange={event=>onChange({[key]:event.target.value})}/></label>)}</>}
  </details>
  <label className="nexo-api-consent"><input type="checkbox" aria-label="确认 API 密钥发送域名" checked={!!origin&&consent===origin} disabled={!origin} onChange={event=>onConsent(event.target.checked?origin:'')}/><span>允许向 {origin||'填写的服务域名'} 发送密钥查询</span></label>
 </div>;
};
