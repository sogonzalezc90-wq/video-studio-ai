(() => {
  "use strict";
  const cache=new Map();
  function load(url){
    if(!url) return Promise.resolve(null);
    if(cache.has(url)) return cache.get(url);
    const promise=new Promise((resolve,reject)=>{
      const image=new Image();image.crossOrigin="anonymous";
      image.onload=()=>resolve(image);image.onerror=()=>reject(new Error("No se pudo cargar una capa visual: "+url));
      image.src=url;
    });
    cache.set(url,promise);return promise;
  }
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const ease=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
  async function draw(ctx,canvas,segment,progress,background){
    const w=canvas.width,h=canvas.height,p=clamp(progress,0,1);
    if(background){
      // A still frame receives a real camera move (push-in plus gentle pan),
      // not a claim of character animation. Neural clips must be assigned for body motion.
      const easeProgress=1-Math.pow(1-p,2);
      const scale=Math.max(w/background.width,h/background.height)*(1.035+.085*easeProgress);
      const dw=background.width*scale,dh=background.height*scale;
      const panX=Math.sin(p*Math.PI*1.35)*w*.018;
      const panY=-p*h*.012;
      ctx.drawImage(background,(w-dw)/2+panX,(h-dh)/2+panY,dw,dh);
    }else{
      ctx.fillStyle="#07162c";ctx.fillRect(0,0,w,h);
    }
    const description=[segment.shotTitle,segment.shotDescription,segment.visualPrompt].join(" ");
    const vehicleAction=/\b(acelera|avanza|conduce|carrera|circuito|veh[ií]culo|autom[oó]vil|coche|carro)\b/i.test(description);
    const walking=/\b(caminar|camina|corre|corriendo|avanza|entra|sale|huye)\b/i.test(description);
    const layers=[
      ...(segment.references?.characters||[]).map((item,index)=>({...item,kind:"character",index})),
      ...(segment.references?.props||[]).map((item,index)=>({...item,kind:/auto|coche|carro|veh[ií]culo|moto|veh[ií]culo/i.test(item.name||"")?"vehicle":"prop",index}))
    ];
    for(const layer of layers){
      if(!layer.url)continue;
      const image=await load(layer.url);
      if(!image)continue;
      const isVehicle=layer.kind==="vehicle"||(/auto|coche|carro|veh[ií]culo|moto/i.test(layer.name||"")&&vehicleAction);
      const phase=p*Math.PI*2;
      let x,y,maxWidth,maxHeight;
      if(isVehicle){
        x=(-.28+.92*ease(p))*w;
        y=.66*h+Math.sin(phase*2)*h*.008;
        maxWidth=w*.46;maxHeight=h*.36;
      }else if(layer.kind==="character"){
        const travel=walking?.16:.035;
        x=(.28+layer.index*.16+travel*(ease(p)-.5))*w;
        y=.70*h+Math.abs(Math.sin(phase*2+layer.index))*(walking?h*.018:h*.004);
        maxWidth=w*.19;maxHeight=h*.48;
      }else{
        x=(.5+Math.sin(phase)*.025)*w;y=.72*h;maxWidth=w*.2;maxHeight=h*.3;
      }
      const scale=Math.min(maxWidth/image.width,maxHeight/image.height);
      const dw=image.width*scale,dh=image.height*scale;
      ctx.drawImage(image,x-dw/2,y-dh/2,dw,dh);
    }
    const shade=ctx.createLinearGradient(0,0,0,h);
    shade.addColorStop(0,"rgba(3,12,28,.04)");shade.addColorStop(1,"rgba(3,12,28,.28)");
    ctx.fillStyle=shade;ctx.fillRect(0,0,w,h);
  }
  window.VSAMotionEngine={draw,clear:()=>cache.clear()};
})();