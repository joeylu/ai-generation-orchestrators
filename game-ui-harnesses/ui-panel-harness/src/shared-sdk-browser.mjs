import host from '../adapters/unity/HostRuntime/PanelInstanceHost.cs?raw';
import hostMeta from '../adapters/unity/HostRuntime/PanelInstanceHost.cs.meta?raw';
import binding from '../adapters/unity/GameRuntime/PanelGameBinding.cs?raw';
import bindingMeta from '../adapters/unity/GameRuntime/PanelGameBinding.cs.meta?raw';
import memory from '../adapters/unity/GameRuntime/MemoryPanelGamePort.cs?raw';
import memoryMeta from '../adapters/unity/GameRuntime/MemoryPanelGamePort.cs.meta?raw';
import examples from '../adapters/unity/GameExamples/PanelGameExamplePorts.cs?raw';
import examplesMeta from '../adapters/unity/GameExamples/PanelGameExamplePorts.cs.meta?raw';
import instructions from '../docs/unity-game-binding.md?raw';
import {UNITY_ADAPTER_VERSION} from './unity-export.mjs';
import {digestBytes,canonicalJson} from './canonical.mjs';
import {createStoredZip} from './zip-store.mjs';
const utf8=text=>new TextEncoder().encode(text);
export async function createBrowserSharedSdk(runtime){
 if(runtime?.version!=='0.1.0'||await digestBytes(utf8(runtime.code))!==runtime.sha256)throw new Error('DELIVERY_RUNTIME_INTEGRITY');
 const contents=new Map([
  ['Assets/PanelHarness/HostRuntime/PanelInstanceHost.cs',utf8(host)],['Assets/PanelHarness/HostRuntime/PanelInstanceHost.cs.meta',utf8(hostMeta)],
  ['Assets/PanelHarness/GameRuntime/PanelGameBinding.cs',utf8(binding)],['Assets/PanelHarness/GameRuntime/PanelGameBinding.cs.meta',utf8(bindingMeta)],
  ['Assets/PanelHarness/GameRuntime/MemoryPanelGamePort.cs',utf8(memory)],['Assets/PanelHarness/GameRuntime/MemoryPanelGamePort.cs.meta',utf8(memoryMeta)],
  ['Assets/PanelHarness/GameExamples/PanelGameExamplePorts.cs',utf8(examples)],['Assets/PanelHarness/GameExamples/PanelGameExamplePorts.cs.meta',utf8(examplesMeta)],
  ['pixi/panel-runtime.js',utf8(runtime.code)],['pixi/THIRD_PARTY_NOTICES.txt',utf8(runtime.notices)],['UNITY.md',utf8('此 Studio SDK 只包含通用脚本，不附带固定验收面板的 Examples/Bindings 或 Examples/Documents。每个新面板请使用自己的验证文档并配置路由。\n\n'+instructions)],
  ['README.md',utf8('# Shared panel SDK 0.1.0\n\nInstall Assets/PanelHarness once and preserve .meta files. Generated panels reuse this shared SDK; never copy it into each panel folder. Existing HostRuntime uses the same source and GUID. Read UNITY.md; optional examples require the installed AudioModule. Panel Runtime '+UNITY_ADAPTER_VERSION+' is supplied by the Unity import kit, not duplicated here. Compare sdk-manifest.json source hashes before replacing locally modified SDK files. Native package installation requires the separate read-only preflight; downloading this SDK never inspects or writes a game project.\n\nThe browser adapter exposes PanelDelivery.createPixiPanelHost, validateBundle, attachPanelGameBinding and createMemoryGamePort from pixi/panel-runtime.js. Mount with a distinct instance ID and an empty container. Each panel delivery contains its source bundle, field/event contract and empty explicit binding template. Populate business routes and supply your own port. The bundled adapter uses no provider or persistence service. Dispose bindings before views; ports have game-owned lifetimes.\n\nBrowser export fingerprints the sources but does not run Unity or certify a native import. This is a workspace development artifact, not a tagged production release.\n')],
 ]);
 const manifest={sharedPanelSdkVersion:'0.1.0',status:'COMPLETE',requiredPanelRuntime:UNITY_ADAPTER_VERSION,coreSharedScripts:3,optionalExampleScripts:1,runtimeSha256:runtime.sha256,modelCalls:0,productionRelease:false,
  verification:{browser:'NOT_RUN',nativeEngines:'NOT_RUN'},files:await Promise.all([...contents].sort(([a],[b])=>a<b?-1:a>b?1:0).map(async([path,bytes])=>({path,bytes:bytes.length,sha256:await digestBytes(bytes)})))};
 contents.set('sdk-manifest.json',utf8(canonicalJson(manifest)+'\n'));return{bytes:createStoredZip(contents),manifest};
}
