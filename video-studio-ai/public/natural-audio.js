(() => {
  "use strict";
  const ASSETS = {
    rain: "/audio/rain.ogg",
    forest: "/audio/forest.ogg",
    birds: "/audio/birds.ogg",
    footsteps: "/audio/footsteps.ogg",
    cafe: "/audio/cafe.ogg",
    city: "/audio/city.ogg",
    engine: "/audio/engine.ogg",
    workshop: "/audio/workshop.ogg",
    door: "/audio/door.ogg",
    water: "/audio/water.ogg"
  };
  const CUES = {
    lluvia:["rain"], rain:["rain"],
    viento_ambiente:["forest"], wind:["forest"], forest:["forest"],
    aves:["birds"], birds:["birds"], pasos:["footsteps"], footsteps:["footsteps"], ambiente_zoologico:["forest","birds"], zoo:["forest","birds"],
    ambiente_parque:["forest","birds"], park:["forest","birds"], farm:["forest","birds"],
    ambiente_cafeteria:["cafe"], cafe:["cafe"], cafeteria:["cafe"],
    ambiente_restaurante:["cafe"], restaurant:["cafe"],
    ambiente_mercado:["cafe"], market:["cafe"], ambiente_plaza_comercial:["cafe"], mall:["cafe"],
    ambiente_escuela:["cafe"], school:["cafe"], ambiente_hotel:["cafe"], hotel:["cafe"],
    conversaciones_fondo:["cafe"], chatter:["cafe"], crowd:["cafe"], multitud:["cafe"],
    trafico_calle:["city"], ambiente_calle:["city"], street:["city"], city:["city"],
    ambiente_autodromo:["engine"], ambiente_autobus:["city"], motor_automovil:["engine"], motor_motocicleta:["engine"],
    car:["engine"], motorcycle:["engine"], racetrack:["engine"], race:["engine"],
    herramientas_taller:["workshop"], workshop:["workshop"], ambiente_construccion:["workshop"],
    construction:["workshop"],
    puerta:["door"], door:["door"],
    agua:["water"], water:["water"], river:["water"]
  };
  const ONE_SHOT = new Set(["door"]);
  const decoded = new WeakMap();
  function assetKeys(cues) {
    const keys = new Set();
    for (const cue of cues || []) for (const key of (CUES[cue] || (ASSETS[cue] ? [cue] : []))) keys.add(key);
    return [...keys];
  }
  async function load(context, cues, onStatus) {
    let cache = decoded.get(context);
    if (!cache) { cache = new Map(); decoded.set(context, cache); }
    const keys = assetKeys(cues);
    await Promise.all(keys.map(async key => {
      if (cache.has(key)) return cache.get(key);
      const task = (async () => {
        if (onStatus) onStatus("Cargando ambiente natural: " + key + "…");
        const response = await fetch(ASSETS[key], { mode: "same-origin", cache: "force-cache" });
        if (!response.ok) throw new Error("No se pudo descargar el sonido natural '" + key + "' (" + response.status + ").");
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength < 2048) throw new Error("El archivo de ambiente '" + key + "' está vacío o incompleto.");
        return context.decodeAudioData(bytes.slice(0));
      })();
      cache.set(key, task);
      try { cache.set(key, await task); } catch (error) { cache.delete(key); throw error; }
    }));
    return {
      keys,
      play(destination, cue, when, duration, level = 0.14) {
        const names = CUES[cue] || (ASSETS[cue] ? [cue] : []);
        const started = [];
        for (const key of names) {
          const buffer = cache.get(key);
          if (!buffer || typeof buffer.then === "function") continue;
          const source = context.createBufferSource(), gain = context.createGain();
          source.buffer = buffer;
          const loop = !ONE_SHOT.has(key);
          source.loop = loop;
          if (loop && buffer.duration > 1) {
            source.loopStart = Math.min(.15, buffer.duration * .02);
            source.loopEnd = Math.max(source.loopStart + .2, buffer.duration - .12);
          }
          let energy = 0, count = 0, peak = 0;
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const data = buffer.getChannelData(channel), stride = Math.max(1, Math.floor(data.length / 12000));
            for (let i = 0; i < data.length; i += stride) { const v = Math.abs(data[i]); energy += v * v; count++; peak = Math.max(peak, v); }
          }
          const rms = Math.sqrt(energy / Math.max(1, count));
          const normalized = Math.min(4, .16 / Math.max(.001, rms), .94 / Math.max(.001, peak));
          gain.gain.setValueAtTime(.0001, when);
          gain.gain.linearRampToValueAtTime(level * normalized, when + Math.min(.45, duration * .12));
          gain.gain.setValueAtTime(level * normalized, when + duration * .82);
          gain.gain.linearRampToValueAtTime(.0001, when + duration);
          source.connect(gain); gain.connect(destination);
          const offset = loop ? Math.min(buffer.duration * .3, Math.random() * Math.max(0, buffer.duration - .5)) : 0;
          source.start(when, offset);
          source.stop(when + duration + .03);
          started.push(source);
        }
        return started;
      }
    };
  }
  window.VSANaturalAudio = { load, assetKeys, sources: ASSETS, version: "natural1" };
})();
