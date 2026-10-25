/** Worker-only SDK contract fixture. Real Node files, deliberately asynchronous
 * copy/rename, no Android runtime or user files. Used to exercise the actual
 * ExpoLegacyInspectionFiles driver without importing unavailable native modules.
 */
export const inspectionExpoMock = `
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const unwrap=value=>typeof value==='string'?(value.startsWith('file://')?fileURLToPath(value):value):fileURLToPath(value.uri);
const fault=(phase,details)=>globalThis.inspectionFault?.(phase,details);
export const FileMode={ReadOnly:'r'};
export class Directory{
  constructor(...parts){this.path=path.join(...parts.map(unwrap));}
  get uri(){return pathToFileURL(this.path+path.sep).href;}
  get name(){return path.basename(this.path);}
  get exists(){return fs.existsSync(this.path);}
  create(options={}){if(this.exists&&!options.idempotent)throw Error('EXISTS');fs.mkdirSync(this.path,{recursive:!!options.intermediates});}
  list(){return fs.readdirSync(this.path,{withFileTypes:true}).map(entry=>entry.isDirectory()?new Directory(this,entry.name):new File(this,entry.name));}
}
export class File{
  constructor(...parts){this.path=path.join(...parts.map(unwrap));}
  get uri(){return pathToFileURL(this.path).href;}
  get name(){return path.basename(this.path);}
  get exists(){return fs.existsSync(this.path);}
  get size(){return fs.statSync(this.path).size;}
  create(){fault('create-before',{path:this.path});fs.writeFileSync(this.path,'',{flag:'wx'});}
  write(text){fault('write-before',{path:this.path});fs.writeFileSync(this.path,text);fault('write-after',{path:this.path});}
  async text(){fault('text-before',{path:this.path});return fs.readFileSync(this.path,'utf8');}
  async copy(destination,options){
    globalThis.inspectionCalls.push({phase:'copy-start',source:this.uri,destination:destination.uri});
    if(!options.overwrite||destination.size!==0)throw Error('BAD_RESERVATION');
    await new Promise(resolve=>setTimeout(resolve,10));fs.copyFileSync(this.path,destination.path);
    globalThis.inspectionCalls.push({phase:'copy-finish'});
  }
  open(mode){
    if(mode!=='r')throw Error('SOURCE_WRITE_OPEN');fault('file-open',{path:this.path});const fd=fs.openSync(this.path,'r');let offset=0;
    return{get size(){return fs.fstatSync(fd).size;},readBytes(length){const bytes=Buffer.alloc(length);const n=fs.readSync(fd,bytes,0,length,offset);offset+=n;return new Uint8Array(bytes.subarray(0,n));},close(){fs.closeSync(fd);}};
  }
}
export const Paths={document:new Directory(globalThis.inspectionRoot)};
export async function moveAsync({from,to}){
  globalThis.inspectionCalls.push({phase:'rename-start',from,to});
  fault('rename-before',{from,to});
  await new Promise(resolve=>setTimeout(resolve,10));if(fs.existsSync(fileURLToPath(to)))throw Error('OVERWRITE_FORBIDDEN');
  fs.renameSync(fileURLToPath(from),fileURLToPath(to));fault('rename-after',{from,to});globalThis.inspectionCalls.push({phase:'rename-finish',to});
}
export async function openDatabaseAsync(name,options,directory){
  const file=path.join(fileURLToPath(directory),name);if(options.useNewConnection!==true)throw Error('SHARED_CONNECTION');
  globalThis.inspectionCalls.push({phase:'sqlite',file});const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(file);
  globalThis.inspectionHandles??=new Set();globalThis.inspectionHandles.add(db);
  async function call(kind,sql,args,run){globalThis.inspectionSqlCalls??=[];globalThis.inspectionSqlCalls.push({kind,sql,file});fault('sql-before',{kind,sql,file});await Promise.resolve();const result=run();fault('sql-after',{kind,sql,file});return result;}
  return{getAllAsync:async(sql,...args)=>call('all',sql,args,()=>db.prepare(sql).all(...args)),getFirstAsync:async(sql,...args)=>call('first',sql,args,()=>db.prepare(sql).get(...args)??null),
    runAsync:async(sql,...args)=>call('run',sql,args,()=>{const r=db.prepare(sql).run(...args);return{changes:Number(r.changes),lastInsertRowId:Number(r.lastInsertRowid)};}),
    execAsync:async(sql)=>call('exec',sql,[],()=>{db.exec(sql);}),closeAsync:async()=>{db.close();globalThis.inspectionHandles.delete(db);}};
}
export const Platform={OS:'android'};
export const uuid={v4:()=>globalThis.inspectionAllocate?globalThis.inspectionAllocate():randomUUID()};
`;
