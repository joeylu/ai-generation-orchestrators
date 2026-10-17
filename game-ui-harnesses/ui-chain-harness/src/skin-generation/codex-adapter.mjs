import {createCodexCliRelayAdapter} from '../../../ui-reference-harness/web/adapters/codex-cli-relay.mjs';

/** Same native transparency contract as UI Layer, using the existing audited Node transport. */
export function createSkinCodexAdapter(options={}){
  const relay=createCodexCliRelayAdapter({...options,transparentBackground:true});
  return {
    metadata:{...relay.metadata,transparentBackground:true},
    preflight:()=>relay.preflight(),
    async generate(request){
      if(request.output?.format!=='png'||request.output?.transparentBackground!==true||!Array.isArray(request.images)||request.images.length!==2||request.images[0].role!=='style-reference'||request.images[1].role!=='geometry-template'||!/^[a-f0-9]{64}$/.test(request.planSha256??''))throw Error('CODEX_SKIN_REQUEST_INVALID');
      // One fresh CLI session per sheet. No optional history/session key enters this adapter.
      return relay.generate({prompt:request.prompt,images:request.images,requestSha256:request.requestSha256,attemptSha256:request.planSha256});
    },
  };
}
