// A response belongs only to the period and session that started its request.
export function createRequestGuard(){
  let generation=0;
  return Object.freeze({begin:()=>++generation,invalidate:()=>{generation++;},isCurrent:ticket=>ticket===generation});
}
