import test from 'node:test';
import assert from 'node:assert/strict';
import {consumerBrowserChannel,launchConsumerBrowser} from '../src/skins/browser-selection.mjs';

test('consumer defaults to bundled Chromium and preserves explicit browser choices',()=>{
 assert.equal(consumerBrowserChannel(undefined,{}),'chromium');
 assert.equal(consumerBrowserChannel('msedge',{UI_CHAIN_TEST_BROWSER:'chrome'}),'msedge');
 assert.equal(consumerBrowserChannel(undefined,{UI_CHAIN_TEST_BROWSER:'chromium'}),'chromium');
 assert.equal(consumerBrowserChannel(undefined,{UI_CHAIN_TEST_BROWSER:'msedge'}),'msedge');
 for(const browser of ['firefox','','C:/browser.exe'])assert.throws(()=>consumerBrowserChannel(browser,{}),{code:'browser.channel'});
});

test('internal postprocessing browser inherits the same controlled host selection',async()=>{
 const calls=[],fake={async launch(options){calls.push(options);return {kind:'browser'};}};
 assert.deepEqual(await launchConsumerBrowser(fake,undefined,{UI_CHAIN_TEST_BROWSER:'chromium'}),{kind:'browser'});
 assert.equal(calls.length,1);assert.equal(calls[0].channel,'chromium');assert.equal(calls[0].headless,true);
 assert(calls[0].args.includes('--use-angle=swiftshader'));
});

test('missing browser fails once with setup guidance and never downloads or retries',async()=>{
 let calls=0;
 await assert.rejects(launchConsumerBrowser({async launch(){calls++;throw Error("browserType.launch: Executable doesn't exist at /browser/chrome");}},undefined,{}),error=>error.code==='browser.not-installed'&&error.message.includes('playwright install --with-deps chromium')&&error.message.includes('No browser was downloaded'));
 assert.equal(calls,1);
 const failure=Error('GPU initialization failed');
 await assert.rejects(launchConsumerBrowser({async launch(){throw failure;}},'chromium',{}),error=>error===failure);
});
