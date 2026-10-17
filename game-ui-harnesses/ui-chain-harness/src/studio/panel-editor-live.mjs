// Schedules editor preview work only. Publication, composition, history and
// provisional renderer cleanup remain owned by the caller.
export function createPanelEditorLive({apply,delay=180,setTimer=(callback,ms)=>setTimeout(callback,ms),clearTimer=id=>clearTimeout(id),onError}={}){
  if(typeof apply!=='function'||typeof setTimer!=='function'||typeof clearTimer!=='function'||!Number.isFinite(delay)||delay<0||onError!==undefined&&typeof onError!=='function')throw new TypeError('Invalid live editor scheduler options.');
  let scope=null,epoch=0,versions=new Map(),queued=new Map(),running=false,ready=false,timer,timed=false,timerVersion=0;
  const waiters=[];
  function disarm(){timerVersion++;if(timed){timed=false;clearTimer(timer);timer=undefined;}}
  function settle(){
    if(running||queued.size)return;
    ready=false;
    for(const waiter of waiters.splice(0))waiter.resolve(waiter.results);
  }
  function outcome(value){for(const waiter of waiters)waiter.results.push(value);}
  async function pump(){
    if(running||!ready||!queued.size){settle();return;}
    running=true;
    try{
      while(ready&&queued.size){
        const [group,job]=queued.entries().next().value;queued.delete(group);
        const isCurrent=()=>job.epoch===epoch&&versions.get(group)===job.version;
        let result;
        try{
          const value=await apply(job.request,{isCurrent});
          result={status:isCurrent()?'fulfilled':'stale',request:job.request,value};
        }catch(reason){
          result={status:isCurrent()?'rejected':'stale',request:job.request,reason};
          if(isCurrent()&&onError)try{onError(reason,job.request,{isCurrent});}catch(notificationError){result.notificationError=notificationError;}
        }
        outcome(result);
      }
    }finally{running=false;settle();}
  }
  function arm(){
    disarm();const version=timerVersion;timed=true;
    timer=setTimer(()=>{
      // A cleared callback may already be queued by the host. It must not
      // start cancelled work or clear the timer belonging to a newer input.
      if(!timed||version!==timerVersion)return;
      timed=false;timer=undefined;ready=true;void pump();
    },delay);
  }
  function cancel(){
    disarm();epoch++;scope=null;versions=new Map();queued.clear();ready=false;settle();
  }
  return {
    /** Snapshot raw values; the newest input for each node/group replaces it. */
    schedule(request){
      if(!request||typeof request!=='object'||Array.isArray(request)||!['variantKey','nodeId','group'].every(key=>typeof request[key]==='string'&&request[key].length))throw new TypeError('Live preview requests need variantKey, nodeId and group.');
      const snapshot=structuredClone(request);
      if(!scope||scope.variantKey!==snapshot.variantKey||scope.nodeId!==snapshot.nodeId){cancel();scope={variantKey:snapshot.variantKey,nodeId:snapshot.nodeId};}
      const version=(versions.get(snapshot.group)??0)+1;versions.set(snapshot.group,version);
      // Reinsertion retains the chronological order of latest group changes.
      queued.delete(snapshot.group);queued.set(snapshot.group,{request:snapshot,version,epoch});
      if(waiters.length){disarm();ready=true;void pump();}
      else{ready=false;arm();}
    },
    /** Drain serially, returning settled outcomes; never reject a timer task.
     * Outcomes are fulfilled, rejected, or stale, with request/value/reason.
     * New inputs during this flush are coalesced and drained before it resolves.
     */
    flush(){
      if(!running&&!queued.size)return Promise.resolve([]);
      const promise=new Promise(resolve=>waiters.push({resolve,results:[]}));
      disarm();ready=true;void pump();return promise;
    },
    // In-flight work cannot be forcibly stopped. apply must check isCurrent()
    // after awaits, before publishing, and dispose any stale preview resources.
    cancel,
    get pending(){return queued.size>0;},
    get active(){return running;},
  };
}
