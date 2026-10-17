import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {inspectAssembly} from '../../src/skins/postprocess.mjs';
import {encodePng} from '../../src/skins/png.mjs';
import {hash} from '../../src/skins/package.mjs';

// Ground truth comes from deliberately authored geometry, not detector output.
export function fixtureFor(entry){
  const rail=entry.fixture==='rail',width=rail?16:192,height=64;
  const image={width,height,pixels:Buffer.alloc(width*height*4)};
  const put=(x,y,c)=>image.pixels.set([...c,255],(y*width+x)*4);
  for(let y=0;y<height;y++)for(let x=0;x<(rail?16:128);x++){
    const local=x%64,corner=(local<12||local>=52)&&(y<12||y>=52);
    put(x,y,rail?(y<8||y>=56?[230,180,60]:[30,70,90]):corner?[230,180,60]:x<64?[40,80,110]:[130,30,70]);
  }
  const png=encodePng(image),assetId=rail?'rail':'panel',stretch=rail?'vertical':'nine-slice';
  const template={coordinates:{outputScale:1},sheets:[{id:'S01',parts:[{assetId,bodyRect:[0,0,rail?16:64,rail?128:64],stretch}]}]};
  const bytes=Buffer.from(JSON.stringify(template));
  const edges=rail?{left:0,right:0,top:8,bottom:8}:{left:13,right:13,top:13,bottom:13};
  const part={file:'source.png',sha256:hash(png),crop:[0,0,rail?16:64,64],metadata:{density:1,nineSlice:edges,contentInsets:{left:0,top:0,right:0,bottom:0},minSize:{width:32,height:32}}};
  if(rail)part.fit={method:'vertical-slice',caps:[8,8]};
  const config={templateSha256:hash(bytes),parts:{[assetId]:part}};
  switch(entry.fault){
    case 'none':break;
    case 'missing':config.parts={};break;
    case 'hash':part.sha256='0'.repeat(64);break;
    case 'outside':part.crop=[180,0,64,64];break;
    case 'slice-overflow':part.metadata.nineSlice.left=64;break;
    case 'caps-overflow':part.fit.caps=[40,40];break;
    case 'contain':delete part.fit;break;
    case 'empty':part.crop=[128,0,64,64];break;
    case 'neighbor':part.crop=[64,0,64,64];break;
    case 'decoration':part.metadata.nineSlice={left:2,right:2,top:2,bottom:2};break;
    case 'shallow':part.fit.caps=[1,1];break;
    default:throw Error('Unknown risk fixture fault');
  }
  return{png,config,inputs:{template,bytes:{template:bytes}}};
}

export async function evaluateRisks(directory,corpus){
  const cases=[];
  for(const entry of corpus.cases){
    const {png,config,inputs}=fixtureFor(entry),folder=join(directory,entry.id);
    await mkdir(folder,{recursive:true});await writeFile(join(folder,'source.png'),png);
    await writeFile(join(folder,'assembly.json'),JSON.stringify(config,null,2));
    let observation;
    try{
      const inspection=await inspectAssembly(join(folder,'assembly.json'),inputs);
      await writeFile(join(folder,'inspection.json'),JSON.stringify(inspection,null,2));
      const warnings=inspection.sheets.flatMap(s=>s.parts.flatMap(p=>p.warnings));
      observation={signal:warnings.length?'warning':'silent',warnings};
    }catch(error){
      observation={signal:'blocked',code:error.code??null,message:error.message};
      await writeFile(join(folder,'failure.json'),JSON.stringify(observation,null,2));
    }
    cases.push({...entry,...observation});
  }
  const defects=cases.filter(c=>c.defective),controls=cases.filter(c=>!c.defective);
  return{kind:'ui_skin_quality_risk_evaluation',version:'1.0',scope:corpus.scope,corpusSha256:hash(Buffer.from(JSON.stringify(corpus))),
    counts:{cases:cases.length,defects:defects.length,blocked:defects.filter(c=>c.signal==='blocked').length,warningOnly:defects.filter(c=>c.signal==='warning').length,silentMisses:defects.filter(c=>c.signal==='silent').length,controls:controls.length,controlSignals:controls.filter(c=>c.signal!=='silent').length},
    interpretation:'Warnings are advisory and may be nonspecific; they do not block delivery. Synthetic counts are not a production miss rate.',
    visualReviewDecision:'retain-pending-broader-evidence',productionReady:false,cases};
}
