// Explicit local browser fixture: no provider, container, personal files or messages.
import { createPocServer } from '../apps/poc/server.mjs';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const directory=await mkdtemp(tmpdir()+'/agentmeld-ui-');
const app=await createPocServer({directory,port:0,execute:async(task,changed,control,c)=>{
 await delay(100);task.answer='Fixture result for '+task.prompt;task.status='completed';task.activity='Finished';await changed();
}});
let browser;
try{
 browser=await chromium.launch({channel:'chrome',chromiumSandbox:true});
 const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(app.origin+'/#'+app.token);
 await page.locator('#prompt').fill('First conversation');await page.locator('#send').click();
 await page.locator('.message.assistant').waitFor();
 await page.locator('#prompt').fill('Follow-up');await page.locator('#send').click();
 await page.waitForFunction(()=>document.querySelectorAll('.message.assistant').length===2);
 assert.equal(await page.locator('.historyItem').count(),1);
 await page.locator('#prompt').fill('Retained draft');await page.locator('#newChat').click();
 await page.locator('#prompt').fill('Second conversation');await page.locator('#send').click();
 await page.locator('.message.assistant').waitFor();
 await page.locator('.historyItem').filter({hasText:'First conversation'}).click();
 assert.equal(await page.locator('#prompt').inputValue(),'Retained draft');
 assert.equal(await page.locator('.message.assistant').count(),2);
 await mkdir('.local/m0/continuity-ui',{recursive:true});await page.screenshot({path:'.local/m0/continuity-ui/desktop.png'});
 await page.locator('#prompt').fill('/new');await page.locator('#send').click();
 await page.locator('.welcome').waitFor();assert.equal(await page.locator('.historyItem').count(),2);assert.equal(await page.locator('#prompt').inputValue(),'');
 await page.reload();await page.locator('.historyItem').first().waitFor();assert.equal(await page.locator('.historyItem').count(),2);
 await page.setViewportSize({width:390,height:844});await page.locator('#chatNav').click();
 await page.locator('.historyItem').filter({hasText:'First conversation'}).click();
 assert.equal(await page.locator('.message.assistant').count(),2);
 assert.equal(await page.locator('.history').isVisible(),false);
 await page.screenshot({path:'.local/m0/continuity-ui/mobile.png'});
 assert.deepEqual(errors,[]);console.log('Browser fixture passed: threaded transcript, draft switching, /new, reload, mobile history; no page errors');
}finally{if(browser)await browser.close();await app.shutdown();await rm(directory,{recursive:true,force:true});}
