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
    {type:"library",label:"Biblioteca / librería",re:/\b(biblioteca|librer[ií]a|sala de lectura|archivo)\b/i},
    {type:"school",label:"Escuela / colegio",re:/\b(escuela|colegio|sal[oó]n de clases|aula|recreo|patio escolar)\b/i},
    {type:"museum",label:"Museo / galería",re:/\b(museo|galer[ií]a|exposici[oó]n|sala de exhibici[oó]n)\b/i},
    {type:"hotel",label:"Hotel / recepción",re:/\b(hotel|recepci[oó]n|lobby|vest[ií]bulo|elevador|ascensor)\b/i},
    {type:"church",label:"Iglesia / templo",re:/\b(iglesia|templo|catedral|campanario|misa)\b/i},
    {type:"park",label:"Parque / jardín",re:/\b(parque|jard[ií]n p[uú]blico|columpio|juegos infantiles)\b/i},
    {type:"pool",label:"Alberca / piscina",re:/\b(alberca|piscina|chapoteadero|nataci[oó]n)\b/i},
    {type:"bus",label:"Autobús / terminal",re:/\b(autob[uú]s|cami[oó]n urbano|terminal de autobuses|parada de autob[uú]s)\b/i},
    {type:"construction",label:"Construcción / obra",re:/\b(construcci[oó]n|obra|maquinaria pesada|excavadora|taladro|demolici[oó]n)\b/i},
    {type:"theater",label:"Teatro / cine",re:/\b(teatro|cine|sala de cine|escenario|butacas|proyecci[oó]n)\b/i},
    {type:"gym",label:"Gimnasio / deporte",re:/\b(gimnasio|pesas|mancuernas|caminadora|entrenamiento)\b/i},
    {type:"pages",label:"Páginas / libros",re:/\b(p[aá]gina|hojas|libro|pasar p[aá]gina|hojear)\b/i},
    {type:"school_bell",label:"Timbre escolar",re:/\b(timbre escolar|campana escolar|timbre de recreo)\b/i},
    {type:"church_bell",label:"Campanas de iglesia",re:/\b(campanas de iglesia|campanadas|campana de iglesia|campanario)\b/i},
    {type:"elevator",label:"Elevador / ascensor",re:/\b(elevador|ascensor|puertas del elevador)\b/i},
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
    const prefixed=value.match(/^(?:diálogo|dialogo)\s*:\s*([\p{L}][\p{L}\p{M} .'-]{1,35}?)(?:\s*\([^)]{1,100}\))?\s*:\s*[«“"]?(.+?)[»”"]?$/iu);
    const direct=value.match(/^[-–—]?\s*([\p{L}][\p{L}\p{M} .'-]{0,35}?)(?:\s*\([^)]{1,100}\))?\s*(?::|—|–)\s*[«“"]?(.+?)[»”"]?$/u);
    const narrated=value.match(/^([\p{L}][\p{L}\p{M} .'-]{1,35}?)\s+(?:dice|responde|pregunta|grita|susurra|contesta|murmura)\s*[:,]?\s*[«“"](.+?)[»”"]$/iu);
    const m=prefixed||narrated||direct;
    if(!m)return null;
    const character=m[1].trim().replace(/\s+/g," ").replace(/^Personaje\s*\d+\s*[–—-]\s*/i,"").trim();
    const text=m[2].trim().replace(/[»”"]+$/,"").replace(/^[«“"]+/,"").trim();
    if(/^(duración|formato|resolución|estilo|escena|toma|audio|sincronización)$/i.test(character))return null;
    if(text.length<2||/^(?:sin diálogo|sin dialogo)$/i.test(text))return null;
    return {character,text};
  }

  function extractInlineDialogues(text) {
    const source=String(text||"");
    const rows=[];
    const quoted=/(?:Personaje\s*\d+\s*[–—-]\s*)?([\p{L}][\p{L}\p{M} .'-]{0,35}?)\s*:\s*[\s\S]{0,260}?\b(?:dice|responde|pregunta|contesta|grita|susurra|murmura)(?:\s+[^:«“"]{0,80})?\s*[:,]?\s*[«“"]([^»”"]{2,1200})[»”"]/giu;
    let match;
    while((match=quoted.exec(source))!==null){
      const character=match[1].trim().replace(/\s+/g," ").replace(/^Personaje\s*\d+\s*[–—-]\s*/i,"").trim();
      const spoken=match[2].trim();
      if(character&&spoken&&!/^(audio|sincronización|sincronizacion|estilo|formato)$/i.test(character))
        rows.push({character,text:spoken});
    }
    const direct=/(?:^|\n)\s*(?:Personaje\s*\d+\s*[–—-]\s*)?([\p{L}][\p{L}\p{M} .'-]{0,35})\s*:\s*[«“"]([^»”"]{2,1200})[»”"]/gimu;
    while((match=direct.exec(source))!==null){
      const character=match[1].trim().replace(/\s+/g," ").replace(/^Personaje\s*\d+\s*[–—-]\s*/i,"").trim();
      const spoken=match[2].trim();
      if(character&&spoken&&!rows.some(row=>row.character.toLocaleLowerCase()===character.toLocaleLowerCase()&&row.text===spoken))
        rows.push({character,text:spoken});
    }
    return rows;
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

    if(inlineDialogues.length){
      scenes.forEach(s=>{
        s.dialogues=inlineDialogues.map(row=>({...row}));
        if(s.shots.length===1)s.shots[0].dialogues=inlineDialogues.map(row=>({...row}));
      });
    }

    if(!scenes.length&&rawText){
      const chunks=rawText.split(/\n(?=[A-ZÁÉÍÓÚÑ][^\n]{2,60}\n)/);
      chunks.forEach((chunk,i)=>{const s=makeScene("Escena "+(i+1),i+1);s.description=chunk.trim();});
    }
    scenes.forEach(s=>{
      const shotText=s.shots.map(x=>x.title+"\n"+x.description).join("\n\n");
      const text=[s.title,s.description,shotText].filter(Boolean).join("\n\n");
      s.semanticDescription=semanticText||s.title;
      s.shots.forEach(item=>{item.semanticDescription=semanticText||item.title;});
      const c=classify(semanticText||s.title);s.types=c.types;s.labels=c.labels;s.mood=c.mood;
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

  function addMusicPluck(ctx,dest,when,frequency,duration,volume=.035){
    const osc=ctx.createOscillator(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    osc.type="triangle";osc.frequency.setValueAtTime(frequency,when);
    filter.type="lowpass";filter.frequency.setValueAtTime(2600,when);filter.Q.value=.55;
    gain.gain.setValueAtTime(.0001,when);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002,volume),when+.018);
    gain.gain.exponentialRampToValueAtTime(.0001,when+duration);
    osc.connect(filter);filter.connect(gain);gain.connect(dest);
    osc.start(when);osc.stop(when+duration+.02);
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
  function addGlassClinks(ctx,dest,when,count=3){
    for(let k=0;k<count;k++){
      const at=when+.65+k*1.45,frequency=1450+Math.random()*500;
      tone(ctx,dest,at,frequency,.13,"sine",.012,frequency*.72);
      tone(ctx,dest,at+.025,frequency*1.48,.09,"sine",.006,frequency*1.2);
    }
  }
  async function buildAudio(ctx,destination,duration,analysis){
    if(!window.VSANaturalAudio)throw new Error("La biblioteca de ambientes naturales no está disponible. Actualiza la aplicación.");
    const cueRows=analysis.scenes.map(scene=>audioCuesFor(scene,scene.shots?.[0]));
    const allCues=cueRows.flat();
    const natural=await window.VSANaturalAudio.load(ctx,allCues);
    const start=ctx.currentTime+.15,master=ctx.createGain(),music=ctx.createGain(),compressor=ctx.createDynamicsCompressor();
    compressor.threshold.value=-12;compressor.knee.value=4;compressor.ratio.value=12;
    compressor.attack.value=.003;compressor.release.value=.24;
    master.gain.value=.92;music.gain.value=analysis.hasDialogue?.22:.42;
    music.connect(master);master.connect(compressor);compressor.connect(destination);
    const mood=analysis.scenes.some(s=>s.mood==="suspenso")?"suspenso":analysis.scenes.some(s=>s.mood==="accion")?"accion":"drama";
    const scale=mood==="suspenso"?[146.83,174.61,220,293.66,261.63,220]:mood==="accion"?[196,246.94,293.66,392,349.23,293.66]:[220,261.63,329.63,392,349.23,293.66];
    const beat=mood==="accion"?.34:.48;
    for(let t=0,n=0;t<duration;t+=beat,n++){
      const at=start+t,root=scale[n%scale.length];
      addMusicPluck(ctx,music,at,root,.34,.065);
      if(n%3===1)addMusicPluck(ctx,music,at+.12,root*2,.22,.014);
    }
    const span=duration/Math.max(1,analysis.scenes.length);
    analysis.scenes.forEach((scene,index)=>{
      const when=start+index*span,len=Math.max(.5,Math.min(span*.8,6));
      const cues=cueRows[index]||[];
      const ambienceLevel=scene.dialogues.length?.66:.88;
      cues.forEach(cue=>{
        if(window.VSANaturalAudio.assetKeys([cue]).length)
          natural.play(master,cue,when,len,ambienceLevel);
      });
      if(scene.types.includes("cups"))addGlassClinks(ctx,master,when,3);
      if(scene.types.includes("impact"))tone(ctx,master,when,105,.22,"triangle",.035,42);
      if(scene.types.includes("alarm"))tone(ctx,master,when,880,.45,"sine",.012,660);
      if(scene.types.includes("clinic")||scene.types.includes("medical")){
        tone(ctx,master,when+1.2,880,.08,"sine",.006,880);
        tone(ctx,master,when+3.1,880,.08,"sine",.006,880);
      }
      if(scene.dialogues.length){
        music.gain.setValueAtTime(.075,when);
        music.gain.setValueAtTime(.22,Math.min(start+duration-.05,when+Math.max(1,len*.7)));
      }
      if(scene.mood==="suspenso")tone(ctx,master,when,440,1.6,"sine",.014,330);
    });
    return ()=>{try{master.disconnect();music.disconnect();compressor.disconnect();}catch(_){}};
  }

  function audioCuesFor(scene,shot) {
    const shotTypes=classify(shot.semanticDescription||"").types;
    // Classify only story content; technical audio/synchronization instructions are not scene cues.
    const sceneContextTypes=classify(scene.semanticDescription||scene.title||"").types;
    const types=new Set([...sceneContextTypes,...shotTypes]);
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
      racetrack:"ambiente_autodromo",street:"ambiente_calle",library:"ambiente_biblioteca",
      school:"ambiente_escuela",museum:"ambiente_museo",hotel:"ambiente_hotel",church:"ambiente_iglesia",
      park:"ambiente_parque",pool:"ambiente_piscina",bus:"ambiente_autobus",construction:"ambiente_construccion",
      theater:"ambiente_teatro",gym:"ambiente_gimnasio",pages:"paginas",school_bell:"timbre_escolar",
      church_bell:"campanas_iglesia",elevator:"elevador",car:"motor_automovil",
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

  window.VSASceneEngine={analyze,buildImagePrompt,buildAudio,buildProductionPlan,audioVersion:"20261127-natural2"};
})();