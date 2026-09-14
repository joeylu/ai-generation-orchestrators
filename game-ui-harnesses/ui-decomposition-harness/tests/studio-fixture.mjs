// Local synthetic fixture, no media/provider calls or sample art.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFile,mkdir} from 'node:fs/promises';
const [root,out,rangeArg='0']=process.argv.slice(2),range=Number(rangeArg);
const load=p=>import(pathToFileURL(resolve(root,p)));
const {sliceHandoff}=await load('tests/helpers/scrollbar-thumb-slices-fixture.ts');
const {componentHandoffEntries}=await load('src/decomposition-import.ts');
const {zip,referenceSha256}=await load('src/reference-persistence.ts');
const {appearanceDocumentSha256}=await load('src/appearance-binding.ts');
const entries=await componentHandoffEntries(await sliceHandoff()),enc=v=>new TextEncoder().encode(JSON.stringify(v)),read=n=>JSON.parse(new TextDecoder().decode(entries.get(n)));
const bundle=read('component.ui-bundle.json'),node=bundle.document.root.children[0].children[0];
node.props.scrollbarVisibility='always';node.props.contentHeight=node.layout.height+range;
node.children=[{id:'content',type:'Text',layout:{x:5,y:5,width:80,height:20},props:{text:'Fixture',wrap:'none',overflow:'ellipsis',lineHeight:20,drawBackground:false,style:node.props.style}}];
entries.set('component.ui-bundle.json',enc(bundle));
const binding=read('appearance-binding.json');binding.documentSha256=await appearanceDocumentSha256(bundle.document);entries.set('appearance-binding.json',enc(binding));
const scope=read('acceptance-scope.json');scope.components.push({componentId:'content',mode:'compare',reason:'Synthetic moving content marker'});entries.set('acceptance-scope.json',enc(scope));
const manifest=read('handoff.json');for(const ref of [manifest.component_bundle,manifest.appearance_binding,manifest.reference.scope])ref.sha256=await referenceSha256(entries.get(ref.path));entries.set('handoff.json',enc(manifest));
await mkdir(out,{recursive:true});await writeFile(resolve(out,'fixture.zip'),zip(entries));
