// Disposable profile fixture; no model calls or retained user state.
import {createPocServer} from '../apps/poc/server.mjs';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');const directory=await mkdtemp(tmpdir()+'/profile-ui-');const app=await createPocServer({directory,port:0,execute:async()=>{throw Error('No model expected');}});let browser;
try{
 browser=await chromium.launch({channel:'chrome',chromiumSandbox:true});const page=await browser.newPage({viewport:{width:1200,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(app.origin+'/#'+app.token);await page.locator('#agentSettings').click();await page.waitForFunction(()=>document.querySelector('#agentName').value==='AgentMeld');
 await page.locator('#agentName').fill('Atlas');await page.locator('#agentIdentity').fill('Help with research');await page.locator('#agentForm button').click();await page.getByText('Saved.',{exact:true}).waitFor();
 await page.locator('#memoryText').fill('Use metric units');await page.locator('#memoryForm button').click();await page.getByText('Use metric units',{exact:true}).waitFor();
 await page.locator('#agentPersona').fill('Unsaved style');await page.getByRole('button',{name:'Forget memory: Use metric units',exact:true}).click();await page.getByText('No approved memories yet.',{exact:true}).waitFor();assert.equal(await page.locator('#agentPersona').inputValue(),'Unsaved style');
 await page.locator('#reloadAgent').click();await page.waitForFunction(()=>document.querySelector('#agentPersona').value==='');assert.equal(await page.locator('#agentName').inputValue(),'Atlas');
 await page.screenshot({path:'.local/m0/agent-settings-desktop.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.local/m0/agent-settings-mobile.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('#closeAgent').click();await page.reload();await page.locator('#agentSettings').click();await page.waitForFunction(()=>document.querySelector('#agentName').value==='Atlas');assert.deepEqual(errors,[]);console.log('Agent settings browser passed: edit, remember, forget, draft preservation, reload, mobile and persistence.');
}finally{await browser?.close();await app.shutdown();await rm(directory,{recursive:true,force:true});}
