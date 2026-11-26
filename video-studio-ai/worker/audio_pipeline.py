"""Scene-aware, local Spanish audio pipeline for VIDEO STUDIO AI.

Creates a scene timeline, stable per-character TTS identities, original
procedural music, and synthesized ambience/SFX with FFmpeg. Dialogue is
spoken only when the prompt contains explicit character-attributed lines.
"""
import json
import pathlib
import re
import subprocess
import sys
import urllib.request

ROOT = pathlib.Path("/kaggle/working/video_studio_audio")
VOICE_DIR = ROOT / "voices"
VOICE_SPECS = {
    "claude": {
        "model": "es_MX-claude-high.onnx",
        "base": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_MX/claude/high",
        "pitch": 1.00,
    },
    "ald": {
        "model": "es_MX-ald-medium.onnx",
        "base": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_MX/ald/medium",
        "pitch": 1.00,
    },
}
SCENE_HEADING = re.compile(
    r"(?im)^\s*(?:(?:\d+\.\s*)?(?:GUION[^\n]*?—\s*)?(?:ESCENA|SCENE)\s*\d*\s*[:.\-—].*|"
    r"(?:TOMA|TAKE)\s+\d+(?:\.\d+)?\s*[—:.-]?.*|"
    r"(?:INT\.|EXT\.|INT/EXT\.)\s+.*)$"
)
SPEAKER_LINE = re.compile(
    r"(?m)^\s*([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ -]{1,35}?)"
    r"(?:\s*\([^)]{1,50}\))?\s*:\s*(.+?)\s*$"
)
ATTRIBUTED_QUOTE = re.compile(
    r"(?is)\b([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ -]{1,35})\s+"
    r"(?:dice|dijo|responde|respondió|pregunta|preguntó|exclama|murmura|susurra)"
    r"\s*[:,]?\s*[«“\"]([^»”\"]{2,700})[»”\"]"
)

def _run(args):
    return subprocess.run([str(x) for x in args], check=True, capture_output=True, text=True)

def _ensure_models():
    VOICE_DIR.mkdir(parents=True, exist_ok=True)
    for spec in VOICE_SPECS.values():
        model = VOICE_DIR / spec["model"]
        config = pathlib.Path(str(model) + ".json")
        for path, name in ((model, spec["model"]), (config, spec["model"] + ".json")):
            if not path.exists() or path.stat().st_size < 1000:
                urllib.request.urlretrieve(spec["base"] + "/" + name, path)
    try:
        from piper import PiperVoice
    except ImportError:
        _run([sys.executable, "-m", "pip", "install", "--quiet", "piper-tts==1.8.0"])
        from piper import PiperVoice
    return {
        key: PiperVoice.load(str(VOICE_DIR / spec["model"]))
        for key, spec in VOICE_SPECS.items()
    }

def _split_scenes(prompt, duration):
    text = (prompt or "").strip()
    if not text:
        raise ValueError("El prompt está vacío; no se puede construir la banda sonora.")
    matches = list(SCENE_HEADING.finditer(text))
    blocks = []
    if matches:
        for i, match in enumerate(matches):
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            block = text[match.start():end].strip()
            if block:
                blocks.append(block)
        preamble = text[:matches[0].start()].strip()
        if preamble:
            blocks.insert(0, preamble)
    else:
        blocks = [p.strip() for p in re.split(r"\n\s*\n+", text) if p.strip()]
    if not blocks:
        sentences = re.split(r"(?<=[.!?])\s+", text)
        blocks = [" ".join(sentences[i:i + 4]) for i in range(0, len(sentences), 4)]
    if len(blocks) > 80:
        # Keep a manageable scene timeline; merge the tail rather than dropping story content.
        head = blocks[:79]
        head.append(" ".join(blocks[79:]))
        blocks = head
    weights = [max(1, len(re.findall(r"\w+", b))) for b in blocks]
    total = sum(weights)
    result, cursor = [], 0.0
    for index, (block, weight) in enumerate(zip(blocks, weights)):
        scene_duration = duration - cursor if index == len(blocks) - 1 else duration * weight / total
        result.append({
            "index": index,
            "text": block,
            "start": cursor,
            "duration": max(0.05, scene_duration),
            "dialogues": _extract_dialogues(block),
            "mood": _mood(block),
            "ambience": _ambience(block),
            "effects": _effects(block),
        })
        cursor += scene_duration
    return result

def _extract_dialogues(text):
    lines = []
    for match in SPEAKER_LINE.finditer(text):
        speaker = re.sub(r"\s+", " ", match.group(1)).strip(" -")
        utterance = re.sub(r"\s+", " ", match.group(2)).strip()
        utterance = utterance.strip("“”«»\"'")
        low_speaker = speaker.lower()
        low_utterance = utterance.lower()
        ignored_labels = {"escena", "scene", "int", "ext", "descripción", "descripcion", "prompt", "estilo", "duración", "duracion", "resolución", "resolucion", "personajes", "diálogo", "dialogo"}
        biography_markers = ("años de edad", "años, ", "cabello", "vestuario", "personaje", "descripción", "descripcion", "estatura", "complexión", "complexion", "years old", "short black hair", "denim jacket", "wearing ", "character description", "tall serious man")
        is_heading = low_speaker.startswith(("escena", "scene", "int.", "ext.", "toma"))
        if (low_speaker not in ignored_labels and not is_heading and len(utterance) >= 2
                and len(utterance) <= 260
                and not any(marker in low_utterance for marker in biography_markers)
                and not utterance.startswith(("http", "www."))):
            lines.append({"speaker": speaker, "text": utterance})
    # Screenplay notation used in the web app: "Diálogo: NAME (voice): «spoken line»".
    prefixed = re.compile(
        r"(?im)^\s*(?:diálogo|dialogo)\s*:\s*"
        r"([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ -]{1,35}?)"
        r"(?:\s*\([^)]{1,100}\))?\s*:\s*[«“\"']?([^»”\"'\n]{2,700})[»”\"']?\s*[.!?…]?\s*$"
    )
    for match in prefixed.finditer(text):
        speaker = re.sub(r"\s+", " ", match.group(1)).strip()
        utterance = re.sub(r"\s+", " ", match.group(2)).strip()
        if utterance and utterance.lower() not in {"sin diálogo", "sin dialogo"}:
            lines.append({"speaker": speaker, "text": utterance})
    for match in ATTRIBUTED_QUOTE.finditer(text):
        speaker = re.sub(r"\s+", " ", match.group(1)).strip()
        utterance = re.sub(r"\s+", " ", match.group(2)).strip()
        if not any(x["speaker"].lower() == speaker.lower() and x["text"] == utterance for x in lines):
            lines.append({"speaker": speaker, "text": utterance})
    # Also accept quoted dialogue when the character name is immediately before it.
    for match in re.finditer(r"(?m)^\s*([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ -]{1,35})\s*[—-]\s*[«“\"]([^»”\"]{2,700})[»”\"]", text):
        lines.append({"speaker": match.group(1).strip(), "text": re.sub(r"\s+", " ", match.group(2)).strip()})
    unique, seen = [], set()
    for item in lines:
        key = (item["speaker"].lower(), item["text"].lower())
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return unique[:40]

def _mood(text):
    t = text.lower()
    if any(k in t for k in ("persecución", "carrera", "pelea", "explosión", "huida", "acción", "adrenalina")):
        return "action"
    if any(k in t for k in ("miedo", "misterio", "suspenso", "amenaza", "peligro", "oscuro", "secreto")):
        return "suspense"
    if any(k in t for k in ("triste", "pérdida", "llora", "despedida", "soledad", "dolor")):
        return "sad"
    if any(k in t for k in ("broma", "bromas", "risas", "ríe", "humor", "comedia", "divertido")):
        return "comedy"
    if any(k in t for k in ("romance", "romántico", "romántica", "beso", "enamorados", "pareja")):
        return "romantic"
    if any(k in t for k in ("viaje", "expedición", "explora", "aventura", "descubre", "mundo desconocido")):
        return "adventure"
    if any(k in t for k in ("familia", "hermanos", "amistad", "amor", "esperanza", "atardecer", "alegría")):
        return "warm"
    return "neutral"

def _ambience(text):
    t = text.lower()
    found = []
    rules = {
        "rain": ("lluvia", "llueve", "tormenta", "charcos", "llovizna", "trueno", "relámpago", "relampago", "rain"),
        "wind": ("viento", "ventoso", "ráfaga", "rafaga", "brisa", "ventisca", "wind"),
        "zoo": ("zoológico", "zoologico", "zoo", "safari", "aviario", "recinto animal", "fauna silvestre", "jaula"),
        "clinic": ("consultorio", "clínica", "clinica", "hospital", "urgencias", "enfermería", "enfermeria", "sala de espera", "quirófano", "quirofano"),
        "market": ("mercado", "tianguis", "puesto", "vendedor", "vendedora", "central de abasto", "pasillo de mercado"),
        "mall": ("plaza comercial", "centro comercial", "mall", "tienda departamental", "patio de comidas", "escaleras eléctricas", "escaleras electricas"),
        "restaurant": ("restaurante", "comensales", "mesero", "mesera", "chef", "comedor"),
        "cafe": ("café", "cafe", "cafetería", "cafeteria", "terraza de café", "barista", "máquina de espresso", "maquina de espresso"),
        "race": ("autódromo", "autodromo", "carrera", "circuito", "pista de carreras", "boxes", "parrilla de salida", "pit lane", "motor", "automóvil", "automovil", "auto", "coche", "carro"),
        "city": ("ciudad", "calle", "tráfico", "trafico", "avenida", "boulevard", "semáforo", "semaforo", "cruce peatonal"),
        "library": ("biblioteca", "librería", "libreria", "sala de lectura", "archivo"),
        "school": ("escuela", "colegio", "salón de clases", "salon de clases", "aula", "recreo", "patio escolar"),
        "museum": ("museo", "galería", "galeria", "exposición", "exposicion", "sala de exhibición", "sala de exhibicion"),
        "hotel": ("hotel", "recepción", "recepcion", "lobby", "vestíbulo", "vestibulo", "elevador", "ascensor"),
        "church": ("iglesia", "templo", "catedral", "campanario", "misa"),
        "park": ("parque", "jardín público", "jardin publico", "columpio", "juegos infantiles"),
        "pool": ("alberca", "piscina", "chapoteadero", "natación", "natacion"),
        "bus": ("autobús", "autobus", "camión urbano", "camion urbano", "terminal de autobuses", "parada de autobús", "parada de autobus"),
        "construction": ("construcción", "construccion", "obra", "maquinaria pesada", "excavadora", "taladro", "demolición", "demolicion"),
        "theater": ("teatro", "cine", "sala de cine", "escenario", "butacas", "proyección", "proyeccion"),
        "gym": ("gimnasio", "pesas", "mancuernas", "caminadora", "entrenamiento"),
        "kitchen": ("cocina", "cocinero", "cocinera", "freír", "freir", "sartén", "sarten", "hervir", "horno", "parrilla"),
        "forest": ("bosque", "árboles", "arboles", "selva", "pájaros", "pajaros", "birds"),
        "workshop": ("taller", "mecánico", "mecanico", "herramientas", "garaje", "garage"),
        "indoor": ("habitación", "habitacion", "oficina", "interior", "sala", "consultorio"),
        "night": ("noche", "madrugada", "medianoche"),
        "ocean": ("mar", "océano", "oceano", "olas", "playa", "costa", "marea"),
        "river": ("río", "rio", "arroyo", "cascada", "catarata", "corriente de agua"),
        "fire": ("fuego", "fogata", "hoguera", "chimenea", "incendio", "llamas"),
        "stadium": ("estadio", "gradas", "afición", "aficion", "partido", "cancha", "público", "publico"),
        "subway": ("metro", "estación", "estacion", "tren", "andén", "anden", "ferrocarril"),
        "airport": ("aeropuerto", "avión", "avion", "terminal aérea", "terminal aerea", "despegue", "aterrizaje"),
        "office": ("oficina", "computadora", "teclado", "reunión", "reunion"),
        "farm": ("granja", "rancho", "corral", "caballos", "vacas", "gallinas"),
        "space": ("espacio exterior", "nave espacial", "estación espacial", "estacion espacial", "planeta"),
        "insects": ("grillos", "cigarras", "insectos", "chicharras"),
    }
    for name, words in rules.items():
        if any(word in t for word in words):
            found.append(name)
    return found or ["quiet"]

def _effects(text):
    t = text.lower()
    found = []
    rules = {
        "engine": ("motor", "acelera", "aceleración", "aceleracion", "arranca el auto", "arranca el coche", "revoluciones"),
        "footsteps": ("camina", "corre", "pasos", "pisadas", "huye"),
        "door": ("abre la puerta", "cierra la puerta", "portazo", "puerta se abre", "puerta se cierra", "se cierra una puerta"),
        "impact": ("golpe", "choque", "impacto", "cae al suelo", "explosión", "explosion"),
        "tools": ("soldar", "llave inglesa", "martillo", "herramienta", "repara el motor"),
        "crowd": ("público", "publico", "multitud", "aplausos", "gradas", "estadio lleno", "clientes", "compradores"),
        "gunshot": ("disparo", "disparos", "pistola", "rifle", "arma de fuego"),
        "explosion": ("explosión", "explosion", "detonación", "detonacion", "estalla"),
        "glass": ("cristal", "vidrio", "ventana rota", "rompe el vaso"),
        "phone": ("teléfono", "telefono", "celular", "timbre del móvil", "llamada entrante"),
        "alarm": ("alarma", "sirena", "alerta", "evacuación", "evacuacion"),
        "water": ("salpica", "chapotea", "zambulle", "sumergirse", "salto al agua"),
        "applause": ("ovación", "ovacion", "aplaude", "aplausos"),
        "animal": ("rugido", "león", "leon", "tigre", "elefante", "mono", "monos", "jirafa", "cebra", "oso", "lobo", "foca", "delfín", "delfin"),
        "birds": ("ave", "aves", "pájaro", "pajaro", "pájaros", "pajaros", "loro", "guacamaya", "flamenco", "pingüino", "pinguino", "gaviota"),
        "dog": ("perro", "perros", "ladrido", "ladra", "ladran"),
        "cat": ("gato", "gata", "gatito", "maullido", "maúlla", "maulla"),
        "horse": ("caballo", "caballos", "relincho", "relincha", "galope", "galopa"),
        "cups": ("taza", "tazas", "vaso", "vasos", "copa", "copas", "brindis", "cubiertos", "platos", "loza"),
        "laughter": ("risas", "riendo", "carcajada", "carcajadas"),
        "cash_register": ("caja registradora", "cobrar", "cobro", "terminal bancaria", "escáner", "escaner", "código de barras", "codigo de barras"),
        "shopping_cart": ("carrito", "carritos", "carro de compras", "canasta", "supermercado", "autoservicio"),
        "medical_beep": ("monitor cardíaco", "monitor cardiaco", "monitor médico", "monitor medico", "electrocardiograma", "signos vitales"),
        "train": ("tren", "metro", "vagón", "vagon", "andén", "anden"),
        "aircraft": ("avión", "avion", "aeronave", "despegue", "aterrizaje", "helicóptero", "helicoptero"),
        "cooking": ("freír", "freir", "sartén", "sarten", "hervir", "cocinar", "cocinando", "fríe", "frie", "chef fríe", "chef frie", "parrilla", "horno"),
        "insects": ("grillos", "cigarras", "chicharras", "insectos"),
        "fire": ("fuego", "fogata", "chimenea", "llamas", "incendio"),
        "pages": ("página", "pagina", "hojas", "libro", "pasar página", "pasar pagina"),
        "school_bell": ("timbre escolar", "campana escolar", "timbre de recreo"),
        "elevator": ("elevador", "ascensor", "puertas del elevador"),
        "bus": ("autobús", "autobus", "camión urbano", "camion urbano", "frenos del autobús", "frenos del autobus"),
        "construction": ("taladro", "excavadora", "martillo neumático", "martillo neumatico", "obra", "demolición", "demolicion"),
        "gym": ("pesas", "mancuernas", "barra de pesas", "máquina de gimnasio", "maquina de gimnasio"),
        "church_bell": ("campanas", "campanadas", "campana de iglesia", "campanario"),
        "elevator": ("elevador", "ascensor", "puertas del elevador"),
    }
    for name, words in rules.items():
        if any(word in t for word in words):
            found.append(name)
    return found

def _voice_key(speaker, speaker_order, voice_choice="auto", preferred_voice=None):
    """Assign a stable voice to any character in any project, not a named cast."""
    name = str(speaker or "narrador").strip().lower()
    index = speaker_order.setdefault(name, len(speaker_order))
    choice = str(voice_choice or "auto").strip().lower()

    # Respect an explicit single-voice preference. In auto mode, alternate
    # the available Latin-American Spanish voices by character, then vary
    # pitch slightly to distinguish additional speakers while keeping each
    # character's assignment stable throughout the story.
    selected = str(preferred_voice or "").strip().lower()
    male_names = {"ald", "alvaro", "sirio", "nestor", "javier"}
    female_names = {"claude", "carina", "celeste", "diana", "aquila", "selena", "estrella"}
    if selected in male_names:
        voice = "ald"
    elif selected in female_names:
        voice = "claude"
    elif choice in ("male", "masculine", "hombre"):
        voice = "ald"
    elif choice in ("female", "feminine", "mujer"):
        voice = "claude"
    else:
        voice = "claude" if index % 2 == 0 else "ald"

    pitch = (0.94, 1.0, 1.06)[index % 3]
    return voice, pitch

def _duration(path):
    result = _run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                   "-of", "default=noprint_wrappers=1:nokey=1", path])
    return float(result.stdout.strip())

def _write_music(mood, duration, target):
    chords = {
        "warm": (220, 261.63, 329.63, 392),
        "sad": (220, 261.63, 329.63, 392),
        "suspense": (110, 130.81, 155.56, 207.65),
        "action": (73.42, 110, 146.83, 220),
        "neutral": (164.81, 196, 246.94, 293.66),
        "romantic": (261.63, 329.63, 392.00, 523.25),
        "comedy": (293.66, 369.99, 440.00, 587.33),
        "adventure": (146.83, 196.00, 220.00, 293.66),
    }[mood]
    if mood == "sad":
        chords = (220, 261.63, 311.13, 392)
    freq = "+".join(f"{amp:.4f}*sin(2*PI*{hz:.2f}*t)" for amp, hz in zip((0.035, 0.022, 0.016, 0.010), chords))
    if mood == "action":
        freq += "+0.018*sin(2*PI*55*t)*abs(sin(2*PI*1.6*t))"
    elif mood == "suspense":
        freq += "+0.012*sin(2*PI*(48+3*sin(2*PI*0.12*t))*t)"
    elif mood == "warm":
        freq += "+0.008*sin(2*PI*440*t)"
    source = f"aevalsrc={freq}:s=48000:d={duration}"
    _run(["ffmpeg", "-y", "-f", "lavfi", "-i", source,
          "-af", f"lowpass=f=2500,afade=t=in:d=1.5,afade=t=out:st={max(0,duration-2)}:d=2,volume=0.48",
          "-t", duration, "-ar", 48000, "-ac", 2, target])

def _write_ambience(names, duration, target):
    inputs, filters = [], []
    for name in names:
        if name == "rain":
            source = f"anoisesrc=color=pink:amplitude=0.10:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=5200,highpass=f=180"
        elif name in ("wind", "forest"):
            source = f"anoisesrc=color=brown:amplitude=0.07:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=900"
        elif name == "race":
            source = f"aevalsrc=0.045*sin(2*PI*(68+13*sin(2*PI*0.32*t))*t)+0.012*sin(2*PI*136*t):s=48000:d={duration}"
            filt = "lowpass=f=1200"
        elif name == "city":
            source = f"anoisesrc=color=pink:amplitude=0.035:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=1800,highpass=f=90,tremolo=f=0.16:d=0.35"
        elif name == "airport":
            source = f"anoisesrc=color=brown:amplitude=0.055:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=850,highpass=f=70,tremolo=f=0.12:d=0.45"
        elif name == "cafe":
            source = f"anoisesrc=color=pink:amplitude=0.025:sample_rate=48000:duration={duration}"
            filt = "highpass=f=280,lowpass=f=3200,bandpass=f=1250:w=2100,tremolo=f=0.22:d=0.18"
        elif name == "zoo":
            source = f"anoisesrc=color=pink:amplitude=0.045:sample_rate=48000:duration={duration}"
            filt = "highpass=f=450,lowpass=f=4200,bandpass=f=1500:w=2600,tremolo=f=0.7:d=0.2"
        elif name == "clinic":
            source = f"anoisesrc=color=pink:amplitude=0.012:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=950,highpass=f=180"
        elif name == "library":
            source = f"anoisesrc=color=pink:amplitude=0.006:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=1200,highpass=f=220"
        elif name == "school":
            source = f"anoisesrc=color=pink:amplitude=0.035:sample_rate=48000:duration={duration}"
            filt = "bandpass=f=1400:w=2300,tremolo=f=0.45:d=0.18"
        elif name == "museum":
            source = f"anoisesrc=color=pink:amplitude=0.009:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=1600,highpass=f=180"
        elif name == "hotel":
            source = f"anoisesrc=color=pink:amplitude=0.018:sample_rate=48000:duration={duration}"
            filt = "bandpass=f=1000:w=1700,lowpass=f=3000"
        elif name == "church":
            source = f"anoisesrc=color=pink:amplitude=0.012:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=1900,highpass=f=120"
        elif name == "park":
            source = f"anoisesrc=color=brown:amplitude=0.028:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=2200,highpass=f=160,tremolo=f=0.2:d=0.35"
        elif name == "pool":
            source = f"anoisesrc=color=pink:amplitude=0.04:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=2600,highpass=f=120,tremolo=f=0.7:d=0.28"
        elif name == "bus":
            source = f"anoisesrc=color=brown:amplitude=0.065:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=850,highpass=f=45,tremolo=f=0.35:d=0.4"
        elif name == "construction":
            source = f"anoisesrc=color=pink:amplitude=0.065:sample_rate=48000:duration={duration}"
            filt = "highpass=f=300,lowpass=f=4200,tremolo=f=4:d=0.45"
        elif name == "theater":
            source = f"anoisesrc=color=pink:amplitude=0.02:sample_rate=48000:duration={duration}"
            filt = "bandpass=f=950:w=1700"
        elif name == "gym":
            source = f"anoisesrc=color=pink:amplitude=0.025:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=1800,highpass=f=180"
        elif name == "market":
            source = f"anoisesrc=color=pink:amplitude=0.05:sample_rate=48000:duration={duration}"
            filt = "bandpass=f=1300:w=2400,tremolo=f=0.8:d=0.22"
        elif name == "mall":
            source = f"anoisesrc=color=pink:amplitude=0.035:sample_rate=48000:duration={duration}"
            filt = "bandpass=f=1000:w=1800,lowpass=f=3200"
        elif name == "restaurant":
            source = f"anoisesrc=color=pink:amplitude=0.03:sample_rate=48000:duration={duration}"
            filt = "bandpass=f=1600:w=2200,tremolo=f=0.3:d=0.12"
        elif name == "kitchen":
            source = f"anoisesrc=color=pink:amplitude=0.04:sample_rate=48000:duration={duration}"
            filt = "highpass=f=700,lowpass=f=5200,tremolo=f=2.5:d=0.3"
        elif name == "workshop":
            source = f"anoisesrc=color=pink:amplitude=0.045:sample_rate=48000:duration={duration}"
            filt = "highpass=f=500,lowpass=f=5000"
        elif name == "night":
            source = f"anoisesrc=color=white:amplitude=0.008:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=1200"
        elif name == "ocean":
            source = f"anoisesrc=color=pink:amplitude=0.085:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=1500,highpass=f=90,tremolo=f=0.18:d=0.72"
        elif name == "river":
            source = f"anoisesrc=color=pink:amplitude=0.06:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=2600,highpass=f=140"
        elif name == "fire":
            source = f"anoisesrc=color=brown:amplitude=0.045:sample_rate=48000:duration={duration}"
            filt = "highpass=f=500,lowpass=f=4200,tremolo=f=5:d=0.65"
        elif name == "stadium":
            source = f"anoisesrc=color=pink:amplitude=0.04:sample_rate=48000:duration={duration}"
            filt = "bandpass=f=850:w=1400"
        elif name == "subway":
            source = f"anoisesrc=color=brown:amplitude=0.05:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=700,highpass=f=45,tremolo=f=0.7:d=0.5"
        elif name == "office":
            source = f"anoisesrc=color=pink:amplitude=0.012:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=1400,highpass=f=250"
        elif name == "farm":
            source = f"anoisesrc=color=brown:amplitude=0.035:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=1800"
        elif name == "space":
            source = f"anoisesrc=color=brown:amplitude=0.018:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=480,tremolo=f=0.08:d=0.8"
        elif name == "insects":
            source = f"anoisesrc=color=white:amplitude=0.018:sample_rate=48000:duration={duration}"
            filt = "highpass=f=3200,lowpass=f=9000,tremolo=f=6:d=0.8"
        else:
            continue
        inputs += ["-f", "lavfi", "-i", source]
        idx = len(inputs) // 4 - 1
        filters.append(f"[{idx}:a]{filt},volume=0.45[a{idx}]")
    if not inputs:
        _run(["ffmpeg", "-y", "-f", "lavfi", "-i",
              f"anullsrc=r=48000:cl=stereo:d={duration}", "-t", duration, target])
        return
    labels = "".join(f"[a{i}]" for i in range(len(filters)))
    filters.append(f"{labels}amix=inputs={len(filters)}:duration=longest:normalize=0,volume=0.65[out]")
    _run(["ffmpeg", "-y", *inputs, "-filter_complex", ";".join(filters),
          "-map", "[out]", "-t", duration, "-ar", 48000, "-ac", 2, target])

def _write_sfx(names, duration, target):
    inputs, labels = [], []
    for name in names:
        if name == "engine":
            src = f"aevalsrc=0.10*sin(2*PI*(58+26*sin(2*PI*0.55*t))*t)*abs(sin(2*PI*0.55*t)):s=48000:d={duration}"
            filt = "lowpass=f=900,afade=t=in:d=0.2,volume=0.65"
        elif name == "footsteps":
            src = f"aevalsrc=0.12*lt(mod(t\\,0.62)\\,0.09)*sin(2*PI*72*t):s=48000:d={duration}"
            filt = "lowpass=f=300,volume=0.8"
        elif name == "door":
            src = f"aevalsrc=0.22*(exp(-35*abs(t-0.35))+0.7*exp(-30*abs(t-0.48)))*sin(2*PI*85*t):s=48000:d={duration}"
            filt = "lowpass=f=800,volume=0.7"
        elif name == "impact":
            src = f"anoisesrc=color=brown:amplitude=0.15:sample_rate=48000:duration={duration}"
            filt = "highpass=f=90,lowpass=f=500,agate=threshold=0.04:ratio=8,volume=0.55"
        elif name == "tools":
            src = f"anoisesrc=color=white:amplitude=0.06:sample_rate=48000:duration={duration}"
            filt = "highpass=f=1200,lowpass=f=6500,tremolo=f=7:d=0.6,volume=0.35"
        elif name == "crowd":
            src = f"anoisesrc=color=pink:amplitude=0.045:sample_rate=48000:duration={duration}"
            filt = "bandpass=f=900:w=1200,volume=0.45"
        elif name == "gunshot":
            src = f"anoisesrc=color=white:amplitude=0.18:sample_rate=48000:duration={duration}"
            filt = "highpass=f=900,lowpass=f=7500,agate=threshold=0.025:ratio=12,volume=0.65"
        elif name == "explosion":
            src = f"anoisesrc=color=brown:amplitude=0.18:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=650,agate=threshold=0.035:ratio=8,volume=0.7"
        elif name == "glass":
            src = f"anoisesrc=color=white:amplitude=0.09:sample_rate=48000:duration={duration}"
            filt = "highpass=f=2800,lowpass=f=11000,volume=0.4"
        elif name == "phone":
            src = f"aevalsrc=0.05*sin(2*PI*440*t)+0.05*sin(2*PI*480*t):s=48000:d={duration}"
            filt = "tremolo=f=1.8:d=0.9,volume=0.4"
        elif name == "alarm":
            src = f"aevalsrc=0.08*sin(2*PI*(650+90*sin(2*PI*0.8*t))*t):s=48000:d={duration}"
            filt = "volume=0.45"
        elif name == "water":
            src = f"anoisesrc=color=pink:amplitude=0.09:sample_rate=48000:duration={duration}"
            filt = "highpass=f=180,lowpass=f=3000,tremolo=f=2:d=0.7,volume=0.5"
        elif name == "applause":
            src = f"anoisesrc=color=pink:amplitude=0.07:sample_rate=48000:duration={duration}"
            filt = "highpass=f=700,lowpass=f=6500,tremolo=f=8:d=0.8,volume=0.55"
        elif name == "animal":
            src = f"aevalsrc=0.06*sin(2*PI*(220+55*sin(2*PI*1.2*t))*t):s=48000:d={duration}"
            filt = "lowpass=f=1600,volume=0.4"
        elif name == "cups":
            src = f"aevalsrc=0.12*exp(-18*abs(t-0.08))*sin(2*PI*1800*t)+0.08*exp(-24*abs(t-0.12))*sin(2*PI*2400*t):s=48000:d={duration}"
            filt = "highpass=f=900,lowpass=f=6500,volume=0.55"
        elif name == "laughter":
            src = f"anoisesrc=color=pink:amplitude=0.035:sample_rate=48000:duration={duration}"
            filt = "bandpass=f=900:w=1500,tremolo=f=4:d=0.72,volume=0.28"
        elif name in ("birds", "animal", "dog", "cat", "horse"):
            base = {"birds": 1900, "animal": 260, "dog": 420, "cat": 720, "horse": 180}[name]
            src = f"aevalsrc=0.07*sin(2*PI*({base}+65*sin(2*PI*1.3*t))*t)*abs(sin(2*PI*2.1*t)):s=48000:d={duration}"
            filt = "lowpass=f=5200,volume=0.38"
        elif name == "cash_register":
            src = f"aevalsrc=0.12*exp(-24*abs(t-0.12))*sin(2*PI*1550*t)+0.08*exp(-28*abs(t-0.2))*sin(2*PI*2100*t):s=48000:d={duration}"
            filt = "highpass=f=700,lowpass=f=6000,volume=0.5"
        elif name == "shopping_cart":
            src = f"anoisesrc=color=white:amplitude=0.035:sample_rate=48000:duration={duration}"
            filt = "highpass=f=1800,lowpass=f=7200,tremolo=f=5:d=0.55,volume=0.35"
        elif name == "medical_beep":
            src = f"aevalsrc=0.055*sin(2*PI*880*t)*lt(mod(t\\,1.25)\\,0.09):s=48000:d={duration}"
            filt = "volume=0.55"
        elif name == "train":
            src = f"anoisesrc=color=brown:amplitude=0.08:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=950,highpass=f=45,tremolo=f=0.65:d=0.45,volume=0.5"
        elif name == "aircraft":
            src = f"anoisesrc=color=brown:amplitude=0.09:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=600,highpass=f=35,tremolo=f=0.1:d=0.7,volume=0.5"
        elif name == "cooking":
            src = f"anoisesrc=color=pink:amplitude=0.06:sample_rate=48000:duration={duration}"
            filt = "highpass=f=700,lowpass=f=5200,tremolo=f=7:d=0.6,volume=0.45"
        elif name == "insects":
            src = f"aevalsrc=0.025*sin(2*PI*(4300+120*sin(2*PI*5*t))*t):s=48000:d={duration}"
            filt = "highpass=f=2800,lowpass=f=9000,volume=0.35"
        elif name == "fire":
            src = f"anoisesrc=color=brown:amplitude=0.06:sample_rate=48000:duration={duration}"
            filt = "highpass=f=450,lowpass=f=5000,tremolo=f=4:d=0.7,volume=0.4"
        elif name == "pages":
            src = f"anoisesrc=color=white:amplitude=0.035:sample_rate=48000:duration={duration}"
            filt = "highpass=f=900,lowpass=f=7200,tremolo=f=5:d=0.25,volume=0.35"
        elif name == "elevator":
            src = f"aevalsrc=0.06*sin(2*PI*(660+220*t)*t):s=48000:d={duration}"
            filt = "afade=t=in:d=0.03,afade=t=out:st=0.35:d=0.3,volume=0.4"
        elif name == "school_bell" or name == "church_bell":
            base = 1450 if name == "school_bell" else 880
            src = f"aevalsrc=0.08*sin(2*PI*{base}*t)+0.04*sin(2*PI*{base*2}*t):s=48000:d={duration}"
            filt = "afade=t=in:d=0.03,afade=t=out:st=0.8:d=0.7,volume=0.45"
        elif name == "elevator":
            src = f"aevalsrc=0.06*sin(2*PI*(660+220*t)*t):s=48000:d={duration}"
            filt = "afade=t=in:d=0.03,afade=t=out:st=0.35:d=0.3,volume=0.4"
        elif name == "bus":
            src = f"anoisesrc=color=brown:amplitude=0.08:sample_rate=48000:duration={duration}"
            filt = "lowpass=f=950,highpass=f=40,tremolo=f=0.3:d=0.4,volume=0.45"
        elif name == "construction":
            src = f"anoisesrc=color=white:amplitude=0.07:sample_rate=48000:duration={duration}"
            filt = "highpass=f=250,lowpass=f=5000,tremolo=f=6:d=0.6,volume=0.45"
        elif name == "gym":
            src = f"anoisesrc=color=pink:amplitude=0.05:sample_rate=48000:duration={duration}"
            filt = "highpass=f=150,lowpass=f=2600,tremolo=f=1.8:d=0.5,volume=0.35"
        else:
            continue
        inputs += ["-f", "lavfi", "-i", src]
        labels.append(f"[{len(labels)}:a]{filt}[s{len(labels)}]")
    if not inputs:
        _run(["ffmpeg", "-y", "-f", "lavfi", "-i",
              f"anullsrc=r=48000:cl=stereo:d={duration}", "-t", duration, target])
        return
    mix = "".join(f"[s{i}]" for i in range(len(labels)))
    labels.append(f"{mix}amix=inputs={len(labels)}:duration=longest:normalize=0,volume=0.55[out]")
    _run(["ffmpeg", "-y", *inputs, "-filter_complex", ";".join(labels),
          "-map", "[out]", "-t", duration, "-ar", 48000, "-ac", 2, target])

def build_audio_track(prompt, duration, work_dir, audio_script=None, voice_choice="female"):
    """Create one exact-duration stereo WAV and a machine-readable scene manifest."""
    import wave

    duration = float(duration)
    work_dir = pathlib.Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    scenes = _split_scenes(prompt, duration)
    # Optional script produced by the Cloudflare Workers AI free-tier binding.
    # Map normalized positions onto the actual scene timeline.
    if isinstance(audio_script, dict):
        script_lines = audio_script.get("dialogues", [])
        script_effects = audio_script.get("effects", [])
    elif isinstance(audio_script, list):
        script_lines = audio_script
        script_effects = []
    else:
        script_lines = []
        script_effects = []
    for scene in scenes:
        scene["sfx_events"] = []
    for item in script_effects[:160]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip().lower()
        if name not in {"engine", "footsteps", "door", "impact", "tools", "crowd", "gunshot", "explosion", "glass", "phone", "alarm", "water", "applause", "animal", "birds", "dog", "cat", "horse", "cups", "laughter", "cash_register", "shopping_cart", "medical_beep", "train", "aircraft", "cooking", "insects", "fire", "pages", "school_bell", "elevator", "bus", "construction", "gym", "church_bell"}:
            continue
        try:
            absolute_time = max(0.0, min(duration, float(item.get("time_seconds", 0))))
            requested_length = max(0.2, min(4.0, float(item.get("duration_seconds", 1.5))))
        except (TypeError, ValueError):
            continue
        scene_index = next(
            (i for i, scene in enumerate(scenes)
             if scene["start"] <= absolute_time < scene["start"] + scene["duration"]),
            len(scenes) - 1
        )
        local_time = max(0.0, absolute_time - scenes[scene_index]["start"])
        event_length = max(0.2, min(requested_length, scenes[scene_index]["duration"] - local_time))
        scenes[scene_index]["sfx_events"].append({
            "name": name, "local_position_seconds": local_time, "duration_seconds": event_length
        })
    for item in script_lines[:40]:
        if not isinstance(item, dict):
            continue
        speaker = str(item.get("speaker", "")).strip()[:50]
        utterance = re.sub(r"\s+", " ", str(item.get("text", "")).strip())[:500]
        try:
            position = max(0.0, min(1.0, float(item.get("position", 0.5))))
        except (TypeError, ValueError):
            position = 0.5
        if not speaker or len(utterance) < 2:
            continue
        if item.get("time_seconds") is not None:
            try:
                absolute_time = max(0.0, min(duration, float(item.get("time_seconds"))))
            except (TypeError, ValueError):
                absolute_time = position * duration
            scene_index = next(
                (i for i, scene in enumerate(scenes)
                 if scene["start"] <= absolute_time < scene["start"] + scene["duration"]),
                len(scenes) - 1
            )
            local_seconds = max(0.0, absolute_time - scenes[scene_index]["start"])
            scenes[scene_index]["dialogues"].append({
                "speaker": speaker, "text": utterance, "voice": str(item.get("voice") or ""), "local_position_seconds": local_seconds
            })
        else:
            scene_index = min(len(scenes) - 1, int(round(position * max(0, len(scenes) - 1))))
            scenes[scene_index]["dialogues"].append({
                "speaker": speaker, "text": utterance, "voice": str(item.get("voice") or ""), "global_position": position
            })
    speakers = {}
    voice_choice = str(voice_choice or "female").lower()
    if voice_choice not in ("female", "male", "none"):
        voice_choice = "female"
    has_dialogue = voice_choice != "none" and any(scene["dialogues"] for scene in scenes)
    voices = _ensure_models() if has_dialogue else {}
    if voice_choice == "none":
        for scene in scenes:
            scene["dialogues"] = []
    scene_files, manifest = [], []
    for scene in scenes:
        idx, scene_duration = scene["index"], scene["duration"]
        scene_dir = work_dir / f"audio_scene_{idx:03d}"
        scene_dir.mkdir(parents=True, exist_ok=True)
        music = scene_dir / "music.wav"
        ambience = scene_dir / "ambience.wav"
        sfx = scene_dir / "effects.wav"
        _write_music(scene["mood"], scene_duration, music)
        _write_ambience(scene["ambience"], scene_duration, ambience)
        scheduled_names = {event["name"] for event in scene["sfx_events"]}
        unscheduled_effects = [name for name in scene["effects"] if name not in scheduled_names]
        _write_sfx(unscheduled_effects, scene_duration, sfx)
        inputs = ["-i", str(music), "-i", str(ambience), "-i", str(sfx)]
        has_scene_dialogue = bool(scene["dialogues"])
        music_gain = "0.18" if has_scene_dialogue else "0.34"
        ambience_gain = "0.48" if has_scene_dialogue else "0.72"
        filters = [f"[0:a]volume={music_gain}[music]", f"[1:a]volume={ambience_gain}[amb]", "[2:a]volume=0.72[sfx]"]
        mix_labels = ["[music]", "[amb]", "[sfx]"]
        dialogue_records = []
        dialogue_cursor = 0.35
        for line_index, dialogue in enumerate(scene["dialogues"]):
            voice_key, pitch = _voice_key(dialogue["speaker"], speakers, voice_choice, dialogue.get("voice"))
            speech_path = scene_dir / f"dialogue_{line_index:02d}.wav"
            with wave.open(str(speech_path), "wb") as wav_file:
                voices[voice_key].synthesize_wav(dialogue["text"], wav_file)
            speech_duration = _duration(str(speech_path))
            # Honor the AI screenplay's normalized position when present; otherwise
            # place explicit dialogue sequentially without cutting speech off.
            if "local_position_seconds" in dialogue:
                desired = max(0.0, min(scene_duration, float(dialogue["local_position_seconds"])))
                start = max(dialogue_cursor, min(desired, max(0.0, scene_duration - min(speech_duration, scene_duration))))
            elif "global_position" in dialogue:
                desired = max(0.0, min(1.0, float(dialogue["global_position"])) * duration - scene["start"])
                start = max(dialogue_cursor, min(desired, max(0.0, scene_duration - min(speech_duration, scene_duration))))
            else:
                start = min(dialogue_cursor, max(0.0, scene_duration - min(speech_duration, scene_duration)))
            dialogue_cursor = start + speech_duration + 0.25
            label = f"voice{line_index}"
            inputs += ["-i", str(speech_path)]
            filters.append(
                f"[{3+line_index}:a]aresample=48000,"
                f"asetrate={int(48000*pitch)},aresample=48000,"
                f"atempo={1.0/pitch:.6f},adelay={int(start*1000)}|{int(start*1000)},"
                f"volume=1.45[{label}]"
            )
            mix_labels.append(f"[{label}]")
            dialogue_records.append({
                "speaker": dialogue["speaker"], "voice": voice_key,
                "pitch_variant": pitch, "text": dialogue["text"],
                "scene_offset_seconds": round(start, 3),
            })
        event_records = []
        for event_index, event in enumerate(scene["sfx_events"]):
            event_path = scene_dir / f"effect_event_{event_index:03d}.wav"
            _write_sfx([event["name"]], event["duration_seconds"], str(event_path))
            inputs += ["-i", str(event_path)]
            input_index = 3 + len(dialogue_records) + event_index
            delay_ms = int(round(event["local_position_seconds"] * 1000))
            label = f"event{event_index}"
            filters.append(f"[{input_index}:a]adelay={delay_ms}|{delay_ms},volume=0.82[{label}]")
            mix_labels.append(f"[{label}]")
            event_records.append({
                "name": event["name"],
                "scene_offset_seconds": round(event["local_position_seconds"], 3),
                "duration_seconds": round(event["duration_seconds"], 3)
            })
        filters.append("".join(mix_labels) +
                       f"amix=inputs={len(mix_labels)}:duration=longest:normalize=0,"
                       f"alimiter=limit=0.92,apad,atrim=duration={scene_duration}[out]")
        scene_mix = scene_dir / "scene_mix.wav"
        _run(["ffmpeg", "-y", *inputs, "-filter_complex", ";".join(filters),
              "-map", "[out]", "-t", scene_duration, "-ar", 48000, "-ac", 2,
              "-c:a", "pcm_s16le", str(scene_mix)])
        scene_files.append(scene_mix)
        manifest.append({
            "scene": idx + 1, "start_seconds": round(scene["start"], 3),
            "duration_seconds": round(scene_duration, 3), "mood": scene["mood"],
            "ambience": scene["ambience"], "effects": scene["effects"],
            "dialogues": dialogue_records, "timed_effects": event_records,
        })
    concat = work_dir / "audio_scenes_concat.txt"
    concat.write_text("".join(f"file '{p.as_posix()}'\n" for p in scene_files), encoding="utf-8")
    output = work_dir / "VIDEO_STUDIO_AI_audio.wav"
    _run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat),
          "-t", duration, "-af", "loudnorm=I=-18:LRA=11:TP=-2",
          "-ar", 48000, "-ac", 2, "-c:a", "pcm_s16le", str(output)])
    actual = _duration(str(output))
    if abs(actual - duration) > 0.10:
        raise RuntimeError(f"Audio duration mismatch: expected {duration:.2f}s, got {actual:.2f}s")
    (work_dir / "audio_scene_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return output
