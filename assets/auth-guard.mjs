/** Single-flight refreshes, with logout invalidation. Holds no credentials. */
export function createRefreshGate(){
 let generation=0;
 let pending=null;
 return Object.freeze({
  current:()=>generation,
  isCurrent:ticket=>ticket===generation,
  invalidate:()=>{generation++;pending=null;},
  run(operation){
   if(pending)return pending;
   const epoch=generation;
   const current=()=>generation===epoch;
   const job=Promise.resolve().then(()=>operation(current));
   pending=job;
   const done=()=>{if(pending===job)pending=null;};
   job.then(done,done);
   return job;
  }
 });
}
