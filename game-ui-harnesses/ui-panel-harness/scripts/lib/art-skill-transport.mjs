import {spawn} from 'node:child_process';
import {open} from 'node:fs/promises';
import {resolve} from 'node:path';

/** One final message from one tool-disabled CLI turn; never repair or resubmit. */
export function artEventCollector(){
  let thread=false,started=false,completed=false,finalText=null,usage=null,lastReconnect=1,fallback=false;
  const fail=code=>{throw new Error(code);};
  return {
    accept(line){
      if(!line.trim())return;
      let event;try{event=JSON.parse(line);}catch{fail('ART_CLI_EVENT_JSON');}
      if(event.type==='error'){
        const match=typeof event.message==='string'&&/^Reconnecting\.\.\. ([2-5])\/5(?: \([^\r\n]{0,2048}\))?$/.exec(event.message);
        if(!match||!started||completed||finalText!==null||Number(match[1])<=lastReconnect)fail('ART_CLI_EVENT_FAILURE');
        lastReconnect=Number(match[1]);return;
      }
      if(event.type==='thread.started'){
        if(thread||started||completed||typeof event.thread_id!=='string')fail('ART_CLI_EVENT_ORDER');thread=true;
      }else if(event.type==='turn.started'){
        if(!thread||started||completed)fail('ART_CLI_EVENT_ORDER');started=true;
      }else if(['item.started','item.updated','item.completed'].includes(event.type)){
        if(!started||completed)fail('ART_CLI_EVENT_ORDER');
        if(event.type==='item.completed'&&event.item?.type==='error'){
          if(fallback||finalText!==null||!/^Falling back from WebSockets to HTTPS transport\.(?: [^\r\n]{1,2048})?$/.test(event.item.message??''))fail('ART_CLI_EVENT_FAILURE');fallback=true;return;
        }
        if(!['reasoning','agent_message'].includes(event.item?.type))fail('ART_CLI_TOOL_FORBIDDEN');
        if(event.type==='item.completed'&&event.item.type==='agent_message'){
          if(finalText!==null||typeof event.item.text!=='string'||!event.item.text.trim())fail('ART_CLI_FINAL_MESSAGE');finalText=event.item.text;
        }
      }else if(event.type==='turn.completed'){
        if(!started||completed||finalText===null)fail('ART_CLI_EVENT_ORDER');completed=true;
        if(event.usage!=null){
          if(![event.usage.input_tokens,event.usage.cached_input_tokens,event.usage.output_tokens].every(n=>Number.isSafeInteger(n)&&n>=0)
            ||event.usage.cached_input_tokens>event.usage.input_tokens)fail('ART_CLI_USAGE');
          usage={inputTokens:event.usage.input_tokens,cachedInputTokens:event.usage.cached_input_tokens,outputTokens:event.usage.output_tokens};
        }
      }else fail('ART_CLI_EVENT_FAILURE');
    },
    finish(){if(!thread||!started||!completed||finalText===null)fail('ART_CLI_INDETERMINATE');return{finalText,usage};},
  };
}

export async function invokeFrozenArtCli({executable,args,prompt,directory,timeoutMs,runProcess=spawn}){
  const stdout=await open(resolve(directory,'cli.stdout.ndjson'),'wx'),stderr=await open(resolve(directory,'cli.stderr.txt'),'wx');
  const collector=artEventCollector(),decoder=new TextDecoder('utf-8',{fatal:true});
  let writes=Promise.resolve(),writeFailure=null;
  try{return await new Promise((resolveResult,reject)=>{
    let child,buffer='',failure=null,total=0,errorBytes=0,closed=false,timer,killTimer;
    const fail=code=>{
      if(failure||closed)return;failure=code instanceof Error?code:new Error(code);
      try{child?.kill('SIGTERM');}catch{}
      killTimer=setTimeout(()=>{try{child?.kill('SIGKILL');}catch{}},250);
    };
    const append=(handle,bytes)=>{writes=writes.then(()=>handle.writeFile(bytes)).catch(error=>{writeFailure??=error;fail(error);});};
    try{child=runProcess(executable,args,{cwd:directory,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});}
    catch{reject(new Error('ART_CLI_START_FAILED'));return;}
    timer=setTimeout(()=>fail('ART_CLI_TIMEOUT_NO_RETRY'),timeoutMs);
    child.stdout.on('data',bytes=>{
      append(stdout,bytes);total+=bytes.length;if(total>4*1024*1024){fail('ART_CLI_OUTPUT_LIMIT');return;}
      if(failure)return;
      try{buffer+=decoder.decode(bytes,{stream:true});let index;
        while((index=buffer.indexOf('\n'))>=0){collector.accept(buffer.slice(0,index));buffer=buffer.slice(index+1);}
        if(Buffer.byteLength(buffer)>2*1024*1024)fail('ART_CLI_OUTPUT_LIMIT');
      }catch(error){fail(error);}
    });
    child.stderr.on('data',bytes=>{append(stderr,bytes);errorBytes+=bytes.length;if(errorBytes>128*1024)fail('ART_CLI_OUTPUT_LIMIT');});
    child.stdin.on('error',()=>fail('ART_CLI_STDIN_FAILED'));
    child.once('error',()=>fail('ART_CLI_START_FAILED'));
    child.once('close',code=>{
      closed=true;clearTimeout(timer);clearTimeout(killTimer);
      if(failure){reject(failure);return;}if(code!==0){reject(new Error('ART_CLI_EXIT_FAILED'));return;}
      try{buffer+=decoder.decode();collector.accept(buffer);resolveResult(collector.finish());}catch(error){reject(error);}
    });
    try{child.stdin.end(prompt);}catch{fail('ART_CLI_STDIN_FAILED');}
  });}finally{await writes;await stdout.close();await stderr.close();if(writeFailure)throw new Error('ART_CLI_LOG_SAVE_FAILED');}
}

/** A failed or indeterminate stage cannot dispatch any later condition. */
export async function runArtSteps(steps,{invoke,accept}){
  const accepted=[];
  for(const step of steps){const response=await invoke(step);accepted.push(await accept(step,response));}
  return accepted;
}
