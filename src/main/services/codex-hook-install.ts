import { trafficDirectory } from './codex-traffic-store.ts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
export const CODEX_HOOK_EVENTS = ['SessionStart','UserPromptSubmit','PreToolUse','PermissionRequest','PostToolUse','PreModelRequest','PostModelRequest','SubagentStart','SubagentStop','Stop','Interrupt','SessionEnd'] as const;
export interface HookStatus { installed:boolean;settingsPath:string;command:string|null }
interface Handler { type?:string;command?:string;commandWindows?:string;statusMessage?:string;[key:string]:unknown }
interface Group { hooks?:Handler[];[key:string]:unknown }
interface HookConfig { hooks?:Record<string,Group[]>;[key:string]:unknown }
const codexHome=()=>process.env.CODEX_HOME || path.join(os.homedir(),'.codex');
function ours(handler:Handler):boolean { return typeof handler.command==='string' && handler.command.includes('nexo-codex.ps1') && handler.statusMessage==='Nexo Codex 状态灯'; }
function read(file:string):HookConfig {
  if(!fs.existsSync(file)) return {};
  const value=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  if(!value || typeof value!=='object' || Array.isArray(value) || (value.hooks && (typeof value.hooks!=='object' || Array.isArray(value.hooks)))) throw new Error('现有 hooks.json 格式异常，请先修复文件。');
  return value;
}
function removeOwn(config:HookConfig):HookConfig {
  const hooks:Record<string,Group[]>={};
  for(const [event,groups] of Object.entries(config.hooks || {})) {
    if(!Array.isArray(groups)) throw new Error('现有 Hook 事件配置格式异常。');
    hooks[event]=groups.map(group=>({...group,hooks:(group.hooks || []).filter(handler=>!ours(handler))})).filter(group=>group.hooks.length);
  }
  return {...config,hooks};
}
function atomicWrite(file:string,value:unknown):void {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if(fs.existsSync(file)) fs.copyFileSync(file,file+'.nexo-backup');
  fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2)+'\n','utf8');
  fs.renameSync(file+'.tmp',file);
}
export class CodexHookInstaller {
  private file:string;
  private wrapper:string;
  private source:string;
  private directory:string;
  private executable:string;
  constructor(source:string,directory:string,executable:string,home=codexHome()) {
    this.source=source;this.directory=directory;this.executable=executable;
    this.file=path.join(home,'hooks.json');this.wrapper=path.join(directory,'nexo-codex.ps1');
  }
  status():HookStatus {
    const config=read(this.file);
    const installed=CODEX_HOOK_EVENTS.every(event=>(config.hooks?.[event] || []).some(group=>group.hooks?.some(ours))) && fs.existsSync(this.wrapper) && fs.existsSync(path.join(this.directory,'nexo-cli.cjs'));
    return {installed,settingsPath:this.file,command:installed ? this.wrapper : null};
  }
  install():HookStatus {
    const config=removeOwn(read(this.file));
    const script=fs.readFileSync(this.source,'utf8');
    fs.mkdirSync(this.directory,{recursive:true});
    fs.writeFileSync(path.join(this.directory,'nexo-cli.cjs'),script,'utf8');
    const quote=(value:string)=>"'"+value.replaceAll("'","''")+"'";
    const wrapper=[
      'param([Parameter(ValueFromRemainingArguments=$true)][string[]]$NexoArguments)',
      "$env:ELECTRON_RUN_AS_NODE = '1'",
      '& '+quote(this.executable)+' '+quote(path.join(this.directory,'nexo-cli.cjs'))+' @NexoArguments',
      'exit $LASTEXITCODE','',
    ].join('\r\n');
    fs.writeFileSync(this.wrapper,'\uFEFF'+wrapper,'utf8');
    for(const event of CODEX_HOOK_EVENTS) {
      const command='powershell.exe -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "'+this.wrapper+'" hook '+event;
      (config.hooks![event] ||= []).push({hooks:[{type:'command',command,commandWindows:command,timeout:5,statusMessage:'Nexo Codex 状态灯'}]});
    }
    atomicWrite(this.file,config);
    return this.status();
  }
  remove():HookStatus { atomicWrite(this.file,removeOwn(read(this.file)));return this.status(); }
}

export function codexHookDirectory():string { return path.join(path.dirname(trafficDirectory()),'codex-hooks'); }
export function getHookStatus():HookStatus { return new CodexHookInstaller('',codexHookDirectory(),'').status(); }
