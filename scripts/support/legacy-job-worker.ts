import { Worker } from "node:worker_threads";
import type { LegacyCandidateJob } from "../../apps/mobile/src/features/legacy-import/public.ts";
import { inspectionExpoMock } from "./inspection-expo-mock.ts";

export interface LegacyJobWorkerInput {
  readonly root: string; readonly source: string;
  readonly action: "start" | "resume" | "create" | "list" | "busy";
  readonly jobId?: string; readonly clock?: string; readonly reuseCopy?: boolean;
  readonly fault?: "before-request-write" | "after-request-write" | "after-request-rename";
  readonly interruptAt?: string; readonly killAt?: string; readonly mutateRequest?: "before-commit" | "after-commit";
  readonly forbidSource?: boolean; readonly forbidAllocation?: boolean;
}
export interface LegacyJobWorkerReply {
  readonly ok: boolean; readonly code?: string; readonly phase?: "paused";
  readonly jobs: readonly LegacyCandidateJob[];
  readonly issues: readonly { jobId: string; reason: string }[];
  readonly counts?: readonly number[]; readonly importedAt?: string; readonly referenceDay?: string;
  readonly issued: number; readonly handles: number; readonly paths: readonly string[];
  readonly walWrites: number;
  readonly originalRequest?: string; readonly busyCode?: string; readonly terminated?: boolean;
}
const worker = `import{parentPort,workerData as data}from'node:worker_threads';import{registerHooks}from'node:module';
import fs from'node:fs';import path from'node:path';import{randomUUID}from'node:crypto';
globalThis.inspectionRoot=data.root;globalThis.inspectionCalls=[];let issued=0,failed=false,commitReady=false,originalRequest,busyCode;
globalThis.inspectionAllocate=()=>{issued++;if(data.forbidAllocation)throw Error('UNEXPECTED_ALLOCATION');return randomUUID();};
registerHooks({resolve(specifier,context,next){if(['expo-file-system','expo-file-system/legacy','expo-sqlite','react-native','expo-modules-core'].includes(specifier))return{url:data.mock,shortCircuit:true};return next(specifier,context);}});
const{File}=await import('expo-file-system');const{ExpoLegacyInspectionFiles}=await import(data.inspectionDriver);
const{prepareLegacyInspectionCopy}=await import(data.copyProtocol);const{ExpoLegacyCandidateJobs}=await import(data.jobsDriver);
const{createLegacyCandidateRuntime}=await import(data.runtime);const jobsStore=new ExpoLegacyCandidateJobs();
const operation='11111111-1111-4111-8111-111111111111';const now=data.clock??'2026-10-24T12:00:00.000Z';
const runtime=createLegacyCandidateRuntime('local-trainer',()=>new Date(now));
const requestPath=id=>path.join(data.root,'legacy-import-jobs',id,'request.json');
const changeRequest=()=>{const old=JSON.parse(originalRequest);fs.writeFileSync(requestPath(old.jobId),JSON.stringify({...old,referenceDay:'2027-01-01'}));};
globalThis.inspectionFault=(phase,details)=>{
 if(data.forbidSource&&phase==='file-open'&&details.path===data.source)throw Error('EXTERNAL_SOURCE_READ');
 if(!failed&&data.fault&&((data.fault==='before-request-write'&&phase==='write-before'&&details.path.endsWith('request.partial'))||(data.fault==='after-request-write'&&phase==='write-after'&&details.path.endsWith('request.partial'))||(data.fault==='after-request-rename'&&phase==='rename-after'&&details.to.endsWith('/request.json')))){failed=true;throw Error('PRIVATE FILE DEVICE DETAILS');}
 if(data.mutateRequest==='after-commit'&&commitReady&&!failed&&phase==='sql-after'&&details.kind==='exec'&&details.sql==='COMMIT'){failed=true;changeRequest();}
};
async function summary(ok,extra={}){const listing=await runtime.list();return{ok,jobs:listing.jobs,issues:listing.issues,issued,handles:globalThis.inspectionHandles?.size??0,paths:globalThis.inspectionCalls.filter(c=>c.phase==='sqlite').map(c=>c.file),walWrites:(globalThis.inspectionSqlCalls??[]).filter(c=>c.kind==='exec'&&/^PRAGMA\\s+journal_mode\\s*=/iu.test(c.sql)).length,originalRequest,busyCode,...extra};}
let signal,release;const held=new Promise(resolve=>{signal=resolve;});const proceed=new Promise(resolve=>{release=resolve;});
async function checkpoint(phase){
 if(phase==='before-commit'&&data.mutateRequest){const job=(await runtime.list()).jobs[0];originalRequest=fs.readFileSync(requestPath(job.jobId),'utf8');if(data.mutateRequest==='before-commit')changeRequest();else commitReady=true;}
 if(phase===data.interruptAt)throw Error('PRIVATE CALLBACK SOURCE CONTENTS');
 if(phase===data.killAt){parentPort.postMessage(await summary(false,{phase:'paused'}));await new Promise(()=>{});}
 if(data.action==='busy'&&phase==='before-commit'){signal();await proceed;}
}
try{
 let result;
 if(data.action==='list'){parentPort.postMessage(await summary(true));}
 else if(data.action==='resume'){result=await runtime.resume(data.jobId,checkpoint);}
 else{
  const files=new ExpoLegacyInspectionFiles(data.reuseCopy?null:new File(data.source));
  const receipt=data.reuseCopy?(await files.inspectReady(operation)).receipt:await prepareLegacyInspectionCopy(files,operation);
  if(data.action==='create')await jobsStore.create({kind:'athlete-diary-legacy-candidate',version:1,jobId:data.jobId,source:receipt,targetWorkspaceId:'local-trainer',importedAt:now,referenceDay:'2026-10-24'});
  else if(data.action==='busy'){
   const pending=runtime.start(receipt,checkpoint);await held;const id=(await runtime.list()).jobs[0].jobId;
   const before=globalThis.inspectionCalls.length;try{await runtime.resume(id);}catch(error){busyCode=error.message;}if(globalThis.inspectionCalls.length!==before)throw Error('BUSY_REQUEST_OPENED_FILES');
   release();result=await pending;const beforeReplay=issued;await runtime.resume(id);if(issued!==beforeReplay)throw Error('REPLAY_ALLOCATED');
  }else result=await runtime.start(receipt,checkpoint);
 }
 if(data.action!=='list')parentPort.postMessage(await summary(true,result?{counts:[result.candidate.owners.executions.performedFacts,result.candidate.owners.measurements.measurementRows,result.candidate.owners.nutrition.nutritionEntryRows,result.candidate.owners.calendar.calendarAppointmentRows],importedAt:result.job.importedAt,referenceDay:result.job.referenceDay}:{}));
}catch(error){parentPort.postMessage(await summary(false,{code:error.message}));}
`;

export function runLegacyJobWorker(input: LegacyJobWorkerInput): Promise<LegacyJobWorkerReply> {
  return new Promise((resolve, reject) => {
    const task = new Worker(new URL(`data:text/javascript,${encodeURIComponent(worker)}`), { execArgv: ["--experimental-strip-types"], workerData: {
      ...input, mock: `data:text/javascript,${encodeURIComponent(inspectionExpoMock)}`,
      inspectionDriver: new URL("../../apps/mobile/src/features/legacy-import/data/ExpoLegacyInspectionFiles.ts", import.meta.url).href,
      copyProtocol: new URL("../../apps/mobile/src/features/legacy-import/data/LegacyInspectionCopy.ts", import.meta.url).href,
      jobsDriver: new URL("../../apps/mobile/src/features/legacy-import/data/ExpoLegacyCandidateJobs.ts", import.meta.url).href,
      runtime: new URL("../../apps/mobile/src/app/composition/createLegacyCandidateRuntime.ts", import.meta.url).href,
    } });
    let received: LegacyJobWorkerReply | null = null;
    const timer = setTimeout(() => { void task.terminate(); reject(new Error("LEGACY_JOB_FIXTURE_TIMEOUT")); }, 20000);
    task.once("message", (message: LegacyJobWorkerReply) => { received = message; if (message.phase === "paused" && input.killAt) void task.terminate(); });
    task.once("error", (error) => { clearTimeout(timer); reject(error); });
    task.once("exit", (code) => {
      clearTimeout(timer);
      if (received?.phase === "paused" && input.killAt) resolve({ ...received, terminated: true });
      else if (code || received === null) reject(new Error(`LEGACY_JOB_FIXTURE_EXIT_${code}`));
      else resolve(received);
    });
  });
}
