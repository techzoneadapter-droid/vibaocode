import { ChildProcess, spawn } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import net from "net";
import os from "os";
import path from "path";

type ProcState = { child: ChildProcess; repo: string; branch: string; dir: string; port: number; logs: string; lastActive: number };
type Store = { projects: Map<string, ProcState> };
declare global { var __vibaoLocalStore: Store | undefined; }
const store = globalThis.__vibaoLocalStore || (globalThis.__vibaoLocalStore = { projects: new Map() });
const MAX_LOG = 120000;

export function isLocalRuntime() {
  if (process.env.VIBAO_RUNTIME) return process.env.VIBAO_RUNTIME === "local";
  return !process.env.VERCEL;
}
function baseDir() { return process.env.LOCALAPPDATA || process.env.APPDATA || path.join(os.homedir(), ".vibaocode"); }
function workspaceRoot() { return path.resolve(process.env.VIBAO_WORKSPACE_ROOT || path.join(baseDir(), "Vibaocode", "workspaces")); }
function cacheRoot() { return path.join(baseDir(), "Vibaocode", "cache"); }
function safe(v: string) { return v.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace"; }
function key(repo: string, branch: string) { return `${repo}#${branch}`; }
export function localRepoDirectory(repo: string, branch: string) { const [o="repo",n="project"] = repo.split("/"); return path.join(workspaceRoot(), safe(o), safe(n), safe(branch)); }
const npm = () => process.platform === "win32" ? "npm.cmd" : "npm";
const git = () => process.platform === "win32" ? "git.exe" : "git";

function run(cmd: string, args: string[], cwd?: string, timeoutMs=180000) {
  return new Promise<{exitCode:number;stdout:string;stderr:string}>((resolve,reject)=>{
    const child=spawn(cmd,args,{cwd,env:{...process.env,CI:"1"},windowsHide:true,shell:false});
    let stdout="",stderr="";
    child.stdout?.on("data",d=>stdout+=String(d)); child.stderr?.on("data",d=>stderr+=String(d));
    const timer=setTimeout(()=>killTree(child.pid||0),timeoutMs);
    child.on("error",reject); child.on("exit",code=>{clearTimeout(timer);resolve({exitCode:code??1,stdout,stderr});});
  });
}
function exists(cmd:string){return new Promise<boolean>(resolve=>{const c=spawn(process.platform==="win32"?"where":"which",[cmd],{stdio:"ignore",windowsHide:true});c.on("error",()=>resolve(false));c.on("exit",x=>resolve(x===0));});}
async function tooling(){if(!await exists("git"))throw new Error("Máy chưa có Git hoặc Git chưa nằm trong PATH.");if(!await exists("npm"))throw new Error("Máy chưa có Node.js/npm hoặc npm chưa nằm trong PATH.");}

export async function ensureLocalRepo(repo:string,branch:string,token="",force=false){
  await tooling(); const dir=localRepoDirectory(repo,branch); await fsp.mkdir(path.dirname(dir),{recursive:true});
  if(!fs.existsSync(path.join(dir,".git"))){
    const url=token?`https://x-access-token:${encodeURIComponent(token)}@github.com/${repo}.git`:`https://github.com/${repo}.git`;
    const r=await run(git(),["clone","--branch",branch,"--single-branch",url,dir],undefined,240000); if(r.exitCode)throw new Error(`Git clone thất bại: ${(r.stderr||r.stdout).slice(-2500)}`);
  }else if(force){
    let r=await run(git(),["fetch","origin",branch],dir,120000); if(r.exitCode)throw new Error(`Git fetch thất bại: ${r.stderr.slice(-1800)}`);
    r=await run(git(),["reset","--hard",`origin/${branch}`],dir,60000); if(r.exitCode)throw new Error(`Git reset thất bại: ${r.stderr.slice(-1800)}`);
  }
  return dir;
}
async function pkg(dir:string){return JSON.parse(await fsp.readFile(path.join(dir,"package.json"),"utf8")) as {scripts?:Record<string,string>,dependencies?:Record<string,string>,devDependencies?:Record<string,string>};}
function stamp(dir:string){for(const n of ["package-lock.json","pnpm-lock.yaml","yarn.lock"]){const f=path.join(dir,n);if(fs.existsSync(f)){const s=fs.statSync(f);return `${n}:${s.size}:${s.mtimeMs}`;}}const s=fs.statSync(path.join(dir,"package.json"));return `pkg:${s.size}:${s.mtimeMs}`;}
export async function installLocalDependencies(dir:string){
  const sf=path.join(dir,"node_modules",".vibaocode-install-stamp"), st=stamp(dir); try{if(await fsp.readFile(sf,"utf8")===st)return;}catch{}
  const r=await run(npm(),["install","--no-audit","--no-fund"],dir,600000); if(r.exitCode)throw new Error(`npm install thất bại: ${(r.stderr||r.stdout).slice(-3000)}`);
  await fsp.mkdir(path.dirname(sf),{recursive:true}); await fsp.writeFile(sf,st).catch(()=>{});
}
async function freePort(start=4173){for(let p=start;p<start+300;p++){if(await new Promise<boolean>(res=>{const s=net.createServer();s.unref();s.once("error",()=>res(false));s.listen(p,"0.0.0.0",()=>s.close(()=>res(true)));}))return p;}throw new Error("Không tìm được cổng local trống.");}
function lanIp(){for(const g of Object.values(os.networkInterfaces()))for(const x of g||[])if(x.family==="IPv4"&&!x.internal&&!x.address.startsWith("169.254."))return x.address;return "127.0.0.1";}
async function waitPort(port:number,child:ChildProcess){const end=Date.now()+90000;while(Date.now()<end){if(child.exitCode!==null)return false;if(await new Promise<boolean>(res=>{const s=net.createConnection({host:"127.0.0.1",port});s.setTimeout(500);s.once("connect",()=>{s.destroy();res(true)});s.once("timeout",()=>{s.destroy();res(false)});s.once("error",()=>res(false));}))return true;await new Promise(r=>setTimeout(r,650));}return false;}
function append(s:ProcState,d:unknown){s.logs=(s.logs+String(d)).slice(-MAX_LOG);s.lastActive=Date.now();}

export async function startLocalProject(repo:string,branch:string,dir:string,restart=false){
  const k=key(repo,branch), old=store.projects.get(k); if(old&&old.child.exitCode===null&&!restart){old.lastActive=Date.now();return {ok:true,previewUrl:`http://${lanIp()}:${old.port}`,localUrl:`http://127.0.0.1:${old.port}`,logs:old.logs};} if(old)await stopLocalProject(repo,branch);
  const p=await pkg(dir), deps={...(p.dependencies||{}),...(p.devDependencies||{})}; if(!p.scripts?.dev&&!p.scripts?.start)throw new Error("Project không có script dev/start.");
  const port=await freePort(); let args:string[]; const env:NodeJS.ProcessEnv={...process.env,BROWSER:"none",CI:"",PORT:String(port),HOST:"0.0.0.0"};
  if(p.scripts?.dev&&"next" in deps)args=["run","dev","--","--hostname","0.0.0.0","--port",String(port)]; else if(p.scripts?.dev&&"vite" in deps)args=["run","dev","--","--host","0.0.0.0","--port",String(port)]; else args=["run",p.scripts?.dev?"dev":"start"];
  const child=spawn(npm(),args,{cwd:dir,env,windowsHide:true,detached:process.platform!=="win32",stdio:["ignore","pipe","pipe"]}); const state:ProcState={child,repo,branch,dir,port,logs:"",lastActive:Date.now()}; store.projects.set(k,state); child.stdout?.on("data",d=>append(state,d));child.stderr?.on("data",d=>append(state,d));child.on("exit",c=>append(state,`\n[Vibaocode] server exit ${c??"?"}\n`));
  const ok=await waitPort(port,child); return {ok,previewUrl:`http://${lanIp()}:${port}`,localUrl:`http://127.0.0.1:${port}`,logs:state.logs};
}
export async function writeLocalFiles(repo:string,branch:string,files:Array<{path:string;content:string}>){const root=path.resolve(localRepoDirectory(repo,branch));let n=0;for(const f of files){const target=path.resolve(root,path.normalize(f.path).replace(/^[/\\]+/,""));if(!target.startsWith(root+path.sep))continue;await fsp.mkdir(path.dirname(target),{recursive:true});await fsp.writeFile(target,f.content,"utf8");n++;}const s=store.projects.get(key(repo,branch));if(s)s.lastActive=Date.now();return n;}
export function localLogs(repo:string,branch:string){const s=store.projects.get(key(repo,branch));if(s)s.lastActive=Date.now();return s?.logs||"";}
export async function localRevision(dir:string){return (await run(git(),["rev-parse","--short","HEAD"],dir,15000)).stdout.trim();}
export async function runLocalChecks(repo:string,branch:string,dir:string){const p=await pkg(dir),checks=[] as Array<{name:string;exitCode:number;stdout:string;stderr:string}>;for(const name of ["typecheck","lint","test","build"]){if(!p.scripts?.[name])continue;checks.push({name,...await run(npm(),["run",name],dir,name==="build"?300000:180000)});}const s=store.projects.get(key(repo,branch));let smokeStatus="unavailable";if(s&&s.child.exitCode===null)try{smokeStatus=String((await fetch(`http://127.0.0.1:${s.port}`,{signal:AbortSignal.timeout(5000)})).status)}catch{smokeStatus="000"}return {checks,smokeStatus,passed:checks.every(x=>x.exitCode===0)&&!["000","unavailable"].includes(smokeStatus)};}
function killTree(pid:number){if(!pid)return;if(process.platform==="win32")spawn("taskkill",["/PID",String(pid),"/T","/F"],{stdio:"ignore",windowsHide:true});else try{process.kill(-pid,"SIGTERM")}catch{try{process.kill(pid,"SIGTERM")}catch{}}}
export async function stopLocalProject(repo:string,branch:string){const k=key(repo,branch),s=store.projects.get(k);if(!s)return false;killTree(s.child.pid||0);store.projects.delete(k);return true;}
export async function stopAllLocalProjects(){const a=[...store.projects.values()];for(const s of a)killTree(s.child.pid||0);store.projects.clear();return a.length;}
export async function optimizeLocalMemory(idleMinutes=15){const cut=Date.now()-idleMinutes*60000;let n=0;for(const [k,s] of [...store.projects.entries()])if(s.child.exitCode!==null||s.lastActive<cut){killTree(s.child.pid||0);store.projects.delete(k);n++;}return n;}
export async function cleanLocalCache(){await fsp.mkdir(cacheRoot(),{recursive:true});let removed=0;for(const e of await fsp.readdir(cacheRoot(),{withFileTypes:true}).catch(()=>[])){const t=path.join(cacheRoot(),e.name),st=await fsp.stat(t).catch(()=>null);if(st&&st.mtimeMs<Date.now()-86400000){await fsp.rm(t,{recursive:true,force:true}).catch(()=>{});removed++;}}return {removed,cacheRoot:cacheRoot()};}
export function localSystemStats(){const total=os.totalmem(),free=os.freemem();return {runtime:"local",platform:process.platform,hostname:os.hostname(),cpuCount:os.cpus().length,totalMemory:total,freeMemory:free,usedMemory:total-free,appRss:process.memoryUsage().rss,workspaceRoot:workspaceRoot(),cacheRoot:cacheRoot(),projects:[...store.projects.values()].map(s=>({repo:s.repo,branch:s.branch,port:s.port,running:s.child.exitCode===null,pid:s.child.pid||0,lastActive:s.lastActive,previewUrl:`http://${lanIp()}:${s.port}`}))};}
