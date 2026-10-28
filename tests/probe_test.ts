import { chromium } from "playwright";
import { installProbe } from "../tools/browser-probe.ts";
Deno.test({name:"browser probe reset discards pending warmup GPU queries",ignore:false, async fn(){
 const browser=await chromium.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
 try{
 const page=await browser.newPage();
 await page.addInitScript(installProbe);
 await page.goto("data:text/html,<canvas></canvas>");
 await page.evaluate(()=>{
  const gl=document.querySelector("canvas")!.getContext("webgl2")!;
  const draw=()=>{gl.clearColor(.4,.7,.2,1);gl.clear(gl.COLOR_BUFFER_BIT);requestAnimationFrame(draw);};
  requestAnimationFrame(draw);
 });
 await page.waitForTimeout(350);
 const before=await page.evaluate(()=>Reflect.get(globalThis,"__PROBE__").cpu.length);
 if(before<1) throw Error("probe did not measure real frames");
 const reset=await page.evaluate(()=>{Reflect.get(globalThis,"__RESET_PROBE__")();const p=Reflect.get(globalThis,"__PROBE__"); return [p.cpu.length,p.gpu.length,p.raf.length,p.lastRaf];});
 if(reset.some((n:number)=>n!==0)) throw Error("reset retained samples");
 await page.waitForTimeout(250);
 const after=await page.evaluate(()=>Reflect.get(globalThis,"__PROBE__"));
 if(after.cpu.length<1 || after.gpu.length<1 || after.errors.length) throw Error("probe did not resume GPU/CPU sampling");
 console.log(JSON.stringify({before,reset,afterCpu:after.cpu.length,afterGpu:after.gpu.length,renderer:after.renderer}));
 }finally{await browser.close();}
}});
