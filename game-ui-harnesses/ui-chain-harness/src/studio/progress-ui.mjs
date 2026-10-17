import {elapsedText,projectProgress} from './progress.mjs';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const labels={done:'已完成',active:'进行中',waiting:'待开始',blocked:'需处理',recovering:'恢复中'};
export function progressMeter(label,value,total){const box=el('div',undefined,'progress-meter'),line=el('div',undefined,'progress-label');line.append(el('span',label),el('strong',value+' / '+total));const meter=el('progress');meter.max=total;meter.value=value;meter.setAttribute('aria-label',label);box.append(line,meter);return box;}
export function stepsList(steps,compact=false){const list=el('ol',undefined,'step-list'+(compact?' compact-steps':''));for(const [i,step] of steps.entries()){const li=el('li');li.dataset.state=step.state;if(step.state==='active'||step.state==='recovering')li.setAttribute('aria-current','step');const mark=el('span',step.state==='done'?'✓':String(i+1),'step-mark'),body=el('div',undefined,'step-body'),header=el('div',undefined,'step-heading');header.append(el('strong',step.label),el('span',labels[step.state],'step-state'));body.append(header);if(step.hint)body.append(el('p',step.hint,'muted'));li.append(mark,body);list.append(li);}return list;}
export function elapsed(start,end){const node=el('span',undefined,'elapsed');if(!start){node.hidden=true;return node;}node.dataset.startedAt=start;if(end)node.dataset.finishedAt=end;node.textContent=(end?'用时 ':'已用 ')+elapsedText(start,end);return node;}
export function refreshElapsed(){for(const n of document.querySelectorAll('[data-started-at]')){const value=elapsedText(n.dataset.startedAt,n.dataset.finishedAt);n.textContent=value?(n.dataset.finishedAt?'用时 ':'已用 ')+value:'';}}
export function renderProjectProgress(project){
 const p=projectProgress(project),flow=document.querySelector('#project-stages');flow.replaceChildren(...stepsList(p.flow,true).children);
 const stats=document.querySelector('#progress-stats');stats.replaceChildren(progressMeter('图集接收',p.received,p.sheetTotal),progressMeter('本地处理步骤',p.passed,p.total));
 const local=document.querySelector('#local-progress');local.hidden=!project.batchReady&&!project.task;
 const timeline=document.querySelector('#local-step-list');timeline.replaceChildren(stepsList(p.stages));
 document.querySelector('#local-progress-status').textContent=p.current;
 const timing=document.querySelector('#processing-timing');timing.replaceChildren(elapsed(project.busy||project.processingFinishedAt?project.processingStartedAt:null,project.processingFinishedAt));
 document.querySelector('#progress-current').textContent=p.current;
 return p;
}
