/* Liquid Glass: static Canvas2D artwork → one WebGL optical pass.
   All positions/radii use CSS pixels; backing-store DPR never enters input physics. */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const canvas = $('#glass'), stage = $('#stage'), source = document.createElement('canvas');
const ctx = source.getContext('2d');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const minimalMotion=()=>reduce.matches||$('#reduce-motion').checked;
const defaults = {radius:112,zoom:1.65,refraction:0.48,thickness:0.32,dispersion:0.14,blur:0.08,light:0.65,response:88,shape:4};
const state = {...defaults};
const specs = [
 ['radius','镜片半径',48,200,1,v=>`${Math.round(v)} px`],
 ['zoom','放大倍率',1,3,0.01,v=>`${v.toFixed(2)}×`],
 ['refraction','折射强度',0,1,0.01,v=>`${Math.round(v*100)}%`],
 ['thickness','边缘厚度',0.05,0.65,0.01,v=>`${Math.round(v*100)}%`],
 ['dispersion','色散',0,1,0.01,v=>`${Math.round(v*100)}%`],
 ['blur','磨砂程度',0,1,0.01,v=>`${Math.round(v*100)}%`],
 ['light','高光强度',0,1,0.01,v=>`${Math.round(v*100)}%`],
 ['response','跟手响应',0,100,1,v=>v===100?'即时':`${Math.round(v)}%`]
];
$('#sliders').innerHTML=specs.map(([key,label,min,max,step,format])=>`<div class="control"><div class="control-label"><label for="${key}">${label}</label><output for="${key}" id="${key}-value">${format(state[key])}</output></div><input id="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${state[key]}"></div>`).join('');
let w=1,h=1,dpr=1, gl, program, texture, buffer, uniform={}, photo=null, scene='tide';
let raf=0,last=0, cx=0,cy=0,tx=0,ty=0,vx=0,vy=0,lastInput=0, stretch=0, compared=false, demo=false, demoStart=0, inside=true, initialized=false, contextLost=false;
let frames=0, toastTimer, imageGeneration=0, visible=true;
const pointers=new Map(); let press=0, directionX=1,directionY=0;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
function toast(s){$('#toast').textContent=s;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2600)}
function sync(){for(const [key,,min,max,,format] of specs){const el=$('#'+key);el.value=clamp(state[key],min,max);$('#'+key+'-value').value=format(state[key]);}canvas.dataset.zoom=state.zoom.toFixed(3);canvas.dataset.refraction=state.refraction.toFixed(3);}
function unpreset(){document.querySelectorAll('[data-preset]').forEach(b=>b.setAttribute('aria-pressed','false'))}
function stopDemo(){demo=false;$('#demo').setAttribute('aria-pressed','false');$('#demo').innerHTML='自动演示 <span aria-hidden="true">↗</span>'}
function invalidate(){if(!raf&&visible&&!document.hidden&&!contextLost)raf=requestAnimationFrame(frame)}
for(const [key] of specs)$('#'+key).addEventListener('input',e=>{window.gsap?.killTweensOf(state);state[key]=Number(e.target.value);unpreset();sync();invalidate()});
const presets={clear:{zoom:1.35,refraction:.16,thickness:.16,dispersion:.02,blur:0,light:.42},liquid:{zoom:1.65,refraction:.48,thickness:.32,dispersion:.14,blur:.08,light:.65},bold:{zoom:2.1,refraction:.88,thickness:.5,dispersion:.40,blur:.05,light:.82}};
function tween(values){if(window.gsap&&!minimalMotion())gsap.to(state,{...values,duration:.48,ease:'power3.out',overwrite:true,onUpdate(){sync();invalidate()}});else{Object.assign(state,values);sync();invalidate()}}
document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-preset]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));tween(presets[b.dataset.preset])}));
document.querySelectorAll('[data-shape]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-shape]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));tween({shape:Number(b.dataset.shape)})}));
$('#reset').addEventListener('click',()=>{stopDemo();tween({...defaults,radius:w<550?88:112});document.querySelector('[data-preset="liquid"]').setAttribute('aria-pressed','true');document.querySelectorAll('[data-preset]:not([data-preset="liquid"])').forEach(b=>b.setAttribute('aria-pressed','false'));document.querySelectorAll('[data-shape]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.shape==='4')));tx=Math.min(w*.55,w*.075+180);ty=h*(w<550?.37:.46);vx=vy=0;compared=false;$('#compare').setAttribute('aria-pressed','false');$('#compare').textContent='对比原图';invalidate()});
$('#toggle-panel').addEventListener('click',()=>{const panel=$('#controls'),open=panel.hidden;panel.hidden=!open;$('.workspace').classList.toggle('panel-hidden',!open);$('#toggle-panel').setAttribute('aria-expanded',String(open));if(open&&w<600)panel.scrollIntoView({behavior:minimalMotion()?'instant':'smooth',block:'start'})});
$('#compare').addEventListener('click',()=>{compared=!compared;$('#compare').setAttribute('aria-pressed',String(compared));$('#compare').textContent=compared?'显示镜片':'对比原图';canvas.dataset.compared=String(compared);invalidate()});
$('#demo').addEventListener('click',()=>{if(demo){stopDemo();return}if(minimalMotion()){toast('减少动态效果已开启，镜片可直接拖动。');return}demo=true;demoStart=performance.now();$('#demo').setAttribute('aria-pressed','true');$('#demo').textContent='停止演示 ↗';invalidate()});
function roundRect(c,x,y,ww,hh,r){c.beginPath();c.roundRect(x,y,ww,hh,r)}
function text(c,s,x,y,size,color,weight='500',align='left'){c.fillStyle=color;c.font=`${weight} ${size}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", sans-serif`;c.textAlign=align;c.fillText(s,x,y)}
function artwork(){
 source.width=Math.round(w*dpr);source.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 if(photo){const s=Math.max(w/photo.width,h/photo.height);ctx.drawImage(photo,(w-photo.width*s)/2,(h-photo.height*s)/2,photo.width*s,photo.height*s);}
 else if(scene==='tide')drawTide();else if(scene==='type')drawType();else drawGrid();
 uploadTexture();
}
// Layout is sized against both width and height; all text uses a top baseline.
function drawEditorial(kind){
 const isType=kind==='type';ctx.fillStyle=isType?'#f7f6f2':'#f3f7fa';ctx.fillRect(0,0,w,h);
 if(!isType){const glow=ctx.createRadialGradient(w*.92,h*.95,0,w*.92,h*.95,Math.max(w,h)*.76);glow.addColorStop(0,'#bdd8e895');glow.addColorStop(.5,'#dcebf345');glow.addColorStop(1,'#f3f7fa00');ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);}
 const x=clamp(w*.075,24,76),width=w-2*x,top=74,bottom=h-76,space=bottom-top;
 const lines=isType?(w>620?['Shape of light.']:['Shape','of light.']):['Light.','In motion.'];
 let size=Math.min(94,width*.155,space*.25/(lines.length===1?1:1.35));
 ctx.font=`500 ${size}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif`;
 const measured=Math.max(...lines.map(v=>ctx.measureText(v).width));if(measured>width)size*=width/measured;
 const body=clamp(space*.05,12,16),gap=Math.max(16,space*.055),lineHeight=size*1.12;
 let y=top;const boxes=[];ctx.textBaseline='top';
 function line(value,font,color,weight='400'){ctx.font=`${weight} ${font}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", sans-serif`;ctx.fillStyle=color;ctx.textAlign='left';let row='';const rows=[];for(const char of value){if(row&&ctx.measureText(row+char).width>width){rows.push(row);row='';}row+=char;}rows.push(row);for(const row of rows){ctx.fillText(row,x,y);const m=ctx.measureText(row);boxes.push({text:row,x,y:y-m.actualBoundingBoxAscent,width:m.width,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent});y+=font*1.2;}}
 for(const value of lines){line(value,size,isType?'#242b30':'#203845','500');y+=lineHeight-size*1.2;}
 y+=gap;line(isType?'光，可以触摸。':'让光，轻轻流动。',Math.min(24,body*1.4),'#3e505b','500');
 y+=gap;const dividerY=y;ctx.strokeStyle='#53677422';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+width,y);ctx.stroke();y+=gap;
 const details=isType?['清晰的字形，柔和的光。','在文字间移动，观察边缘的弯曲。']:['透明中心 · 柔和高光','移动镜片，发现每一处微妙折射。'];
 // Secondary copy uses sequential rows, never independent percentages.
 for(const value of details){line(value,body,'#62717a');y+=body*.6;}
 if(bottom-y>44){y+=Math.min(24,(bottom-y-24)*.4);line(isType?'Aa Bb Cc · 0123456789':'LIQUID GLASS / OPTICAL PLAYGROUND',Math.min(body,14),'#7b8990','400');}
 ctx.textBaseline='alphabetic';canvas.dataset.textLayout=JSON.stringify({width:w,height:h,boxes,dividerY,bottom});
}
function drawTide(){drawEditorial('tide')}
function drawType(){drawEditorial('type')}
function drawGrid(){ctx.fillStyle='#e4eeeb';ctx.fillRect(0,0,w,h);const gap=32;ctx.lineWidth=1;for(let x=0;x<w;x+=gap){ctx.strokeStyle=x%(gap*4)===0?'#49716f70':'#49716f26';ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}for(let y=0;y<h;y+=gap){ctx.strokeStyle=y%(gap*4)===0?'#49716f70':'#49716f26';ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}for(let x=gap*2;x<w;x+=gap*4)for(let y=gap*2;y<h;y+=gap*4){ctx.fillStyle='#1e5856';ctx.beginPath();ctx.arc(x,y,2,0,Math.PI*2);ctx.fill();text(ctx,`${x}, ${y}`,x+6,y-8,10,'#466764','400')}
 text(ctx,'Look closer.',w*.08,h*.44,clamp(w*.09,34,88),'#244e4b');text(ctx,'每一条直线，都能看见折射。',w*.085,h*.44+38,13,'#466764','400');const y=h*.76;for(let i=0;i<5;i++){ctx.fillStyle=['#153c42','#487b80','#9ac3bf','#f4dfb1','#d8794a'][i];ctx.fillRect(w*.085+i*w*.135,y,w*.135,42)} }
document.querySelectorAll('[data-scene]').forEach(b=>b.addEventListener('click',()=>{++imageGeneration;photo?.close?.();photo=null;scene=b.dataset.scene;stage.classList.remove('photo-mode');document.querySelectorAll('[data-scene]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));$('#scene-name').textContent={tide:'01 / 潮汐',type:'02 / 字场',grid:'03 / 标定'}[scene];artwork();invalidate()}));
$('#photo').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;const id=++imageGeneration;try{if(!file.type.startsWith('image/'))throw Error('请选择图片文件');if(file.size>30*1024*1024)throw Error('请选择小于 30 MB 的图片');let img=await createImageBitmap(file);if(id!==imageGeneration){img.close();return}const size=Math.min(2048,gl?.getParameter(gl.MAX_TEXTURE_SIZE)||2048);if(Math.max(img.width,img.height)>size){const scale=size/Math.max(img.width,img.height);const small=await createImageBitmap(img,{resizeWidth:Math.round(img.width*scale),resizeHeight:Math.round(img.height*scale),resizeQuality:'high'});img.close();img=small}if(id!==imageGeneration){img.close();return}photo?.close?.();photo=img;stage.classList.add('photo-mode');document.querySelectorAll('[data-scene]').forEach(b=>b.setAttribute('aria-pressed','false'));$('#scene-name').textContent='04 / 你的图片';artwork();invalidate();toast('图片已载入，试着滑动镜片。')}catch(err){toast(err.message||'无法读取这张图片，请尝试 JPEG 或 PNG。')}finally{e.target.value=''}});
const vertex=`attribute vec2 aPosition;varying vec2 vUv;void main(){vUv=aPosition*0.5+0.5;gl_Position=vec4(aPosition,0.0,1.0);}`;
const fragment=`precision highp float;
varying vec2 vUv;uniform sampler2D uTexture;uniform vec2 uResolution,uCenter,uDirection,uLightPosition;uniform float uRadius,uZoom,uRefraction,uThickness,uDispersion,uBlur,uShape,uStretch,uVisible,uLight,uPress;
vec3 sampleAt(vec2 p){vec2 uv=clamp(p/uResolution,vec2(0.001),vec2(0.999));return texture2D(uTexture,vec2(uv.x,1.0-uv.y)).rgb;}
float norm(vec2 p){return pow(pow(abs(p.x),uShape)+pow(abs(p.y),uShape),1.0/uShape);}
void main(){
 vec2 pixel=vec2(vUv.x,1.0-vUv.y)*uResolution;vec3 base=sampleAt(pixel);
 vec2 delta=pixel-uCenter;vec2 rotated=vec2(dot(delta,uDirection),dot(delta,vec2(-uDirection.y,uDirection.x)));vec2 axes=vec2(1.0+uStretch,1.0-uStretch*0.45);vec2 deformed=rotated/axes;vec2 p=(deformed.x*uDirection+deformed.y*vec2(-uDirection.y,uDirection.x))/uRadius;float n=norm(p);float dist=(n-1.0)*uRadius;
 float mask=(1.0-smoothstep(-0.7,0.7,dist))*uVisible;
 vec2 shadowDelta=delta-vec2(0.0,8.0);vec2 shadowLocal=vec2(dot(shadowDelta,uDirection),dot(shadowDelta,vec2(-uDirection.y,uDirection.x)))/axes;vec2 shadowP=(shadowLocal.x*uDirection+shadowLocal.y*vec2(-uDirection.y,uDirection.x))/uRadius;float sd=(norm(shadowP)-1.0)*uRadius;float contrast=length(sampleAt(pixel+vec2(5.0))-sampleAt(pixel-vec2(5.0)));float shadow=(1.0-smoothstep(-5.0,24.0,sd))*(1.0-mask)*(0.10+contrast*0.15)*uVisible;base*=1.0-shadow;
 if(mask>0.001){
  vec2 ap=max(abs(p),vec2(0.0001));vec2 normal=normalize(sign(p)*pow(ap,vec2(uShape-1.0))+vec2(0.00001));
  float edge=smoothstep(1.0-uThickness,1.0,n);float curve=pow(edge,1.65);
  // Magnification stays linear at the centre. The curved bevel redirects incident light at the rim.
  float slope=sin(curve*1.5707963);vec3 surface=vec3(normal*slope,sqrt(max(0.001,1.0-slope*slope)));vec3 ray=refract(vec3(0.0,0.0,-1.0),surface,1.0/1.46);
  vec2 q=uCenter+delta/uZoom+ray.xy/max(0.35,-ray.z)*uRadius*uRefraction*0.35;
  float chroma=uDispersion*curve*3.4;vec2 split=normal*chroma;
  vec3 glass=vec3(sampleAt(q+split).r,sampleAt(q).g,sampleAt(q-split).b);
  float blur=uBlur*(0.7+edge*2.8);if(blur>0.01){vec3 soft=(sampleAt(q+vec2(blur,blur))+sampleAt(q+vec2(-blur,blur))+sampleAt(q+vec2(blur,-blur))+sampleAt(q-vec2(blur,blur)))*0.25;glass=mix(glass,soft,uBlur*0.8);}
  // Broad Fresnel reflection plus a thin white seam, with opposed darker edge for depth.
  vec2 lightDir=normalize(vec2(-0.55,-0.83)+uLightPosition*0.35);float light=dot(normal,lightDir);float rim=pow(clamp(n,0.0,1.0),12.0);float seam=1.0-smoothstep(0.0,1.5,abs(dist+0.8));
  glass=mix(glass,vec3(0.92,0.98,1.0),0.012+rim*(0.035+max(light,0.0)*0.17)*uLight);
  glass*=1.0-rim*max(-light,0.0)*0.18;
  float luminance=dot(glass,vec3(0.2126,0.7152,0.0722));vec3 reflected=mix(vec3(1.0),sampleAt(pixel+normal*16.0),0.16);glass+=reflected*seam*(0.06+pow(max(light,0.0),3.0)*0.65)*uLight*(1.2-luminance*0.35);
  float inner=exp(-pow((n-(1.0-uThickness*0.42))*28.0,2.0))*max(light,0.0)*0.08;glass+=inner*uLight;
  float sheen=exp(-pow((p.x*0.36+p.y*0.8+0.62)*6.0,2.0))*0.045;glass+=sheen*uLight;glass+=vec3(0.88,0.96,1.0)*uPress*0.065*exp(-dot(p,p)*2.0);
  base=mix(base,glass,mask);
 }
 gl_FragColor=vec4(base,1.0);
}`;
function shader(type,code){const sh=gl.createShader(type);gl.shaderSource(sh,code);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(sh);gl.deleteShader(sh);throw Error(message)}return sh}
function initGL(){gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false,powerPreference:'low-power'});if(!gl)throw Error('WebGL unavailable');const precision=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT);const fs=shader(gl.FRAGMENT_SHADER,precision.precision?fragment:fragment.replace('precision highp float','precision mediump float'));const vs=shader(gl.VERTEX_SHADER,vertex);program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const a=gl.getAttribLocation(program,'aPosition');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);for(const n of ['Texture','Resolution','Center','Radius','Zoom','Refraction','Thickness','Dispersion','Blur','Shape','Stretch','Visible','Direction','LightPosition','Light','Press'])uniform[n]=gl.getUniformLocation(program,'u'+n);gl.uniform1i(uniform.Texture,0);canvas.dataset.renderer='webgl';canvas.dataset.ready='true';$('#engine').textContent='实时光学 · WebGL';$('#fallback').hidden=true;canvas.style.opacity='1';$('#demo').disabled=false}
function uploadTexture(){if(gl&&program&&!contextLost){gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source)}else{stage.style.backgroundImage=`url(${source.toDataURL()})`;stage.style.backgroundSize='100% 100%';canvas.style.opacity='0'}}
function draw(){if(!gl||!program||contextLost)return;gl.viewport(0,0,canvas.width,canvas.height);gl.useProgram(program);gl.uniform2f(uniform.Resolution,w,h);gl.uniform2f(uniform.Center,cx,cy);gl.uniform1f(uniform.Radius,state.radius);gl.uniform1f(uniform.Zoom,state.zoom);gl.uniform1f(uniform.Refraction,state.refraction);gl.uniform1f(uniform.Thickness,state.thickness);gl.uniform1f(uniform.Dispersion,state.dispersion);gl.uniform1f(uniform.Blur,state.blur);gl.uniform1f(uniform.Shape,state.shape);gl.uniform1f(uniform.Stretch,minimalMotion()?0:stretch);gl.uniform1f(uniform.Visible,compared?0:1);gl.uniform2f(uniform.Direction,directionX,directionY);gl.uniform2f(uniform.LightPosition,cx/w*2-1,cy/h*2-1);gl.uniform1f(uniform.Light,state.light);gl.uniform1f(uniform.Press,press);gl.drawArrays(gl.TRIANGLES,0,3);frames++;canvas.dataset.centerX=cx.toFixed(2);canvas.dataset.centerY=cy.toFixed(2);canvas.dataset.frames=String(frames);canvas.dataset.glError=String(gl.getError());}
function frame(now){raf=0;const dt=Math.min((now-(last||now-16.67))/1000,.05);last=now;
 if(demo){const t=(now-demoStart)/1000;tx=w*(.5+.28*Math.sin(t*.65));ty=h*(.48+.22*Math.sin(t*.94+.5));}
 const k=8+state.response*.65;const direct=minimalMotion()||state.response===100;
 const age=now-lastInput;const velocityDecay=Math.exp(-Math.max(0,age-30)/25);const leadX=clamp(vx*velocityDecay/k,-state.radius*.22,state.radius*.22),leadY=clamp(vy*velocityDecay/k,-state.radius*.22,state.radius*.22);
 const a=direct?1:1-Math.exp(-k*dt);const px=cx,py=cy;cx+=(clamp(tx+leadX,0,w)-cx)*a;cy+=(clamp(ty+leadY,0,h)-cy)*a;
 const speed=Math.hypot(cx-px,cy-py)/Math.max(dt,.001);if(speed>25){const len=Math.hypot(cx-px,cy-py);directionX=(cx-px)/len;directionY=(cy-py)/len;}const desired=minimalMotion()?0:Math.min(speed/12500,.07);stretch+=(desired-stretch)*(1-Math.exp(-20*dt));
 press+=((pointers.size?1:0)-press)*(1-Math.exp(-16*dt));draw();if(demo||Math.abs((pointers.size?1:0)-press)>.001||Math.hypot(tx-cx,ty-cy)>.03||stretch>.0002||age<90)invalidate();else last=0;
}
function aim(x,y){const now=performance.now();const elapsed=(now-lastInput)/1000;if(elapsed>0&&elapsed<.15){vx=clamp((x-tx)/elapsed,-2500,2500);vy=clamp((y-ty)/elapsed,-2500,2500)}else vx=vy=0;tx=clamp(x,0,w);ty=clamp(y,0,h);lastInput=now;invalidate()}
function coordinates(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
canvas.addEventListener('pointerdown',e=>{if(pointers.size)return;stopDemo();canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);const p=coordinates(e);pointers.set(e.pointerId,p);aim(p.x,p.y)});
canvas.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'&&pointers.size===0){stopDemo();const p=coordinates(e);aim(p.x,p.y);return}if(!pointers.has(e.pointerId))return;const p=coordinates(e);pointers.set(e.pointerId,p);aim(p.x,p.y)});
function release(e){if(!pointers.has(e.pointerId))return;pointers.delete(e.pointerId);vx=vy=0;invalidate()}
canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);canvas.addEventListener('lostpointercapture',release);
canvas.addEventListener('keydown',e=>{const keys={ArrowLeft:[-18,0],ArrowRight:[18,0],ArrowUp:[0,-18],ArrowDown:[0,18]};if(keys[e.key]){e.preventDefault();stopDemo();const [x,y]=keys[e.key];vx=vy=0;aim(tx+x,ty+y)}else if(['+','=','-'].includes(e.key)){e.preventDefault();state.radius=clamp(state.radius+(e.key==='-'?-8:8),48,200);sync();invalidate()}});
function resize(){const r=stage.getBoundingClientRect();const oldW=w,oldH=h;w=Math.max(1,r.width);h=Math.max(1,r.height);const max=gl?.getParameter(gl.MAX_TEXTURE_SIZE)||4096;dpr=Math.min(devicePixelRatio||1,2,max/w,max/h,Math.sqrt(3600000/(w*h)));canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);if(!initialized){cx=tx=Math.min(w*.55,w*.075+180);cy=ty=h*(w<550?.37:.46);if(w<550)state.radius=88;initialized=true;sync()}else{cx=cx/oldW*w;cy=cy/oldH*h;tx=tx/oldW*w;ty=ty/oldH*h}artwork();invalidate()}
try{if(new URLSearchParams(location.search).get('preview')==='static')throw Error('Static preview requested');initGL()}catch(err){if(new URLSearchParams(location.search).get('preview')!=='static')console.error('Liquid glass renderer:',err);canvas.dataset.renderer='static';canvas.dataset.ready='fallback';$('#engine').textContent='静态预览';$('#fallback').hidden=false;$('#export').disabled=true;$('#demo').disabled=true;}
new ResizeObserver(resize).observe(stage);
new IntersectionObserver(([e])=>{visible=e.isIntersecting;if(visible)invalidate();else{cancelAnimationFrame(raf);raf=0;last=0}}).observe(stage);
document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0;last=0;vx=vy=0}else invalidate()});
function updateMotion(){stopDemo();window.gsap?.killTweensOf(state);vx=vy=stretch=0;canvas.dataset.reduced=String(minimalMotion());invalidate()}
reduce.addEventListener('change',updateMotion);$('#reduce-motion').addEventListener('change',updateMotion);canvas.dataset.reduced=String(minimalMotion());
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();contextLost=true;stopDemo();pointers.clear();press=0;vx=vy=0;cancelAnimationFrame(raf);raf=0;$('#engine').textContent='正在恢复画面';stage.style.backgroundImage=`url(${source.toDataURL()})`;stage.style.backgroundSize='100% 100%';canvas.style.opacity='0';$('#export').disabled=true});
canvas.addEventListener('webglcontextrestored',()=>{contextLost=false;try{initGL();artwork();$('#export').disabled=false;invalidate()}catch(err){$('#fallback').hidden=false;$('#engine').textContent='静态预览';}});
$('#export').addEventListener('click',()=>{draw();canvas.toBlob(blob=>{if(!blob){toast('保存失败，请重试。');return}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=compared?'liquid-glass-original.png':'liquid-glass.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('画面已保存。')},'image/png')});
window.addEventListener('pagehide',e=>{cancelAnimationFrame(raf);raf=0;window.gsap?.killTweensOf(state);pointers.clear();vx=vy=0;stopDemo();if(!e.persisted&&gl){gl.deleteTexture(texture);gl.deleteBuffer(buffer);gl.deleteProgram(program);photo?.close?.()}});
window.addEventListener('pageshow',()=>invalidate());
sync();
})();
