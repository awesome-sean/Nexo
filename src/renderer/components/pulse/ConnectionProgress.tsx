import { Check, AlertCircle, Loader2, Search, Bluetooth, ShieldCheck, Watch } from 'lucide-react';
export type ProgressStep='starting'|'searching'|'connecting'|'authenticating'|'connected';
export interface ConnectionProgressProps {currentStep:ProgressStep|null;failedStep?:ProgressStep|null}
const steps=[{key:'starting',label:'启动服务',icon:Loader2},{key:'searching',label:'查找手环',icon:Search},{key:'connecting',label:'建立连接',icon:Bluetooth},{key:'authenticating',label:'验证身份',icon:ShieldCheck},{key:'connected',label:'已连接',icon:Watch}] as const;
export const ConnectionProgress:React.FC<ConnectionProgressProps>=({currentStep,failedStep})=>{
 const active=steps.findIndex(step=>step.key===(failedStep||currentStep));
 return <div className="nexo-connection-progress" aria-label="手环连接进度" role="status">
  <header><div><h3>连接进度</h3><p>{failedStep?'连接中断，可重新尝试':currentStep==='connected'?'手环已准备就绪':'正在与手环建立安全连接'}</p></div><span>{Math.max(0,active+1)} / 5</span></header>
  <ol>{steps.map((step,index)=>{const done=index<active||currentStep==='connected';const current=index===active;const failed=current&&!!failedStep;const Icon=failed?AlertCircle:done?Check:step.icon;return <li key={step.key} data-status={failed?'error':done?'done':current?'active':'waiting'} aria-current={current?'step':undefined}><span className="nexo-connection-node"><Icon size={19}/></span><strong>{step.label}</strong><small>{failed?'请重试':done?'已完成':current?'进行中':'等待中'}</small></li>})}</ol>
 </div>;
};
