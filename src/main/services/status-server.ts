import http from 'node:http';
import type { SessionManager } from './session-manager';
import type { CodexTrafficService } from './codex-traffic-store';
import { aggregateTraffic } from '../../common/codex-traffic';
import { QuotaCollector } from './quota-collector';
import { pushError } from './error-log';
import { DEFAULT_BAND_SETTINGS, type BandSettings } from '../../common/band-settings';

export class StatusServer {
  private server:http.Server|null=null;
  private quotaCollector=new QuotaCollector();
  constructor(private sessionManager:SessionManager,private port=18765,private traffic?:CodexTrafficService,private getBandSettings:()=>BandSettings=()=>({...DEFAULT_BAND_SETTINGS})) {}
  getQuotas() { return this.quotaCollector.getQuotas(); }
  getTrafficLight() { return this.traffic?.getSnapshot() ?? aggregateTraffic([]); }
  getExchangeRate() { return this.quotaCollector.getExchangeRate(); }
  setExchangeRate(rate:unknown) { return this.quotaCollector.setExchangeRate(rate); }
  start():void {
    if(this.server) return;
    this.server=http.createServer((req,res)=>{
      try {this.handleRequest(req,res);} catch(error) {
        pushError('status-server','本地状态请求失败','warn');
        if(!res.headersSent) res.writeHead(500,{'Content-Type':'application/json'});
        res.end(JSON.stringify({error:'internal error'}));
      }
    });
    this.server.on('error',error=>pushError('status-server',error.message));
    this.server.listen(this.port,'127.0.0.1');
  }
  private handleRequest(req:http.IncomingMessage,res:http.ServerResponse):void {
    const url=new URL(req.url || '/', 'http://127.0.0.1');
    if(req.method==='OPTIONS') {res.writeHead(204);res.end();return;}
    if(req.method!=='GET') {res.writeHead(405);res.end();return;}
    const sessions=this.sessionManager.getAllSessions().filter(session=>session.agent==='codex');
    const session=sessions.find(value=>value.status==='waiting') || sessions.find(value=>value.status==='thinking' || value.status==='running_tool') || sessions[0] || null;
    if(['/status','/api/status','/status/compact','/api/status/compact'].includes(url.pathname)) {
      const quotas=this.getQuotas();
      const traffic=this.getTrafficLight();
      const quota=quotas.codex;
      const now=Date.now();
      const codex={...quota,reset5hClock:quota.reset5hAt ? new Date(quota.reset5hAt).toTimeString().slice(0,5) : null,reset7dDate:quota.reset7dAt ? String(new Date(quota.reset7dAt).getMonth()+1).padStart(2,'0')+'/'+String(new Date(quota.reset7dAt).getDate()).padStart(2,'0') : null};
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(JSON.stringify({active:traffic.state!=='idle',ts:now,timestamp:now,traffic,bandSettings:this.getBandSettings(),
        session,sessions:{codex:session},daily:quotas.dailyUsage || null,
        limits:url.pathname.endsWith('/compact') ? {codex} : {...quotas,codex},
        quotaMeta:this.quotaCollector.getQuotaMeta(),
      }));
      return;
    }
    if(url.pathname==='/' || url.pathname==='/preview') {
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      res.end('<!doctype html><meta charset="utf-8"><title>Nexo GPT</title><h1>Nexo · GPT / Codex</h1><pre id="status"></pre><script>setInterval(async()=>{document.querySelector("pre").textContent=JSON.stringify(await(await fetch("/api/status")).json(),null,2)},1000)</script>');return;
    }
    res.writeHead(404);res.end();
  }
  stop():void {this.server?.close();this.server=null;}
}
