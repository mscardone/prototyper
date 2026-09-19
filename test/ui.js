/* Headless browser check of the whole app with a fake Alt1 (needs: npm i -g playwright).
   Feeds the reference screenshots in as game captures, checks the advice, the overlay calls,
   persistence and manual mode, and refreshes the screenshots in docs/.   node test/ui.js */
const { chromium } = require('playwright');
const { spawn } = require('child_process');const path=require('path'),fs=require('fs');
(async()=>{
  const srv=spawn('node',[path.join(__dirname,'../tools/serve.js'),'8377'],{stdio:'ignore'});await new Promise(r=>setTimeout(r,600));
  const browser=await chromium.launch();let fails=0;const ok=(n,c,x)=>{console.log((c?'  ok   ':'  FAIL ')+n+(c?'':'  -> '+x));if(!c)fails++;};
  // ---- inside "Alt1" ----
  const page=await browser.newPage({viewport:{width:340,height:430}});
  const errs=[];page.on('pageerror',e=>errs.push(e.message));
  await page.addInitScript(()=>{window.__ov=[];const rec=n=>(...a)=>{window.__ov.push([n,...a]);return true;};
    window.alt1={permissionPixel:true,permissionOverlay:true,rsLinked:true,identifyAppUrl(){},overLaySetGroup:rec('group'),overLayFreezeGroup:rec('freeze'),overLayClearGroup:rec('clear'),overLayRefreshGroup:rec('refresh'),overLayRect:rec('rect'),overLayLine:rec('line'),overLayTextEx:rec('text')};});
  await page.goto('http://127.0.0.1:8377/index.html');
  const setShot=async(file)=>{const b64=fs.readFileSync(path.join(__dirname,file)).toString('base64');
    await page.evaluate(async(b64)=>{const img=new Image();img.src='data:image/png;base64,'+b64;await img.decode();const W=1400,H=900;const cv=document.createElement('canvas');cv.width=W;cv.height=H;const cx=cv.getContext('2d');cx.fillStyle='#223';cx.fillRect(0,0,W,H);cx.drawImage(img,200,90);
      const d=cx.getImageData(0,0,W,H);const id=new A1lib.ImageData(W,H);id.data.set(d.data);window.__ref=new A1lib.ImgRefData(id,0,0);Reader._capture=()=>window.__ref;},b64);};
  await setShot('shot-verygood.png');await page.waitForTimeout(1500);
  let ins=await page.textContent('#instruction');ok('reads the Very good shot and proposes a swap: "'+ins.trim()+'"',/Drag slot \d onto slot \d/.test(ins),ins);
  ok('rating button "Very good" lit',await page.$eval('#ratingbtns button.on',b=>b.textContent)==='Very good');
  ok('five tiles with captured artwork',(await page.$$('#tiles .tile img')).length===5);
  ok('two tiles highlighted',(await page.$$('#tiles .tile.swap')).length===2);
  let ov=await page.evaluate(()=>window.__ov);ok('overlay: 2 rectangles + 3 lines + label',ov.filter(o=>o[0]==='rect').length===2&&ov.filter(o=>o[0]==='line').length===3&&ov.some(o=>o[0]==='text'&&o[1]==='swap'),JSON.stringify(ov.slice(0,12)));
  const rect=ov.find(o=>o[0]==='rect');const sw=await page.evaluate(()=>Prototyper._view().rec.swap);
  const expX=200+404+[20,108,195,283,370][sw[0]]-2;ok('overlay rectangle sits on the slot in capture coordinates ('+rect[2]+','+rect[3]+')',rect[2]===expX&&rect[3]===90+474+14-2,expX);
  console.log('     detail: '+(await page.textContent('#detail')));
  await page.screenshot({path:path.join(__dirname,'../docs/ui-tracking.png')});
  // user "performs" swaps until perfect using the second screenshot as final state
  await setShot('shot-perfect.png');await page.waitForTimeout(1500);
  ins=await page.textContent('#instruction');ok('Perfect shot -> done: "'+ins.trim()+'"',/Perfect/.test(ins),ins);
  ok('history shows both orders',(await page.$$('#history li')).length===2);
  ov=await page.evaluate(()=>window.__ov);ok('overlay says Perfect',ov.some(o=>o[0]==='text'&&/Perfect/.test(o[1])));
  await page.screenshot({path:path.join(__dirname,'../docs/ui-done.png')});
  // persistence: reload, show first shot again -> history restored (2 orders known)
  await page.reload();await setShot('shot-verygood.png');await page.waitForTimeout(1500);
  ok('progress survives a reload',(await page.$$('#history li')).length===2,(await page.$$('#history li')).length);
  const det=await page.textContent('#detail');ok('after reload the solution is already known: "'+det+'"',/solution is known/.test(det),det);
  // correct a rating -> learned
  await page.click('#ratingbtns button:text-is("Good")');await page.waitForTimeout(1200);
  ok('clicking another rating is remembered (word learned) and sticks',await page.$eval('#ratingbtns button.on',b=>b.textContent)==='Good');
  ok('no page errors',errs.length===0,errs.join(' | '));
  // ---- plain browser: manual mode ----
  const p2=await browser.newPage({viewport:{width:340,height:430}});const e2=[];p2.on('pageerror',e=>e2.push(e.message));
  await p2.goto('http://127.0.0.1:8377/index.html');await p2.waitForTimeout(300);
  ok('outside Alt1 -> manual mode',/What does the game say/.test(await p2.textContent('#instruction')));
  // secret puzzle
  const rho=[2,0,4,1,3],mu=[1,3,0,4,2];const lvl=a=>{let t=0;for(let i=0;i<5;i++)t+=Math.abs(rho[i]-mu[a[i]]);return t>=10?5:t/2;};const NAMES=["Perfect","Excellent","Very good","Good","Satisfactory","Poor"];
  let arr=[0,1,2,3,4],n=0;await p2.click(`#ratingbtns button:text-is("${NAMES[lvl(arr)]}")`);
  while(n<20){const t=await p2.textContent('#instruction');if(/Perfect/.test(t))break;const m=t.match(/slot (\d) onto slot (\d)/);if(!m){console.log('unexpected: '+t);break;}
    const i=+m[1]-1,j=+m[2]-1;await p2.click(`#tiles .tile[data-slot="${i}"]`);await p2.click(`#tiles .tile[data-slot="${j}"]`);[arr[i],arr[j]]=[arr[j],arr[i]];n++;await p2.click(`#ratingbtns button:text-is("${NAMES[lvl(arr)]}")`);}
  ok('manual mode solves a hidden puzzle by clicking ('+n+' swaps)',lvl(arr)===0&&n<=13,n);
  await p2.screenshot({path:path.join(__dirname,'../docs/ui-manual.png')});
  ok('no page errors (manual)',e2.length===0,e2.join(' | '));
  await browser.close();srv.kill();console.log(fails?fails+' FAILED':'all UI checks passed');process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
