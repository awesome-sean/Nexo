import { useEffect, useState } from 'react';
import { ChevronDown, ExternalLink, ShieldCheck } from 'lucide-react';
import type { HookStatus } from '../../../main/services/codex-hook-install';
import { AgentLogo } from './AgentLogo';
import { BandVibrationSettings } from './BandVibrationSettings';
import waitingExpression from '../../../../band-app/src/common/expressions/smirk/8.png';
import workingExpression from '../../../../band-app/src/common/expressions/naughty/4.png';
import doneExpression from '../../../../band-app/src/common/expressions/star/8.png';
import idleExpression from '../../../../band-app/src/common/expressions/sleep/4.png';

const expressionExamples = [
  { state: 'waiting', label: '等待处理', image: waitingExpression, name: '生气', description: '等待审核、补充信息或额度暂停时自动显示生气表情，短震＋长震连续六组，共十二下。双击可返回时间页。' },
  { state: 'working', label: '正在工作', image: workingExpression, name: 'wink', description: '任务执行中，双击时间页可查看 wink 表情。' },
  { state: 'done', label: '任务完成', image: doneExpression, name: '星星眼', description: '完成时自动显示星星眼，连续长震四下，单次时长由手环决定。10 分钟后回到时间页。' },
  { state: 'idle', label: '空闲待命', image: idleExpression, name: '睡觉', description: '空闲无灯，双击时间页可查看睡觉表情。' },
] as const;

export function CodexHooksCard() {
  const [hook, setHook] = useState<HookStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    window.pulse?.getHookStatus().then(value => {
      if (active) setHook(value);
    }).catch(() => { if (active) setNotice('读取 Codex Hooks 配置失败'); });
    return () => { active = false; };
  }, []);

  const changeHook = async () => {
    if (!window.pulse) return;
    setBusy(true);
    setNotice('');
    try {
      const result = hook?.installed ? await window.pulse.uninstallHook() : await window.pulse.installHook();
      if (!result.ok) throw new Error(result.error || '操作失败');
      setHook({ installed: result.installed === true, settingsPath: result.settingsPath || '', command: result.command || null });
      setNotice(result.installed ? '配置已写入。到 Codex「设置 → Hooks」审核并信任 Nexo 命令，然后新开会话。' : 'Nexo Hooks 已移除');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  return <section className="nexo-floating-settings-card workspace-hooks-card">
    <div className="workspace-card-header">
      <div className="nexo-section-heading"><AgentLogo agent="codex" size={24} /><h3>GPT · Codex Hooks</h3></div>
      <span className="workspace-configuration-state"><ShieldCheck size={15} />{hook?.installed ? '配置已写入' : '待配置'}</span>
    </div>
    <div className="workspace-hook-action">
      <p>让手环跟随 Codex 任务自动切换表情与提醒。</p>
      <button type="button" className="btn-primary nexo-action" disabled={busy || !hook} onClick={() => void changeHook()}>
        {busy ? '处理中…' : hook?.installed ? '移除配置' : '配置 Hooks'}<ExternalLink size={15} />
      </button>
    </div>
    {notice && <p className="nexo-hook-guide" role="status">{notice}</p>}
    <div className="nexo-traffic-legend"><span data-state="waiting">红灯 · 等待处理 / 额度暂停</span><span data-state="working">黄灯 · 正在工作</span><span data-state="done">绿灯 · 最近完成</span><span>空闲 · 无灯</span></div>
    <BandVibrationSettings />
    <details className="workspace-hook-help">
      <summary>如何启用状态联动<ChevronDown size={15} /></summary>
      <ol>
        <li>点击「配置 Hooks」，将 Nexo 状态灯命令写入本机配置。</li>
        <li>打开 Codex「设置 → Hooks」或输入框旁的「Review hooks」，审核并信任 Nexo 命令。</li>
        <li>新开 Codex 会话，保持 Nexo 与手环连接。命令行版可通过 <code>/hooks</code> 完成审核。</li>
      </ol>
    </details>
    <div className="workspace-expression-guide">
      <h4>手环表情怎么用</h4>
      <div className="workspace-expression-states">
        {expressionExamples.map(item => <div className="workspace-expression-state" key={item.state} data-state={item.state}>
          <div className="workspace-expression-art"><img src={item.image} alt={`${item.name} 表情`} loading="lazy" /></div>
          <div><h5><span aria-hidden="true" />{item.label}</h5><p>{item.description}</p></div>
        </div>)}
      </div>
      <p className="workspace-expression-example"><strong>例如</strong>让 Codex 修改一段代码，工作时可双击时间页查看 wink。遇到审核会自动切到生气表情，在电脑端同意并恢复执行后返回时间页。任务完成后显示星星眼，10 分钟后自动返回。</p>
      <p className="workspace-expression-gesture">双击时间页与表情页可来回切换。等待处理时自动显示表情，双击可提前返回时间页。保持表情页时，任务恢复后自动返回。</p>
    </div>
  </section>;
}
