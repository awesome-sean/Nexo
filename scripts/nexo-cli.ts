import { CodexHookInstaller, codexHookDirectory } from '../src/main/services/codex-hook-install.ts';
import { enqueueTraffic, readTrafficSnapshot, trafficDirectory } from '../src/main/services/codex-traffic-store.ts';
import { hookTrafficEvent, isTrafficState } from '../src/common/codex-traffic.ts';
import { fetchCodexUsage } from '../src/main/services/codex-rate-limits.ts';

async function stdinJson(): Promise<Record<string,unknown>> {
  let text='';
  for await(const chunk of process.stdin) {
    text+=chunk.toString();
    if(Buffer.byteLength(text)>1048576) throw new Error('Hook 输入过大');
  }
  return text.trim() ? JSON.parse(text) : {};
}
export async function runNexoCli(args=process.argv.slice(2)):Promise<void> {
  const command=args[0] || 'status';
  const option=(name:string)=>{const index=args.indexOf(name);return index>=0 ? args[index+1] : undefined;};
  const directory=option('--data-dir') || trafficDirectory();
  if(command==='hook') {
    try {
      const payload=await stdinJson();
      const event=hookTrafficEvent(args[1] || String(payload.hook_event_name || ''),payload);
      if(event) enqueueTraffic(event,directory);
    } catch { /* A visual status observer must not interrupt a Codex task. */ }
    process.stdout.write('{}');
    return;
  }
  if(command==='hooks') {
    const installer=new CodexHookInstaller(process.argv[1],codexHookDirectory(),option('--runtime') || process.execPath,option('--home'));
    const result=args[1]==='install' ? installer.install() : args[1]==='remove' ? installer.remove() : installer.status();
    console.log(JSON.stringify(result,null,2));return;
  }
  if(command==='quit') {enqueueTraffic({id:'control',sessionId:'control',source:'cli',at:Date.now(),quit:true},directory);return;}
  if(command==='status') { console.log(JSON.stringify(readTrafficSnapshot(directory),null,2));return; }
  if(command==='quota') { console.log(JSON.stringify(await fetchCodexUsage(),null,2));return; }
  if(command==='clear' || isTrafficState(command)) {
    const id=option('--task') || 'manual';
    enqueueTraffic({id,sessionId:id,source:'cli',at:Date.now(),state:isTrafficState(command) ? command : undefined,clear:command==='clear',workspace:option('--workspace')},directory);
    console.log(JSON.stringify(readTrafficSnapshot(directory),null,2));
    return;
  }
  if(command==='help' || command==='--help') {
    console.log('Nexo Codex CLI\n  working | waiting | done | idle [--task ID] [--workspace PATH]\n  status | clear | quota | quit\n  hooks install | remove | status [--runtime PATH]\n  --data-dir PATH 可指定状态目录');
    return;
  }
  throw new Error('未知命令，运行 help 查看用法');
}
// Bundled as a standalone Node/Electron-run-as-node entry point.
if(!process.env.NEXO_CLI_LIBRARY) runNexoCli().catch(error=>{console.error(error instanceof Error ? error.message : error);process.exitCode=1;});
