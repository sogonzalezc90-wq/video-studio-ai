# VIDEO STUDIO AI — Código íntegro por celda (versión GitHub main)

**Importante:** sustituye el contenido completo de cada celda de código indicada, sin mezclarlo con código anterior. Ejecuta en orden las celdas 1, 2, 3, 4 y 5. Cuando la prueba MP4 termine correctamente, ejecuta la celda final del worker. Las celdas 6 y 7 son informativas.

**No edites ni pegues claves** en estas celdas. Usa Kaggle Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_TOKEN`.

## CELDA 1 — Validar entorno y rutas

```python
# CELDA 1 — Validar entorno Kaggle, GPU, CUDA y rutas únicas
import os, sys, shutil, subprocess, platform, pathlib

print("Python:", sys.version)
print("Plataforma:", sys.platform, platform.platform())
if sys.platform != "linux" or not pathlib.Path("/kaggle").is_dir():
    raise RuntimeError("ENTORNO INCORRECTO: abre este notebook en Kaggle y ejecuta su kernel Linux, no la vista previa del navegador.")
if shutil.which("nvidia-smi") is None:
    raise RuntimeError("No se detecta nvidia-smi. En Kaggle selecciona Accelerator = GPU.")
subprocess.run(["nvidia-smi"], check=True)

import torch
print("PyTorch:", torch.__version__, "| CUDA:", torch.version.cuda, "| disponible:", torch.cuda.is_available())
if not torch.cuda.is_available():
    raise RuntimeError("PyTorch no detecta CUDA. Se detiene sin modificar PyTorch.")
print("GPU 0:", torch.cuda.get_device_name(0))
print("Número de GPU visibles:", torch.cuda.device_count())
for i in range(torch.cuda.device_count()):
    print(f"GPU {i} VRAM GiB:", round(torch.cuda.get_device_properties(i).total_memory / 1024**3, 2))

# RUTAS CANÓNICAS: no redefinir COMFY en ninguna celda posterior.
PERSISTENT_WORK = pathlib.Path("/kaggle/working")
SCRATCH = pathlib.Path("/kaggle/tmp/video_studio_ai")
TMP = SCRATCH / "tmp"
COMFY = SCRATCH / "ComfyUI"
OUTPUT = PERSISTENT_WORK / "video_studio_output"
WORKER_OUTPUT = PERSISTENT_WORK / "video_studio_jobs"
for folder in (SCRATCH, TMP, OUTPUT, WORKER_OUTPUT):
    folder.mkdir(parents=True, exist_ok=True)
os.environ["TMPDIR"] = str(TMP)
os.environ["PIP_CACHE_DIR"] = str(SCRATCH / "pip-cache")
os.environ["HF_HOME"] = str(SCRATCH / "hf-home")
os.environ["HUGGINGFACE_HUB_CACHE"] = str(SCRATCH / "hf-home" / "hub")
os.environ["COMFY_URL"] = "http://127.0.0.1:8188"
os.environ["VSA_OUTPUT_DIR"] = str(WORKER_OUTPUT)
print("ComfyUI y modelos:", COMFY)
print("Prueba aislada:", OUTPUT)
print("Trabajos de Supabase:", WORKER_OUTPUT)
print("Scratch libre GiB:", round(shutil.disk_usage(SCRATCH).free / 1024**3, 2))
print("Working libre GiB:", round(shutil.disk_usage(PERSISTENT_WORK).free / 1024**3, 2))
if shutil.disk_usage(PERSISTENT_WORK).free < 2 * 1024**3:
    raise RuntimeError("Quedan menos de 2 GiB en /kaggle/working. Libera espacio antes de generar videos.")
```

## CELDA 2 — Instalar ComfyUI

```python
# CELDA 2 — Instalar ComfyUI sin sustituir PyTorch/CUDA de Kaggle
import subprocess, sys, pathlib, torch, importlib.util, shutil

def run_cmd(args, cwd=None):
    print("$", " ".join(map(str, args)))
    subprocess.run(list(map(str, args)), cwd=cwd, check=True)

if not COMFY.is_dir():
    run_cmd(["git", "clone", "--depth", "1", "https://github.com/comfyanonymous/ComfyUI.git", str(COMFY)])
elif not (COMFY / "main.py").is_file():
    raise RuntimeError(f"La carpeta existe pero no contiene main.py: {COMFY}. Elimina solo esa carpeta incompleta y vuelve a ejecutar esta celda.")
else:
    print("ComfyUI ya está clonado; se reutiliza:", COMFY)

constraints = SCRATCH / "torch-constraints.txt"
protected = [f"torch=={torch.__version__}"]
for package in ("torchvision", "torchaudio"):
    if importlib.util.find_spec(package):
        module = __import__(package)
        protected.append(f"{package}=={module.__version__}")
constraints.write_text("\n".join(protected) + "\n", encoding="utf-8")
print("Versiones protegidas:", constraints.read_text())
run_cmd([sys.executable, "-m", "pip", "install", "-r", str(COMFY / "requirements.txt"), "-c", str(constraints)])
if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
    run_cmd(["apt-get", "update", "-qq"])
    run_cmd(["apt-get", "install", "-y", "-qq", "ffmpeg"])
if not torch.cuda.is_available():
    raise RuntimeError("CUDA dejó de estar disponible. No continúes con las siguientes celdas.")
print("ComfyUI instalado. PyTorch:", torch.__version__, "| CUDA:", torch.version.cuda)
print("ffmpeg:", shutil.which("ffmpeg"), "| ffprobe:", shutil.which("ffprobe"))
```

## CELDA 3 — Descargar modelos

```python
# CELDA 3 — Descargar/verificar los tres modelos en la ruta canónica
import sys, pathlib, shutil, subprocess
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "huggingface_hub"], check=True)
from huggingface_hub import hf_hub_download, HfApi

MODEL_SOURCES = [
    ("Comfy-Org/Wan_2.2_ComfyUI_Repackaged", "split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors", COMFY / "models/diffusion_models"),
    ("Comfy-Org/Wan_2.1_ComfyUI_repackaged", "split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors", COMFY / "models/text_encoders"),
    ("Comfy-Org/Wan_2.2_ComfyUI_Repackaged", "split_files/vae/wan2.2_vae.safetensors", COMFY / "models/vae"),
]
if not (COMFY / "main.py").is_file():
    raise RuntimeError(f"No existe ComfyUI en {COMFY}. Ejecuta primero la celda 2.")
api = HfApi()
sizes = {}
for repo_id, filename, folder in MODEL_SOURCES:
    info = api.model_info(repo_id, files_metadata=True)
    remote = {item.rfilename: item.size for item in (info.siblings or [])}
    if filename not in remote or not remote[filename]:
        raise RuntimeError(f"No se encontró el archivo oficial esperado: {repo_id}/{filename}")
    sizes[(repo_id, filename)] = remote[filename]
required = sum(sizes.values())
free = shutil.disk_usage(SCRATCH).free
print("Tamaño total de modelos GiB:", round(required / 1024**3, 2), "| espacio libre GiB:", round(free / 1024**3, 2))
if free < required + 5 * 1024**3:
    raise RuntimeError("Espacio insuficiente en scratch para los modelos y margen temporal de 5 GiB.")
for repo_id, filename, folder in MODEL_SOURCES:
    folder.mkdir(parents=True, exist_ok=True)
    destination = folder / pathlib.Path(filename).name
    expected = sizes[(repo_id, filename)]
    if destination.exists() and destination.stat().st_size == expected:
        print("Ya verificado:", destination.name, round(expected / 1024**3, 2), "GiB")
        continue
    if destination.exists():
        destination.unlink()
    print("Descargando:", repo_id, filename)
    downloaded = pathlib.Path(hf_hub_download(repo_id=repo_id, filename=filename, local_dir=str(COMFY)))
    if downloaded.resolve() != destination.resolve():
        shutil.move(str(downloaded), str(destination))
    if not destination.exists() or destination.stat().st_size != expected:
        raise RuntimeError(f"Descarga incompleta: {destination}; esperado {expected} bytes.")
    print("Descarga verificada:", destination.name, round(destination.stat().st_size / 1024**3, 2), "GiB")
print("VALIDACIÓN CORRECTA: los tres modelos están en las carpetas que utilizará ComfyUI.")
```

## CELDA 4 — Iniciar ComfyUI y validar nodos

```python
# CELDA 4 — Arrancar una sola instancia de ComfyUI y validar sus nodos/entradas
import subprocess, time, requests, os, sys, pathlib, json

BASE = os.environ.get("COMFY_URL", "http://127.0.0.1:8188")
COMFY_LOG = SCRATCH / "comfyui.log"
required_models = [
    COMFY / "models/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors",
    COMFY / "models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors",
    COMFY / "models/vae/wan2.2_vae.safetensors",
]
missing_models = [str(p) for p in required_models if not p.is_file() or p.stat().st_size < 1_000_000]
if missing_models:
    raise FileNotFoundError("Faltan modelos descargados en la ruta correcta:\n" + "\n".join(missing_models))
if not (COMFY / "main.py").is_file():
    raise FileNotFoundError(f"No existe {COMFY / 'main.py'}. No cambies esta ruta entre celdas.")

# Si el servidor ya responde, reutilizarlo: evita procesos duplicados al reejecutar la celda.
try:
    health = requests.get(BASE + "/system_stats", timeout=5)
    health.raise_for_status()
    print("ComfyUI ya estaba activo; no se inicia otra instancia.")
    server = None
except requests.RequestException:
    log_handle = open(COMFY_LOG, "a", buffering=1)
    cmd = [sys.executable, "main.py", "--listen", "127.0.0.1", "--port", "8188", "--lowvram", "--fp16-vae", "--disable-auto-launch"]
    server = subprocess.Popen(cmd, cwd=str(COMFY), stdout=log_handle, stderr=subprocess.STDOUT)
    print("Iniciando ComfyUI PID:", server.pid)
    ready = False
    for attempt in range(180):
        if server.poll() is not None:
            log_handle.flush()
            print(COMFY_LOG.read_text(errors="replace")[-16000:])
            raise RuntimeError("ComfyUI terminó durante el arranque. Consulta el registro anterior.")
        try:
            response = requests.get(BASE + "/system_stats", timeout=5)
            if response.ok:
                ready = True
                break
        except requests.RequestException:
            pass
        time.sleep(5)
    log_handle.flush()
    if not ready:
        print(COMFY_LOG.read_text(errors="replace")[-16000:])
        raise TimeoutError("ComfyUI no respondió después de 15 minutos.")

obj = requests.get(BASE + "/object_info", timeout=60)
obj.raise_for_status()
obj = obj.json()
required_nodes = ["UNETLoader", "CLIPLoader", "VAELoader", "ModelSamplingSD3", "CLIPTextEncode", "Wan22ImageToVideoLatent", "KSampler", "VAEDecode", "CreateVideo", "SaveVideo"]
missing_nodes = [name for name in required_nodes if name not in obj]
if missing_nodes:
    raise RuntimeError("Faltan nodos requeridos: " + ", ".join(missing_nodes) + ". Revisa " + str(COMFY_LOG))
def node_inputs(name):
    schema = obj[name].get("input", {})
    return set(schema.get("required", {})) | set(schema.get("optional", {}))
checks = {
    "UNETLoader": {"unet_name", "weight_dtype"},
    "CLIPLoader": {"clip_name", "type", "device"},
    "VAELoader": {"vae_name"},
    "ModelSamplingSD3": {"model", "shift"},
    "CLIPTextEncode": {"text", "clip"},
    "Wan22ImageToVideoLatent": {"width", "height", "length", "batch_size", "vae"},
    "KSampler": {"model", "positive", "negative", "latent_image", "seed", "steps", "cfg", "sampler_name", "scheduler", "denoise"},
    "VAEDecode": {"samples", "vae"},
    "CreateVideo": {"images", "fps"},
    "SaveVideo": {"video", "filename_prefix", "format"},
}
for name, expected in checks.items():
    missing = expected - node_inputs(name)
    if missing:
        raise RuntimeError(f"El nodo {name} no ofrece las entradas esperadas: {sorted(missing)}. Firma: {json.dumps(obj[name].get('input', {}), ensure_ascii=False)[:4000]}")
CREATE_VIDEO_OPTIONS = {k: v for k, v in {"bit_depth": "auto", "codec": "none", "color_space": "sRGB"}.items() if k in node_inputs("CreateVideo")}
print("ComfyUI activo:", BASE)
print("Nodos y puertos verificados:", ", ".join(required_nodes))
print("Opciones CreateVideo compatibles:", CREATE_VIDEO_OPTIONS)
print("GPU visible para PyTorch:", torch.cuda.device_count(), "(ComfyUI no distribuye automáticamente la inferencia entre ambas GPU).")
```

## CELDA 5 — Generar y verificar MP4 de prueba

```python
# CELDA 5 — Ejecutar de verdad una prueba Wan 2.2 T2V (~2.04 segundos)
import requests, json, time, pathlib, subprocess, uuid

PROMPT_TEXT = "A cinematic realistic red sports car driving fast along a winding mountain road at sunset, dynamic tracking camera, realistic wheel motion, dramatic golden-hour lighting, detailed environment, smooth natural movement."
NEGATIVE_TEXT = "low quality, blurry, distorted, deformed vehicle, extra wheels, flicker, artifacts, text, watermark, static image"
SEED = int(time.time()) % 2**32
WIDTH, HEIGHT, FRAMES, FPS = 640, 352, 49, 24
for folder, filename in [("diffusion_models", "wan2.2_ti2v_5B_fp16.safetensors"), ("text_encoders", "umt5_xxl_fp8_e4m3fn_scaled.safetensors"), ("vae", "wan2.2_vae.safetensors")]:
    model_path = COMFY / "models" / folder / filename
    if not model_path.is_file() or model_path.stat().st_size < 1_000_000:
        raise FileNotFoundError(f"Modelo ausente/incompleto: {model_path}")

workflow = {
    "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "wan2.2_ti2v_5B_fp16.safetensors", "weight_dtype": "default"}},
    "2": {"class_type": "ModelSamplingSD3", "inputs": {"model": ["1", 0], "shift": 8}},
    "4": {"class_type": "CLIPLoader", "inputs": {"clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors", "type": "wan", "device": "default"}},
    "5": {"class_type": "VAELoader", "inputs": {"vae_name": "wan2.2_vae.safetensors"}},
    "6": {"class_type": "CLIPTextEncode", "inputs": {"text": PROMPT_TEXT, "clip": ["4", 0]}},
    "7": {"class_type": "CLIPTextEncode", "inputs": {"text": NEGATIVE_TEXT, "clip": ["4", 0]}},
    "55": {"class_type": "Wan22ImageToVideoLatent", "inputs": {"width": WIDTH, "height": HEIGHT, "length": FRAMES, "batch_size": 1, "vae": ["5", 0]}},
    "3": {"class_type": "KSampler", "inputs": {"model": ["2", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["55", 0], "seed": SEED, "steps": 12, "cfg": 5, "sampler_name": "uni_pc", "scheduler": "simple", "denoise": 1}},
    "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["5", 0]}},
    "57": {"class_type": "CreateVideo", "inputs": {"images": ["8", 0], "fps": FPS, **CREATE_VIDEO_OPTIONS}},
    "58": {"class_type": "SaveVideo", "inputs": {"video": ["57", 0], "filename_prefix": "VIDEO_STUDIO_AI/Wan22_test", "format": "auto", "format.codec": "auto"}},
}
assert workflow["3"]["inputs"]["positive"] == ["6", 0] and workflow["3"]["inputs"]["negative"] == ["7", 0]
assert workflow["3"]["inputs"]["latent_image"] == ["55", 0] and workflow["58"]["inputs"]["video"] == ["57", 0]

# Enviar a la API real de ComfyUI.
submitted = requests.post(BASE + "/prompt", json={"prompt": workflow, "client_id": str(uuid.uuid4())}, timeout=120)
if not submitted.ok:
    raise RuntimeError("ComfyUI rechazó el workflow: " + submitted.text[:6000])
prompt_id = submitted.json().get("prompt_id")
if not prompt_id:
    raise RuntimeError("ComfyUI no devolvió prompt_id: " + submitted.text[:2000])
print("Trabajo enviado a ComfyUI. prompt_id:", prompt_id, "| seed:", SEED)
deadline = time.time() + 90 * 60
result_record = None
while time.time() < deadline:
    history_response = requests.get(f"{BASE}/history/{prompt_id}", timeout=30)
    history_response.raise_for_status()
    history = history_response.json()
    result_record = history.get(prompt_id)
    if result_record:
        status = result_record.get("status", {})
        if status.get("status_str") == "error":
            raise RuntimeError("Wan 2.2/ComfyUI reportó error: " + json.dumps(status.get("messages", []), ensure_ascii=False)[-6000:])
        if status.get("completed") and result_record.get("outputs"):
            break
    print("Wan 2.2 sigue generando; comprobación cada 15 segundos...")
    time.sleep(15)
else:
    raise TimeoutError("La prueba Wan 2.2 superó 90 minutos. Revisa la salida de ComfyUI y el registro.")

video_items = []
for node_output in result_record.get("outputs", {}).values():
    if isinstance(node_output, dict):
        for key in ("videos", "gifs", "images"):
            video_items.extend(x for x in node_output.get(key, []) if isinstance(x, dict) and x.get("filename"))
mp4_item = next((x for x in video_items if pathlib.Path(x["filename"]).suffix.lower() == ".mp4"), None)
if not mp4_item:
    raise RuntimeError("El workflow terminó pero SaveVideo no devolvió un archivo MP4. Outputs: " + json.dumps(result_record.get("outputs", {}), ensure_ascii=False)[:5000])
download = requests.get(BASE + "/view", params={"filename": mp4_item["filename"], "subfolder": mp4_item.get("subfolder", ""), "type": mp4_item.get("type", "output")}, timeout=600)
download.raise_for_status()
TEST_VIDEO = OUTPUT / "Wan22_test.mp4"
TEST_VIDEO.write_bytes(download.content)
if TEST_VIDEO.stat().st_size < 100_000:
    raise RuntimeError(f"El MP4 de prueba es demasiado pequeño: {TEST_VIDEO.stat().st_size} bytes")
probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height", "-of", "json", str(TEST_VIDEO)], check=True, capture_output=True, text=True)
probe_data = json.loads(probe.stdout)
actual_duration = float(probe_data["format"]["duration"])
if abs(actual_duration - FRAMES / FPS) > 0.35:
    raise RuntimeError(f"Duración inesperada del MP4: {actual_duration:.2f}s")
print("PRUEBA REAL CORRECTA")
print("Archivo:", TEST_VIDEO)
print("Tamaño MiB:", round(TEST_VIDEO.stat().st_size / 1024**2, 2))
print("Duración:", round(actual_duration, 2), "s")
print("Streams:", probe_data.get("streams", []))
```

## CELDA 9 — Iniciar worker Supabase

```python
# CELDA 9 — Conectar secretos de Kaggle, descargar worker verificado y arrancar cola
from kaggle_secrets import UserSecretsClient
import os, runpy, pathlib, urllib.request, json, sys, py_compile, hashlib

secrets = UserSecretsClient()
os.environ["SUPABASE_URL"] = secrets.get_secret("SUPABASE_URL").rstrip("/")
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = secrets.get_secret("SUPABASE_SERVICE_ROLE_KEY")
GITHUB_TOKEN = secrets.get_secret("GITHUB_TOKEN")
if not os.environ["SUPABASE_URL"].startswith("https://") or len(os.environ["SUPABASE_SERVICE_ROLE_KEY"]) < 40:
    raise RuntimeError("Configura SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en Kaggle Secrets. No pegues sus valores en el notebook.")
if not GITHUB_TOKEN or len(GITHUB_TOKEN) < 20:
    raise RuntimeError("Falta GITHUB_TOKEN en Kaggle Secrets. Requiere Contents: Read-only para el repositorio privado.")
os.environ["COMFY_URL"] = BASE
os.environ["VSA_OUTPUT_DIR"] = str(WORKER_OUTPUT)
os.environ.setdefault("VSA_OUTPUT_BUCKET", "video-renders")

REPO = "sogonzalezc90-wq/video-studio-ai"
API_HEADERS = {"Authorization": "Bearer " + GITHUB_TOKEN, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
commit_request = urllib.request.Request(f"https://api.github.com/repos/{REPO}/commits/main", headers=API_HEADERS)
with urllib.request.urlopen(commit_request, timeout=30) as response:
    REVISION = json.loads(response.read().decode("utf-8"))["sha"]
worker_dir = PERSISTENT_WORK / "video_studio_worker"
worker_dir.mkdir(parents=True, exist_ok=True)
if str(worker_dir) not in sys.path:
    sys.path.insert(0, str(worker_dir))
worker_path = worker_dir / "kaggle_supabase_worker.py"
audio_path = worker_dir / "audio_pipeline.py"

for filename, destination in (("kaggle_supabase_worker.py", worker_path), ("audio_pipeline.py", audio_path)):
    url = f"https://api.github.com/repos/{REPO}/contents/worker/{filename}?ref={REVISION}"
    headers = dict(API_HEADERS)
    headers["Accept"] = "application/vnd.github.raw"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=120) as response:
        content = response.read()
    if len(content) < 1000:
        raise RuntimeError(f"GitHub devolvió un archivo vacío/incompleto: {filename}")
    destination.write_bytes(content)
    py_compile.compile(str(destination), doraise=True)
    print(f"Descarga y compilación correctas: worker/{filename} ({len(content)} bytes)")
worker_source = worker_path.read_text(encoding="utf-8")
if "response.status_code" not in worker_source or "response.status}" in worker_source:
    raise RuntimeError("La versión descargada no supera la validación de response.status_code.")
if "from audio_pipeline import build_audio_track" not in worker_source:
    raise RuntimeError("El worker descargado no coincide con el módulo de audio esperado.")
if not requests.get(BASE + "/system_stats", timeout=10).ok:
    raise RuntimeError("ComfyUI no responde; no se iniciará el worker.")
print("Revisión GitHub:", REVISION)
print("Carpeta de salida:", WORKER_OUTPUT)
print("Supabase y GitHub Secrets leídos sin mostrar sus valores.")
print("Iniciando worker. Mantén esta sesión Kaggle activa para procesar trabajos.")
runpy.run_path(str(worker_path), run_name="__main__")
```

