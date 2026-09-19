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
  // feed the real Alt1 capture (2560x1351, game at native size inside it); swap = exchange two slots' artwork in it
  const b64=fs.readFileSync(path.join(__dirname,'capture-satisfactory.png')).toString('base64');
  const setCapture=async(swap)=>{await page.evaluate(async([b64,swap])=>{const img=new Image();img.src='data:image/png;base64,'+b64;await img.decode();const cv=document.createElement('canvas');cv.width=img.width;cv.height=img.height;const cx=cv.getContext('2d');cx.drawImage(img,0,0);
      if(swap){const X=[964,1034,1104,1174,1244],y=625,i=swap[0],j=swap[1];const a=cx.getImageData(X[i]+1,y+1,48,48),b=cx.getImageData(X[j]+1,y+1,48,48);cx.putImageData(b,X[i]+1,y+1);cx.putImageData(a,X[j]+1,y+1);}
      const d=cx.getImageData(0,0,cv.width,cv.height);const id=new A1lib.ImageData(cv.width,cv.height);id.data.set(d.data);window.__ref=new A1lib.ImgRefData(id,0,0);Reader._capture=()=>window.__ref;},[b64,swap||null]);};
  await setCapture();await page.waitForTimeout(1800);
  let ins=await page.textContent('#instruction');ok('reads the real capture and proposes a swap: "'+ins.trim()+'"',/Drag slot \d onto slot \d/.test(ins),ins+' / '+await page.textContent('#status'));
  ok('rating button "Satisfactory" lit',await page.$eval('#ratingbtns button.on',b=>b.textContent)==='Satisfactory');
  ok('five tiles with captured artwork',(await page.$$('#tiles .tile img')).length===5);
  ok('two tiles highlighted',(await page.$$('#tiles .tile.swap')).length===2);
  let ov=await page.evaluate(()=>window.__ov);ok('overlay: 2 rectangles + 3 lines + label',ov.filter(o=>o[0]==='rect').length===2&&ov.filter(o=>o[0]==='line').length===3&&ov.some(o=>o[0]==='text'&&o[1]==='swap'),JSON.stringify(ov.slice(0,12)));
  const rect=ov.find(o=>o[0]==='rect');const sw=await page.evaluate(()=>Prototyper._view().rec.swap);
  const expX=964+70*sw[0]-2,expY=625-2;ok('overlay is drawn in capture coordinates ('+rect[2]+','+rect[3]+')',rect[2]===expX&&rect[3]===expY,expX+','+expY);
  console.log('     detail: '+(await page.textContent('#detail')));
  await page.screenshot({path:path.join(__dirname,'../docs/ui-tracking.png')});
  await setCapture(sw);await page.waitForTimeout(1800);
  ok('the swap is seen on screen and a second order is recorded',(await page.$$('#history li')).length===2,(await page.$$('#history li')).length);
  await page.reload();await setCapture(sw);await page.waitForTimeout(1800);
  ok('progress survives a reload',(await page.$$('#history li')).length===2,(await page.$$('#history li')).length);
  await page.click('#ratingbtns button:text-is("Perfect")');await page.waitForTimeout(400);
  ins=await page.textContent('#instruction');ok('correcting the rating to Perfect -> done: "'+ins.trim()+'"',/Perfect/.test(ins),ins);
  await page.waitForTimeout(1500);
  ok('the correction is remembered: the same look now reads as Perfect',await page.$eval('#ratingbtns button.on',b=>b.textContent)==='Perfect');
  ov=await page.evaluate(()=>window.__ov);ok('overlay says Perfect',ov.some(o=>o[0]==='text'&&/Perfect/.test(o[1])));
  await page.screenshot({path:path.join(__dirname,'../docs/ui-done.png')});
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
