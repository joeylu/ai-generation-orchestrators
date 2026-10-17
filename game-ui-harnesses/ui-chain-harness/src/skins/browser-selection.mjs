const channels=new Set(['chromium','chrome','msedge']);

/** Browser installation is an explicit host setup step, never a runtime side effect. */
export function consumerBrowserChannel(browser,environment=process.env){
 const channel=browser??environment.UI_CHAIN_TEST_BROWSER??'chromium';
 if(!channels.has(channel))throw Object.assign(Error('Use browser chromium, chrome or msedge.'),{code:'browser.channel'});
 return channel;
}

export async function launchConsumerBrowser(chromium,browser,environment=process.env){
 const channel=consumerBrowserChannel(browser,environment);
 try{return await chromium.launch({channel,headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});}
 catch(error){
  if(/executable.*(?:doesn.t exist|not found)|distribution.*not found|failed to launch.*not found/i.test(error.message??'')){
   const setup=channel==='chromium'?'Run npx playwright install --with-deps chromium during explicit host setup.':`Install ${channel} explicitly, or select an installed Chromium with --browser chromium.`;
   throw Object.assign(Error(`Selected browser ${channel} is not installed. ${setup} No browser was downloaded.`,{cause:error}),{code:'browser.not-installed'});
  }
  throw error;
 }
}
