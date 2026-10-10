/** Live public preview smoke test. No credentials, no CRM records and no mutation. */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

const base='https://bradrien.github.io/weneed-companion-u/';
const beta=base+'validation-v12/';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
 const errors=[];
 const failedStatic=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{
  if(response.url().startsWith(beta)&&response.status()>=400)failedStatic.push(response.url()+' '+response.status());
 });
 const response=await page.goto(beta,{waitUntil:'load',timeout:30000});
 assert.equal(response.status(),200,'Live preview is not published');
 await page.locator('#login-form').waitFor({state:'visible',timeout:12000});
 await page.waitForTimeout(500);
 assert.match(await page.title(),/préversion V1\.2/);
 assert.match(await page.locator('body').innerText(),/PRÉVERSION V1\.2/);
 assert.match(await page.locator('body').innerText(),/historique Odoo D11/,'Cache-busted preview marker not published');
 assert.match(await page.locator('script[type="module"]').getAttribute('src'),/app-crm-d11\.js/,'Old iPhone JS still referenced');
 assert.equal(await page.locator('#commission-audit').count(),1,'D4 audit panel missing');
 assert.equal(await page.locator('#commission-scenario').count(),1,'D7 conditional simulation panel missing');
 assert.match(await page.locator('link[rel="stylesheet"]').first().getAttribute('href'),/app-crm-d9\.css/);
 assert.equal(await page.locator('#login-panel').isVisible(),true);
 assert.equal(await page.locator('#app-panel').isVisible(),false);
 assert.equal(await page.locator('#bottom-nav').isVisible(),false);
 assert.equal(await page.locator('#login-password').inputValue(),'');
 const css=await page.locator('#login-card, #login-form').first().evaluate(el=>getComputedStyle(el).borderRadius);
 assert.notEqual(css,'0px','CSS file not applied');
 assert.deepEqual(errors,[],'JS errors in published preview');
 assert.deepEqual(failedStatic,[],'Missing published assets');
 await mkdir('artifacts',{recursive:true});
 await page.screenshot({path:'artifacts/live-preview-mobile.png',fullPage:true});
 // Production home should not be replaced by the preview.
 const main=await page.goto(base,{waitUntil:'load',timeout:30000});
 assert.equal(main.status(),200);
 assert.equal(await page.locator('#client-search').count(),0,'Main UI unexpectedly replaced');
 assert.equal(await page.locator('#login-form').count(),1);
 // Check the REAL hosted gateway's browser preflight, not just a simulated router.
 const corsOrigin='https://bradrien.github.io';
 const corsResponse=await fetch('https://gcirlrghjvumhkekrtmf.supabase.co/functions/v1/odoo-read?resource=ping',{
   method:'OPTIONS',
   headers:{origin:corsOrigin,'access-control-request-method':'GET',
    'access-control-request-headers':'authorization,apikey,content-type'}
 });
 assert.equal(corsResponse.status,204,'Published browser CORS preflight must pass');
 assert.ok(['*',corsOrigin].includes(corsResponse.headers.get('access-control-allow-origin')),
   'Preflight must include a usable CORS allow-origin response');
 const anonymous=await fetch('https://gcirlrghjvumhkekrtmf.supabase.co/functions/v1/odoo-read?resource=ping',{
   headers:{origin:corsOrigin}
 });
 assert.equal(anonymous.status,401,'Read-only gateway must still reject anonymous access');
 // Gateway-level JWT rejection may supply its own CORS headers; the 401 is the security invariant.
 // Anonymous clients cannot bypass Supabase Auth.
 const protectedEndpoints=[
  '/functions/v1/companion-api/clients',
  '/functions/v1/odoo-read?resource=ping',
  '/functions/v1/commission-catalog-review?from=2026-09-01&to=2026-09-30'
 ];
 for(const endpoint of protectedEndpoints){
  const result=await fetch('https://gcirlrghjvumhkekrtmf.supabase.co'+endpoint,{
   headers:{accept:'application/json'}
  });
  assert.ok([401,403].includes(result.status),endpoint+' unexpectedly returned '+result.status);
 }
 console.log('PASS live preview: main unmodified, real hosted HTML/CSS/JS, owner login gated, anonymous CRM denied');
}finally{await browser.close()}
