(() => {
  "use strict";

  const RULES = [
    {type:"zoo",label:"Zoológico / fauna",re:/\b(zool[oó]gico|zoo|safari|aviario|acuario|jaula|recinto animal|fauna silvestre)\b/i},
    {type:"clinic",label:"Consultorio / clínica",re:/\b(consultorio|cl[ií]nica|hospital|urgencias|enfermer[ií]a|quir[oó]fano|sala de espera|paciente|m[eé]dico|doctora|doctor)\b/i},
    {type:"market",label:"Mercado / tianguis",re:/\b(mercado|tianguis|puesto|vendedor|frutas|verduras|pasillo de mercado|central de abasto)\b/i},
    {type:"mall",label:"Plaza comercial",re:/\b(plaza comercial|centro comercial|mall|tienda departamental|local comercial|patio de comidas|escaleras el[eé]ctricas)\b/i},
    {type:"restaurant",label:"Restaurante",re:/\b(restaurante|comensales|mesero|mesera|chef|comedor|men[uú]|reservaci[oó]n)\b/i},
    {type:"cafe",label:"Cafetería",re:/\b(caf[eé]|cafeter[ií]a|barista|m[aá]quina de espresso|terraza de caf[eé])\b/i},
    {type:"racetrack",label:"Autódromo / pista de carreras",re:/\b(aut[oó]dromo|circuito|pista de carreras|boxes|parrilla de salida|bandera a cuadros|pit lane|carrera de autos)\b/i},
    {type:"street",label:"Calle / avenida",re:/\b(calle|avenida|boulevard|cruce peatonal|sem[aá]foro|banqueta|tr[aá]fico|claxon|bocina)\b/i},
    {type:"car",label:"Automóvil / motor",re:/\b(auto|autom[oó]vil|coche|carro|veh[ií]culo|motor|acelera|frena|neum[aá]tic)\b/i},
    {type:"motorcycle",label:"Motocicleta",re:/\b(moto|motocicleta|motociclista)\b/i},
    {type:"rain",label:"Lluvia / tormenta",re:/\b(lluvia|llueve|tormenta|llovizna|trueno|rel[aá]mpago)\b/i},
    {type:"wind",label:"Viento / exterior",re:/\b(viento|ventisca|brisa|r[aá]faga|bosque|[aá]rboles|monta[nñ]a|desierto|azotea|amanecer)\b/i},
    {type:"footsteps",label:"Pasos",re:/\b(caminar|camina|camin[oó]|pasos|pisadas|corre|corriendo|huye|entr[oó]|sale)\b/i},
    {type:"workshop",label:"Taller / herramientas",re:/\b(taller|reparando|reparar|herramientas|llave inglesa|soldar|mec[aá]nic)\b/i},
    {type:"door",label:"Puerta / interior",re:/\b(puerta|abre|abri[oó]|cerr[oó]|habitaci[oó]n|cuarto|casa|oficina)\b/i},
    {type:"impact",label:"Golpe / acción",re:/\b(golpe|disparo|explosi[oó]n|cae|rompe|choque|pelea|frenada)\b/i},
    {type:"night",label:"Noche / suspenso",re:/\b(noche|oscuro|sombra|misterio|miedo|suspenso|silencio|terror)\b/i},
    {type:"birds",label:"Aves / pájaros",re:/\b(ave|aves|p[aá]jaro|p[aá]jaros|loro|guacamaya|flamenco|ping[uü]ino|gaviota|gallo|gallina)\b/i},
    {type:"animal",label:"Animales",re:/\b(animal|animales|rugido|le[oó]n|tigre|elefante|mono|monos|jirafa|cebra|oso|lobo|foca|delf[ií]n)\b/i},
    {type:"dog",label:"Perro",re:/\b(perro|perros|ladrido|ladra|ladran)\b/i},
    {type:"cat",label:"Gato",re:/\b(gato|gata|gatito|maullido|ma[uú]lla)\b/i},
    {type:"horse",label:"Caballo",re:/\b(caballo|caballos|relincho|relincha|galope|galopa)\b/i},
    {type:"kitchen",label:"Cocina / preparación de alimentos",re:/\b(cocina|cocinero|cocinera|fre[ií]r|sart[eé]n|hervir|horno|parrilla|licuadora)\b/i},
    {type:"crowd",label:"Multitud / público",re:/\b(multitud|p[uú]blico|gente|aglomeraci[oó]n|aplausos|ovaci[oó]n|bullicio)\b/i},
    {type:"chatter",label:"Conversaciones de fondo",re:/\b(conversaci[oó]n|conversan|charlan|murmullos|voces lejanas|gente hablando|clientes hablando)\b/i},
    {type:"cups",label:"Vajilla / cubiertos",re:/\b(taza|tazas|vaso|vasos|copa|copas|cubiertos|platos|brindis|loza)\b/i},
    {type:"cash",label:"Caja / cobro",re:/\b(caja registradora|cobrar|cobro|terminal bancaria|cajero|esc[aá]ner de productos|c[oó]digo de barras)\b/i},
    {type:"shopping",label:"Carritos / compras",re:/\b(carrito|carritos|carro de compras|canasta|compras|supermercado|autoservicio)\b/i},
    {type:"medical",label:"Equipo médico",re:/\b(monitor card[ií]aco|monitor m[eé]dico|electrocardiograma|bip|signos vitales|equipo m[eé]dico)\b/i},
    {type:"alarm",label:"Alarma / sirena",re:/\b(alarma|sirena|alerta|evacuaci[oó]n)\b/i},
    {type:"train",label:"Tren / metro",re:/\b(tren|metro|estaci[oó]n|and[eé]n|ferrocarril|vag[oó]n)\b/i},
    {type:"airport",label:"Aeropuerto / avión",re:/\b(aeropuerto|avi[oó]n|avioneta|despegue|aterrizaje|terminal a[eé]rea)\b/i},
    {type:"water",label:"Agua / piscina",re:/\b(agua|piscina|alberca|fuente|cascada|chapoteo|olas|mar|playa)\b/i},
    {type:"fire",label:"Fuego",re:/\b(fuego|fogata|hoguera|chimenea|incendio|llamas)\b/i},
    {type:"insects",label:"Insectos / grillos",re:/\b(grillos|cigarras|insectos|chicharras)\b/i}
  ];

  const DIALOGUE = /^\s*([\p{L}][\p{L}\p{M} .'-]{0,35})\s*:\s*(.+)$/u;
  const SCENE = /^\s*(?:#{1,6}\s*)?(?:ESCENA\s+\d+\s*[—–:.-]?\s*|)([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 .,'’_-]{2,55})\s*$/;
  const SHOT = /^\s*TOMA\s+(\d+(?:\.\d+)*)\s*(?:[—–:.-]\s*)?(.*)$/i;
  const DURATION = /(?:duraci[oó]n|duration)\s*:\s*(\d+(?:[.,]\d+)?)\s*(segundos?|seg|s|minutos?|min)?/i;

  function secondsFrom(text) {
    const m=String(text||"").match(DURATION);
    if(!m) return null;
    const n=Number(m[1].replace(",",".")),u=(m[2]||"segundos").toLowerCase();
    return u.startsWith("min")?n*60:n;
  }
  function classify(text) {
    const types=RULES.filter(x=>x.re.test(text)).map(x=>x.type);
    const mood=types.includes("night")||types.includes("impact")?"suspenso":
      types.includes("car")||types.includes("motorcycle")||types.includes("racetrack")?"accion":
      types.includes("rain")?"melancolia":
      types.includes("zoo")||types.includes("market")||types.includes("mall")||types.includes("restaurant")||types.includes("cafe")?"calido":
      types.includes("workshop")||types.includes("wind")||types.includes("clinic")?"drama":"cinematografico";
    return {types,labels:RULES.filter(x=>types.includes(x.type)).map(x=>x.label),mood};
  }
  function parseDialogue(line) {
    const value=String(line||"").trim();
    if(!value||/^(?:sin diálogo|sin dialogo|no hay diálogo|no hay dialogo)\.?$/i.test(value)) return null;
    // Accept screenplay forms such as "Diálogo: KIYOSHIMA (voz grave): «…»".
    const prefixed=value.match(/^(?:diálogo|dialogo)\s*:\s*([\p{L}][\p{L}\p{M} .'-]{1,35}?)(?:\s*\([^)]{1,100}\))?\s*:\s*[«“"]?(.+?)[»”"]?$/iu);
    const direct=value.match(/^([\p{L}][\p{L}\p{M} .'-]{1,35}?)(?:\s*\([^)]{1,100}\))?\s*:\s*[«“"]?(.+?)[»”"]?$/u);
    const m=prefixed||direct;
    if(!m) return null;
    const character=m[1].trim().replace(/\s+/g," ");
    const text=m[2].trim().replace(/[»”"]+$/,"").replace(/^[«“"]+/,"").trim();
    if(/^(duraci[oó]n|formato|resoluci[oó]n|estilo|escena|toma|audio)$/i.test(character)) return null;
    if(text.length<2||/^(?:sin diálogo|sin dialogo)$/i.test(text))return null;
    return {character,text};
  }
  function analyze(input) {
    const rawText=String(input||"").trim();
    const lines=rawText.split(/\r?\n/);
    const scenes=[];
    let scene=null,shot=null,globalInstructions=[],seenScene=false,pendingDialogues=[];
    const makeScene=(title,number)=>{
      const s={id:scenes.length+1,number:String(number??scenes.length+1),title:(title||"Escena "+(scenes.length+1)).trim(),
        description:"",duration:null,shots:[],dialogues:[],types:[],labels:[],mood:"cinematografico"};
      scenes.push(s);scene=s;shot=null;pendingDialogues=[];return s;
    };
    const addLine=(target,line)=>{
      if(target&&line.trim()) target.description+=(target.description?"\n":"")+line.trim();
    };

    for(let i=0;i<lines.length;i++){
      const line=lines[i],trim=line.trim();
      if(!trim){if(scene&&shot)addLine(shot,"");continue;}
      const sm=trim.match(/^(?:#{1,6}\s*)?(?:\d+\.\s*)?(?:GUION[^\n]*?—\s*)?ESCENA\s+(\d+)\s*(?:[—–:.-]\s*)?(.*)$/i);
      if(sm){seenScene=true;makeScene(sm[2]||"Escena "+sm[1],sm[1]);continue;}
      const tm=trim.match(SHOT);
      if(tm){
        seenScene=true;
        const parent=tm[1].split(".")[0];
        if(!scene||scene.number!==parent) makeScene("Escena "+parent,parent);
        const inlineDuration=tm[2].match(/\((\d+(?:[.,]\d+)?)\s*(segundos?|seg|s|minutos?|min)\)/i);
        const title=tm[2].replace(/\s*\(\d+(?:[.,]\d+)?\s*(?:segundos?|seg|s|minutos?|min)\)\s*/i,"").trim();
        shot={number:tm[1],title:title||"Toma "+tm[1],description:"",duration:inlineDuration?Number(inlineDuration[1].replace(",","."))*(inlineDuration[2].toLowerCase().startsWith("min")?60:1):null,dialogues:pendingDialogues.splice(0)};
        scene.shots.push(shot);continue;
      }
      if(!scene){
        const heading=trim.match(/^([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 .,'’_-]{2,55})$/);
        if(heading && !/^(EL|LA|LOS|LAS|UN|UNA|DURACIÓN|FORMATO|RESOLUCIÓN)\b/.test(heading[1])) {
          if(i===0 || /^(EL|LA|LOS|LAS)\s/.test(heading[1])) {makeScene(heading[1],scenes.length+1);seenScene=true;continue;}
        }
        if(!/^(?:duraci[oó]n total|formato|resoluci[oó]n|relaci[oó]n de aspecto)\s*:/i.test(trim)) {
          makeScene("Escena 1",1);
          seenScene=true;
        } else {
          globalInstructions.push(line);
          continue;
        }
      }
      const d=secondsFrom(trim);
      if(d!==null){if(shot)shot.duration=d;else if(scene&&!/duraci[oó]n\s+total/i.test(trim))scene.duration=d;continue;}
      const dialogue=parseDialogue(trim);
      if(dialogue){scene.dialogues.push(dialogue);if(shot)shot.dialogues.push(dialogue);else pendingDialogues.push(dialogue);}
      addLine(shot||scene,trim);
    }

    if(!scenes.length&&rawText){
      const chunks=rawText.split(/\n(?=[A-ZÁÉÍÓÚÑ][^\n]{2,60}\n)/);
      chunks.forEach((chunk,i)=>{const s=makeScene("Escena "+(i+1),i+1);s.description=chunk.trim();});
    }
    scenes.forEach(s=>{
      const shotText=s.shots.map(x=>x.title+"\n"+x.description).join("\n\n");
      const text=[s.description,shotText].filter(Boolean).join("\n\n");
      const c=classify(text);s.types=c.types;s.labels=c.labels;s.mood=c.mood;
      if(s.duration===null&&s.shots.length&&s.shots.every(x=>x.duration!==null))
        s.duration=s.shots.reduce((n,x)=>n+x.duration,0);
      if(!s.shots.length) s.shots=[{number:s.number+".1",title:s.title,description:s.description,duration:s.duration,dialogues:s.dialogues.slice()}];
    });
    const hasDialogue=scenes.some(s=>s.dialogues.length);
    const shotsTotal=scenes.reduce((n,s)=>n+s.shots.length,0);
    const counts={};scenes.forEach(s=>s.types.forEach(t=>counts[t]=(counts[t]||0)+1));
    return {scenes,total:scenes.length,shotsTotal,hasDialogue,counts,globalInstructions:globalInstructions.join("\n").trim(),rawText,hasStructure:seenScene};
  }

  function buildImagePrompt(shot,globalInstructions="",characters=[]) {
    const text=[shot?.title,shot?.description].filter(Boolean).join(". ");
    const context=[globalInstructions,...characters].filter(Boolean).join(". ");
    const vehicle=/\b(autom[oó]vil|coche|carro|auto|veh[ií]culo)\b/i.test(text);
    const motorcycle=/\b(moto|motocicleta)\b/i.test(text);
    const subjectRule=vehicle&&!motorcycle
      ?"REGLA DE OBJETO OBLIGATORIA: mostrar un AUTOMÓVIL de cuatro ruedas, claramente reconocible. NO mostrar motocicletas, bicicletas ni scooters. El automóvil debe ser el vehículo principal si la acción lo requiere."
      :motorcycle?"Mostrar una motocicleta únicamente porque el guion la solicita.":"Respetar literalmente los objetos y acciones descritos; no sustituir vehículos ni personajes.";
    return [
      "Fotograma cinematográfico realista, composición profesional, formato panorámico 16:9, iluminación física coherente, detalle alto, profundidad de campo natural.",
      "ACCIÓN DE ESTA TOMA: "+text,
      context?"CONTINUIDAD Y DIRECCIÓN DE ARTE: "+context:"",
      subjectRule,
      "Continuidad estricta: conservar edad, rostro, peinado, ropa y complexión de cada personaje entre tomas. Una sola escena coherente, sin collage, sin paneles, sin texto, sin subtítulos, sin marcas de agua."
    ].filter(Boolean).join("\n\n");
  }

  function noiseBuffer(ctx,seconds=2){
    const length=Math.max(1,Math.floor(ctx.sampleRate*seconds)),b=ctx.createBuffer(1,length,ctx.sampleRate),d=b.getChannelData(0);
    for(let i=0;i<length;i++)d[i]=Math.random()*2-1;
    return b;
  }
  function tone(ctx,dest,when,freq,dur,wave="sine",vol=.04,endFreq=null){
    if(dur<=0)return;
    const o=ctx.createOscillator(),g=ctx.createGain();
    o.type=wave;o.frequency.setValueAtTime(Math.max(1,freq),when);
    if(endFreq)o.frequency.exponentialRampToValueAtTime(Math.max(1,endFreq),when+dur);
    g.gain.setValueAtTime(.0001,when);g.gain.exponentialRampToValueAtTime(vol,when+Math.min(.08,dur/3));
    g.gain.setValueAtTime(vol,when+dur*.65);g.gain.exponentialRampToValueAtTime(.0001,when+dur);
    o.connect(g);g.connect(dest);o.start(when);o.stop(when+dur+.02);
  }
  function noise(ctx,dest,when,dur,vol=.02,filterType="lowpass",freq=900){
    const src=ctx.createBufferSource(),f=ctx.createBiquadFilter(),g=ctx.createGain();
    src.buffer=noiseBuffer(ctx,Math.max(.2,dur));f.type=filterType;f.frequency.value=freq;
    g.gain.setValueAtTime(.0001,when);g.gain.linearRampToValueAtTime(vol,when+.25);
    g.gain.setValueAtTime(vol,when+Math.max(.26,dur-.3));g.gain.linearRampToValueAtTime(.0001,when+dur);
    src.connect(f);f.connect(g);g.connect(dest);src.start(when);src.stop(when+dur);
  }
  function buildAudio(ctx,destination,duration,analysis){
    const start=ctx.currentTime+.15,master=ctx.createGain(),music=ctx.createGain();
    master.gain.value=.7;music.gain.value=.1;music.connect(master);master.connect(destination);
    const mood=analysis.scenes.some(s=>s.mood==="suspenso")?"suspenso":analysis.scenes.some(s=>s.mood==="accion")?"accion":"drama";
    const notes=mood==="suspenso"?[55,65.41,82.41]:mood==="accion"?[73.42,110,146.83]:[65.41,98,130.81];
    const oscillators=[];
    notes.forEach((hz,i)=>{const o=ctx.createOscillator(),g=ctx.createGain(),f=ctx.createBiquadFilter();o.type="triangle";o.frequency.value=hz;f.type="lowpass";f.frequency.value=360;g.gain.value=i===0?.16:.07;o.connect(f);f.connect(g);g.connect(music);o.start(start);oscillators.push(o);});
    const span=duration/Math.max(1,analysis.scenes.length);
    analysis.scenes.forEach((s,i)=>{
      const when=start+i*span,len=Math.max(.5,Math.min(span*.8,6));
      if(s.types.includes("car")){tone(ctx,master,when,58,len,"sawtooth",.075,135);tone(ctx,master,when+.3,950,.18,"sine",.025,400);}
      if(s.types.includes("motorcycle"))tone(ctx,master,when,95,len,"sawtooth",.07,220);
      if(s.types.includes("rain"))noise(ctx,master,when,len,.035,"highpass",1100);
      if(s.types.includes("wind"))noise(ctx,master,when,len,.022,"lowpass",380);
      if(s.types.includes("footsteps"))for(let k=0;k<Math.min(8,Math.floor(len*1.5));k++)tone(ctx,master,when+k*.48,72+(k%2)*16,.12,"triangle",.025,38);
      if(s.types.includes("workshop")){tone(ctx,master,when,700,.16,"square",.018,500);noise(ctx,master,when+.2,len*.6,.018,"highpass",2200);}
      if(s.types.includes("door")){tone(ctx,master,when,180,.3,"triangle",.05,65);tone(ctx,master,when+.34,620,.12,"sine",.02,250);}
      if(s.types.includes("impact")){noise(ctx,master,when,.5,.07,"lowpass",400);tone(ctx,master,when,90,.3,"sawtooth",.06,32);}
      if(s.types.includes("cafe")){noise(ctx,master,when,len,.010,"bandpass",1250);noise(ctx,master,when,len,.006,"lowpass",420);}
      if(s.types.includes("traffic"))noise(ctx,master,when,len,.012,"lowpass",520);
      if(s.types.includes("chatter"))noise(ctx,master,when,len,.008,"bandpass",1850);
      if(s.types.includes("cups"))for(let k=0;k<3;k++){const at=when+Math.min(len-.2,.7+k*1.35);tone(ctx,master,at,1450+k*170,.12,"sine",.018,900);tone(ctx,master,at+.035,2100+k*90,.08,"sine",.012,1300);}
      if(s.types.includes("laughter"))for(let k=0;k<2;k++){const at=when+Math.min(len-.25,1.1+k*2.1);tone(ctx,master,at,520,.13,"triangle",.009,680);tone(ctx,master,at+.16,620,.12,"triangle",.008,760);}
      if(s.types.includes("zoo")||s.types.includes("birds")){noise(ctx,master,when,len,.012,"highpass",4200);tone(ctx,master,when+.4,1850,.18,"sine",.006,2350);}
      if(s.types.includes("clinic")||s.types.includes("medical")){noise(ctx,master,when,len,.006,"lowpass",650);for(let k=0;k<2;k++)tone(ctx,master,when+1.2+k*2.2,880,.07,"sine",.004,880);}
      if(s.types.includes("market")||s.types.includes("mall")||s.types.includes("crowd")){noise(ctx,master,when,len,.012,"bandpass",1600);noise(ctx,master,when,len,.006,"lowpass",480);}
      if(s.types.includes("restaurant")||s.types.includes("kitchen")){noise(ctx,master,when,len,.009,"bandpass",2400);for(let k=0;k<3;k++)tone(ctx,master,when+.6+k*1.2,1750,.08,"sine",.009,1150);}
      if(s.types.includes("racetrack")){tone(ctx,master,when,72,len,"sawtooth",.06,165);noise(ctx,master,when,len,.009,"lowpass",900);}
      if(s.types.includes("street")){noise(ctx,master,when,len,.012,"lowpass",650);for(let k=0;k<2;k++)tone(ctx,master,when+1.1+k*2.4,520,.09,"square",.004,420);}
      if(s.types.includes("cash"))for(let k=0;k<2;k++)tone(ctx,master,when+.7+k*1.3,1450,.08,"sine",.012,1450);
      if(s.types.includes("shopping"))noise(ctx,master,when,len,.008,"bandpass",2800);
      if(s.types.includes("train")||s.types.includes("airport"))noise(ctx,master,when,len,.014,"lowpass",1000);
      if(s.types.includes("water"))noise(ctx,master,when,len,.018,"lowpass",2200);
      if(s.types.includes("dog")||s.types.includes("cat")||s.types.includes("horse")||s.types.includes("animal"))tone(ctx,master,when+Math.min(1,len*.2),260,.22,"triangle",.007,390);
      if(s.types.includes("alarm"))tone(ctx,master,when,880,.45,"sine",.012,660);
      if(s.dialogues.length){music.gain.setValueAtTime(.035,when);music.gain.setValueAtTime(.1,Math.min(start+duration-.05,when+Math.max(1,len*.7)));}
      if(s.mood==="suspenso")tone(ctx,master,when,440,1.6,"sine",.014,330);
    });
    return ()=>{oscillators.forEach(o=>{try{o.stop();}catch(_){}});try{master.disconnect();music.disconnect();}catch(_){}};
  }

  function audioCuesFor(scene,shot) {
    const shotTypes=classify([shot.title,shot.description].filter(Boolean).join("\n")).types;
    const types=new Set(shotTypes.length?shotTypes:(scene.types||[]));
    const cueMap={
      car:"motor_automovil",
      motorcycle:"motor_motocicleta",
      rain:"lluvia",
      wind:"viento_ambiente",
      footsteps:"pasos",
      workshop:"herramientas_taller",
      door:"puerta",
      impact:"impacto",
      night:"ambiente_suspenso",
      zoo:"ambiente_zoologico",clinic:"ambiente_consultorio",market:"ambiente_mercado",
      mall:"ambiente_plaza_comercial",restaurant:"ambiente_restaurante",cafe:"ambiente_cafeteria",
      racetrack:"ambiente_autodromo",street:"ambiente_calle",car:"motor_automovil",
      motorcycle:"motor_motocicleta",rain:"lluvia",wind:"viento_ambiente",footsteps:"pasos",
      workshop:"herramientas_taller",door:"puerta",impact:"impacto",night:"ambiente_suspenso",
      birds:"aves",animal:"animales",dog:"perros",cat:"gatos",horse:"caballos",kitchen:"cocina",
      crowd:"multitud",chatter:"conversaciones_fondo",cups:"tazas_vasos",cash:"caja_registradora",
      shopping:"carritos_compras",medical:"equipo_medico",alarm:"alarma",train:"tren_metro",
      airport:"aeropuerto",water:"agua",fire:"fuego",insects:"insectos",laughter:"risas"
    };
    return [...types].map(type=>cueMap[type]).filter(Boolean);
  }

  function buildProductionPlan(analysis,totalSeconds=1200,segmentSeconds=15) {
    const sourceScenes=Array.isArray(analysis?.scenes)?analysis.scenes:[];
    const targetSeconds=Math.round(Number(totalSeconds)||1200);
    const segmentDuration=Number(segmentSeconds)===30?30:15;
    if(targetSeconds<15||targetSeconds>1200||targetSeconds%segmentDuration!==0)
      throw new Error("La duración de la película debe ser de 15 segundos a 20 minutos y divisible entre "+segmentDuration+".");
    if(!sourceScenes.length) return {targetSeconds,maxSegmentSeconds:segmentDuration,totalSegments:0,scenes:0,segments:[]};

    const sceneWeights=sourceScenes.map(scene=>{
      const shots=(scene.shots||[]);
      const shotTotal=shots.reduce((sum,shot)=>sum+(Number(shot.duration)>0?Number(shot.duration):0),0);
      return Number(scene.duration)>0?Number(scene.duration):shotTotal>0?shotTotal:Math.max(1,shots.length);
    });
    const sceneTotal=sceneWeights.reduce((sum,value)=>sum+value,0)||sourceScenes.length;
    let sceneCursor=0;
    const sceneRanges=sourceScenes.map((scene,index)=>{
      const duration=index===sourceScenes.length-1?targetSeconds-sceneCursor:targetSeconds*sceneWeights[index]/sceneTotal;
      const start=sceneCursor;sceneCursor+=duration;
      const shots=Array.isArray(scene.shots)&&scene.shots.length?scene.shots:[{
        number:String(scene.number||index+1)+".1",title:scene.title||"Toma principal",
        description:scene.description||"",duration:null,dialogues:scene.dialogues||[]
      }];
      const shotWeights=shots.map(shot=>Number(shot.duration)>0?Number(shot.duration):1);
      const shotTotal=shotWeights.reduce((sum,value)=>sum+value,0)||shots.length;
      let shotCursor=start;
      const shotRanges=shots.map((shot,shotIndex)=>{
        const shotDuration=shotIndex===shots.length-1?start+duration-shotCursor:duration*shotWeights[shotIndex]/shotTotal;
        const range={shot,start:shotCursor,end:shotCursor+shotDuration,index:shotIndex};
        shotCursor+=shotDuration;return range;
      });
      return {scene,start,end:start+duration,index,shotRanges};
    });

    const segments=[];
    const totalSegments=targetSeconds/segmentDuration;
    for(let index=0;index<totalSegments;index++){
      const startSeconds=index*segmentDuration,endSeconds=startSeconds+segmentDuration;
      const midpoint=(startSeconds+endSeconds)/2;
      const overlappingScenes=sceneRanges.filter(range=>range.start<endSeconds&&range.end>startSeconds);
      const primaryScene=overlappingScenes.find(range=>midpoint>=range.start&&midpoint<range.end)||overlappingScenes[0];
      const overlappingShots=overlappingScenes.flatMap(range=>range.shotRanges
        .filter(shotRange=>shotRange.start<endSeconds&&shotRange.end>startSeconds)
        .map(shotRange=>({sceneRange:range,shotRange})));
      const primaryShot=overlappingShots.find(item=>midpoint>=item.shotRange.start&&midpoint<item.shotRange.end)||overlappingShots[0];
      if(!primaryScene||!primaryShot)throw new Error("No fue posible asignar escenas y tomas al segmento "+(index+1)+".");
      const scene=primaryScene.scene,shot=primaryShot.shotRange.shot;
      const promptDescription=overlappingShots.map(({sceneRange,shotRange})=>{
        const currentScene=sceneRange.scene,currentShot=shotRange.shot;
        return (currentScene.title||"Escena")+" — "+(currentShot.title||"Toma")+": "+(currentShot.description||currentScene.description||"");
      }).join("\\n");
      const promptTitle=overlappingShots.map(({shotRange})=>shotRange.shot.title||"Toma").join(" / ");
      const shotForPrompt={title:promptTitle,description:promptDescription};
      const visualPrompt=buildImagePrompt(shotForPrompt,analysis.globalInstructions||"");
      const dialogues=[];
      overlappingShots.forEach(({sceneRange,shotRange})=>{
        const currentShot=shotRange.shot;
        const shotDialogues=(Array.isArray(currentShot.dialogues)&&currentShot.dialogues.length?currentShot.dialogues:
          sceneRange.shotRanges.length===1?(sceneRange.scene.dialogues||[]):[]);
        const dialogueCenter=(shotRange.start+shotRange.end)/2;
        if(dialogueCenter>=startSeconds&&dialogueCenter<endSeconds)
          shotDialogues.forEach((line,lineIndex)=>{
            const slot=shotRange.end-shotRange.start;
            const lineTime=shotRange.start+slot*((lineIndex+0.5)/Math.max(1,shotDialogues.length));
            dialogues.push({character:line.character,text:line.text,atSeconds:Math.max(0,lineTime-startSeconds)});
          });
      });
      const audioCues=[...new Set(overlappingShots.flatMap(({sceneRange,shotRange})=>
        audioCuesFor(sceneRange.scene,{title:shotRange.shot.title||"Toma",description:shotRange.shot.description||sceneRange.scene.description||""})
      ))];
      const sceneTypes=[...new Set(overlappingScenes.flatMap(range=>range.scene.types||[]))];
      segments.push({
        id:index+1,sceneIndex:primaryScene.index,shotIndex:primaryShot.shotRange.index,
        sceneNumber:String(scene.number||primaryScene.index+1),sceneTitle:scene.title||"Escena "+(primaryScene.index+1),
        shotNumber:String(shot.number||(primaryScene.index+1)+"."+(primaryShot.shotRange.index+1)),
        shotTitle:overlappingShots.length>1?promptTitle:(shot.title||"Toma "+(shot.number||1)),
        shotDescription:promptDescription,visualPrompt,
        dialogues,audioCues,sceneTypes,mood:scene.mood||"cinematografico",
        part:1,durationSeconds:segmentDuration,startSeconds,endSeconds
      });
    }
    return {targetSeconds,maxSegmentSeconds:segmentDuration,totalSegments:segments.length,scenes:sourceScenes.length,segments};
  }

  window.VSASceneEngine={analyze,buildImagePrompt,buildAudio,buildProductionPlan};
})();