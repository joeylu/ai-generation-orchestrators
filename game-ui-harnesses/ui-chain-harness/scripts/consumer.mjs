import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs,promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {inspectConsumer,consumerServer} from '../src/runtime/consumer-tools.mjs';
import {hash,json,readSafe} from '../src/skins/package.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),run=promisify(execFile);
const {positionals,values}=parseArgs({allowPositionals:true,options:{package:{type:'string'},directory:{type:'string'},port:{type:'string'}}});
const help='使用：npm run consumer -- build --package <皮肤包> | select --directory <消费包> | check | status | preview [--port 4189]';
try{
  const action=positionals[0];if(!action||action==='help'){console.log(help);process.exit(0);}
  if(positionals.length!==1||!['build','select','check','status','preview'].includes(action))throw Error('ARGUMENTS');
  const config=JSON.parse(await readFile(join(root,'configs/consumer-workflow.json')));
  const local=p=>{const absolute=resolve(root,p),r=relative(join(root,'work'),absolute);if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('WORK_PATH_REQUIRED');return absolute;};
  if(config.version!=='1.0')throw Error('CONFIG_VERSION');
  const pointer=local(config.selection),output=local(config.output),evidenceRoot=local(config.evidence);
  async function save(value){await mkdir(dirname(pointer),{recursive:true});const temp=pointer+'.'+randomUUID()+'.tmp';await writeFile(temp,json(value),{flag:'wx'});await rename(temp,pointer);}
  async function command(name,args){return (await run(process.execPath,[join(root,'scripts',name),...args],{cwd:root,maxBuffer:4*1024*1024,windowsHide:true})).stdout.trim();}
  if(action==='build'||action==='select'){
    if(action==='build'&&!values.package||action==='select'&&!values.directory)throw Error('ARGUMENTS');
    const dir=action==='build'?(await command('consumer-pack.mjs',['--package',resolve(values.package),'--out',output])).split(/\r?\n/).at(-1):local(values.directory);
    const snapshot=await inspectConsumer(local(dir));await save({version:'1.0',directory:relative(root,dir).replaceAll('\\','/'),manifestSha256:snapshot.manifestSha256});
    console.log('已选中消费候选包：'+relative(root,dir)+'\n下一步：npm run consumer -- check');
  }else{
    let current;try{current=JSON.parse(await readFile(pointer));}catch(e){if(e.code==='ENOENT')throw Error('NO_SELECTION');throw e;}
    if(current.version!=='1.0')throw Error('SELECTION_INVALID');
    const dir=local(current.directory),snapshot=await inspectConsumer(dir,current.manifestSha256);
    if(action==='check'){
      const result=JSON.parse(await command('consumer-check.mjs',[dir]));
      const bytes=await readSafe(result.directory,'checks.json'),report=JSON.parse(bytes);
      if(report.status!=='passed'||report.manifestSha256!==snapshot.manifestSha256)throw Error('CHECK_REPORT_INVALID');
      const evidence=join(evidenceRoot,randomUUID());await mkdir(evidence,{recursive:true});
      for(const name of ['checks.json','wide.png','tall.png'])await writeFile(join(evidence,name),await readSafe(result.directory,name),{flag:'wx'});
      await inspectConsumer(dir,current.manifestSha256);
      await save({...current,check:{file:relative(root,join(evidence,'checks.json')).replaceAll('\\','/'),sha256:hash(bytes)}});
      console.log(`检查通过：${report.components} 类组件，${report.checks} 项检查，独立加载正常。\n证据：${relative(root,evidence)}\n下一步：npm run consumer -- preview`);
    }else{
      let checked=false;
      if(current.check){const bytes=await readFile(local(current.check.file));if(hash(bytes)!==current.check.sha256)throw Error('CHECK_REPORT_CHANGED');const report=JSON.parse(bytes);checked=report.status==='passed'&&report.manifestSha256===snapshot.manifestSha256;}
      console.log(`当前包：${current.directory}\n文件完整性：通过\n独立消费检查：${checked?'通过':'尚未执行'}\n发布状态：候选，未正式发布`);
      if(action==='preview'){
        const port=Number(values.port??config.port);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT_INVALID');
        const server=consumerServer(snapshot,port);server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'端口已占用，请用 --port 指定其他端口。':'预览启动失败：'+e.code);process.exitCode=1;});
        server.listen(port,'127.0.0.1',()=>console.log(`本地预览：http://127.0.0.1:${port}/`));
      }
    }
  }
}catch(e){
  const messages={NO_SELECTION:'还没有选中的包，请先 build 或 select。',CONSUMER_FILE_CHANGED:'包内文件已变化，请重新构建，不要手改生成文件。',CONSUMER_MANIFEST_CHANGED:'包清单已变化，请重新选择并检查。',ARGUMENTS:help,WORK_PATH_REQUIRED:'请选择本项目 work 目录内的候选包。'};
  console.error(messages[e.message]??('操作失败：'+(e.code??e.message)+'。未将本次操作标记为成功。'));
  if(e.stderr)console.error(e.stderr);process.exitCode=1;
}
