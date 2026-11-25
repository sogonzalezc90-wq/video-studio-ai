"""VIDEO STUDIO AI GPU queue worker.

Run only inside an active Kaggle Linux GPU notebook after starting ComfyUI.
Secrets required in Kaggle Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
This worker deliberately does not run a web server or expose the service key.
"""
import os, time, json, uuid, pathlib, subprocess, requests, shutil, math, threading, mimetypes, urllib.parse, re, hashlib
from audio_pipeline import build_audio_track

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
COMFY_URL = os.environ.get("COMFY_URL", "http://127.0.0.1:8188")
OUTPUT_DIR = pathlib.Path(os.environ.get("VSA_OUTPUT_DIR", "/kaggle/working/video_studio_jobs"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
BUCKET = os.environ.get("VSA_OUTPUT_BUCKET", "video-renders")
FPS = 24
# 49 frames is the already validated short Wan 2.2 configuration (~2.04 s).
CHUNK_FRAMES = 49
CHUNK_SECONDS = CHUNK_FRAMES / FPS
HTTP = requests.Session()
HTTP.headers.update({
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
})

def sb(method, path, **kwargs):
    response = HTTP.request(method, SUPABASE_URL + path, timeout=kwargs.pop("timeout", 120), **kwargs)
    if not response.ok:
        raise RuntimeError(f"Supabase {method} {path} failed ({response.status_code}): {response.text[:2000]}")
    return response

def update_job(job_id, **fields):
    fields["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    sb("PATCH", f"/rest/v1/video_jobs?id=eq.{job_id}",
       headers={"Content-Type":"application/json","Prefer":"return=minimal"},
       json=fields)

class JobCancelled(Exception):
    """Raised when the owner cancels a queued or running render."""

def job_cancelled(job_id):
    response = sb("GET", f"/rest/v1/video_jobs?id=eq.{job_id}&select=status")
    rows = response.json()
    return bool(rows and rows[0].get("status") in ("cancelling", "cancelled"))

def ensure_not_cancelled(job_id):
    if job_cancelled(job_id):
        raise JobCancelled(f"Trabajo {job_id} cancelado por el usuario.")

def claim_job():
    r = sb("POST", "/rest/v1/rpc/claim_next_video_job",
           headers={"Content-Type":"application/json"}, json={})
    data = r.json()
    return data[0] if isinstance(data, list) and data else None

def comfy_workflow(prompt, seed, prefix, start_image_name, steps=16):
    """Build a Wan 2.2 image-to-video workflow; a real start image is mandatory."""
    if not start_image_name:
        raise ValueError("Wan 2.2 I2V requiere una imagen inicial de referencia.")
    workflow = {
      "1":{"class_type":"UNETLoader","inputs":{"unet_name":"wan2.2_ti2v_5B_fp16.safetensors","weight_dtype":"default"}},
      "2":{"class_type":"ModelSamplingSD3","inputs":{"model":["1",0],"shift":8}},
      "4":{"class_type":"CLIPLoader","inputs":{"clip_name":"umt5_xxl_fp8_e4m3fn_scaled.safetensors","type":"wan","device":"default"}},
      "5":{"class_type":"VAELoader","inputs":{"vae_name":"wan2.2_vae.safetensors"}},
      "6":{"class_type":"CLIPTextEncode","inputs":{"text":prompt,"clip":["4",0]}},
      "7":{"class_type":"CLIPTextEncode","inputs":{"text":"low quality, blurry, distorted anatomy, unstable face, identity drift, changing clothes, extra limbs, flicker, artifacts, text, watermark, duplicated people, inconsistent vehicle, scene blending","clip":["4",0]}},
      "55":{"class_type":"Wan22ImageToVideoLatent","inputs":{"width":640,"height":352,"length":CHUNK_FRAMES,"batch_size":1,"vae":["5",0],"start_image":["56",0]}},
      "56":{"class_type":"LoadImage","inputs":{"image":start_image_name}},
      "3":{"class_type":"KSampler","inputs":{"model":["2",0],"positive":["6",0],"negative":["7",0],"latent_image":["55",0],"seed":seed,"steps":int(steps),"cfg":5,"sampler_name":"uni_pc","scheduler":"simple","denoise":1}},
      "8":{"class_type":"VAEDecode","inputs":{"samples":["3",0],"vae":["5",0]}},
      "57":{"class_type":"CreateVideo","inputs":{"images":["8",0],"fps":FPS}},
      "58":{"class_type":"SaveVideo","inputs":{"video":["57",0],"filename_prefix":prefix,"format":"auto","format.codec":"auto"}}
    }
    return workflow


def render_chunk(prompt, seed, job_dir, index, start_image, steps=16):
    prefix=f"VSA_jobs/{job_dir.name}/chunk_{index:04d}"
    if start_image is None or not pathlib.Path(start_image).is_file():
        raise FileNotFoundError(f"No existe la imagen maestra para el clip {index}.")
    with pathlib.Path(start_image).open("rb") as image_stream:
        upload = requests.post(
            COMFY_URL + "/upload/image",
            files={"image": (pathlib.Path(start_image).name, image_stream, mimetypes.guess_type(str(start_image))[0] or "image/jpeg")},
            data={"overwrite": "true", "type": "input"},
            timeout=180
        )
    if not upload.ok:
        raise RuntimeError("ComfyUI no pudo recibir la imagen inicial: " + upload.text[:2000])
    start_image_name = upload.json().get("name")
    if not start_image_name:
        raise RuntimeError("ComfyUI no devolvió el nombre de la imagen cargada.")
    submitted=requests.post(COMFY_URL+"/prompt",
       json={"prompt":comfy_workflow(prompt, seed, prefix, start_image_name, steps),"client_id":str(uuid.uuid4())},timeout=120)
    if not submitted.ok:
        raise RuntimeError("ComfyUI rechazó el workflow I2V: "+submitted.text[:3000])
    prompt_id=submitted.json().get("prompt_id")
    if not prompt_id:
        raise RuntimeError("ComfyUI no devolvió prompt_id")
    deadline=time.time()+3600
    while time.time()<deadline:
        if job_cancelled(job_dir.name):
            try:
                requests.post(COMFY_URL+"/interrupt",timeout=15)
            finally:
                raise JobCancelled(f"Trabajo {job_dir.name} cancelado durante la generación Wan 2.2.")
        h=requests.get(f"{COMFY_URL}/history/{prompt_id}",timeout=30)
        if h.ok:
            rec=h.json().get(prompt_id)
            if rec:
                status=rec.get("status",{})
                if status.get("status_str")=="error":
                    raise RuntimeError("ComfyUI error: "+json.dumps(status.get("messages",[]))[-4000:])
                if status.get("completed") and rec.get("outputs"):
                    files=[]
                    for out in rec["outputs"].values():
                        if isinstance(out,dict):
                            for k in ("videos","images","gifs"):
                                files += [x for x in out.get(k,[]) if isinstance(x,dict) and x.get("filename")]
                    item=next((x for x in files if pathlib.Path(x["filename"]).suffix.lower()==".mp4"),None)
                    if not item:
                        raise RuntimeError("SaveVideo terminó sin producir un MP4")
                    v=requests.get(COMFY_URL+"/view",params={"filename":item["filename"],"subfolder":item.get("subfolder",""),"type":item.get("type","output")},timeout=600)
                    v.raise_for_status()
                    path=job_dir/f"chunk_{index:04d}.mp4"
                    path.write_bytes(v.content)
                    if path.stat().st_size<100_000:
                        raise RuntimeError("El clip generado es inesperadamente pequeño")
                    probe = subprocess.run([
                        "ffprobe","-v","error","-select_streams","v:0",
                        "-show_entries","stream=width,height:format=duration",
                        "-of","json",str(path)
                    ],check=True,capture_output=True,text=True)
                    clip_info = json.loads(probe.stdout)
                    video_stream = next((item for item in clip_info.get("streams",[]) if item.get("width")),None)
                    clip_duration = float(clip_info.get("format",{}).get("duration") or 0)
                    if not video_stream or video_stream["width"] < 640 or video_stream["height"] < 352:
                        raise RuntimeError(f"El clip Wan {index} no conserva la resolución mínima 640x352.")
                    if abs(clip_duration-CHUNK_SECONDS) > 0.35:
                        raise RuntimeError(f"El clip Wan {index} dura {clip_duration:.2f}s; se esperaban {CHUNK_SECONDS:.2f}s.")
                    return path
        time.sleep(10)
    raise TimeoutError(f"El clip Wan {index} superó 60 minutos")


def extract_last_frame(video_path, frame_path):
    """Extract and preserve the final decoded frame for the next I2V clip."""
    subprocess.run([
        "ffmpeg","-y","-sseof","-0.12","-i",str(video_path),
        "-frames:v","1","-q:v","2",str(frame_path)
    ],check=True,capture_output=True,text=True)
    if not frame_path.is_file() or frame_path.stat().st_size < 1024:
        raise RuntimeError(f"No se pudo extraer el fotograma final de {video_path.name}")
    return frame_path


def _scene_timeline(prompt, duration):
    """Split screenplay headings/paragraphs into weighted, ordered scene intervals."""
    text = (prompt or "").strip()
    heading = re.compile(
        r"(?im)^\s*(?:(?:\d+\.\s*)?(?:ESCENA|SCENE)\s*\d*\s*[:.\-—].*|"
        r"(?:TOMA|TAKE)\s+\d+(?:\.\d+)?\s*[—:.-]?.*|(?:INT\.|EXT\.|INT/EXT\.)\s+.*)$"
    )
    matches = list(heading.finditer(text))
    blocks = []
    if matches:
        if text[:matches[0].start()].strip():
            blocks.append(text[:matches[0].start()].strip())
        for i, match in enumerate(matches):
            end = matches[i+1].start() if i+1 < len(matches) else len(text)
            block = text[match.start():end].strip()
            if block:
                blocks.append(block)
    else:
        blocks = [part.strip() for part in re.split(r"\n\s*\n+", text) if part.strip()]
    if not blocks:
        blocks = [text]
    if len(blocks) > 80:
        blocks = blocks[:79] + [" ".join(blocks[79:])]
    weights = [max(1, len(re.findall(r"\w+", block))) for block in blocks]
    total = float(sum(weights))
    scenes, cursor = [], 0.0
    for index, (block, weight) in enumerate(zip(blocks, weights)):
        span = duration - cursor if index == len(blocks)-1 else duration * weight / total
        scenes.append({"index":index,"start":cursor,"end":cursor+span,"text":block})
        cursor += span
    return scenes


def _scene_for_time(scenes, seconds):
    for scene in scenes:
        if seconds < scene["end"] or scene is scenes[-1]:
            return scene
    return scenes[-1]


def fetch_project_reference_media(job, job_dir):
    """Download saved project images and extract keyframes from saved project videos."""
    project_id = job.get("project_id")
    if not project_id:
        return [], {}
    response = sb("GET", "/rest/v1/project_assets?project_id=eq." + str(project_id)
                  + "&user_id=eq." + str(job["user_id"])
                  + "&select=storage_path,mime_type,file_name,created_at&order=created_at.asc")
    references = []
    reference_paths_by_storage = {}
    for index, row in enumerate(response.json()):
        storage_path = str(row.get("storage_path") or "")
        mime = str(row.get("mime_type") or "").lower()
        if not storage_path or not (mime.startswith("image/") or mime.startswith("video/")):
            continue
        encoded = "/".join(urllib.parse.quote(part, safe="") for part in storage_path.split("/"))
        url = f"{SUPABASE_URL}/storage/v1/object/video-assets/{encoded}"
        downloaded = HTTP.get(url, timeout=600)
        if not downloaded.ok:
            raise RuntimeError(f"Descarga de referencia {index+1} falló ({downloaded.status_code}): {downloaded.text[:500]}")
        suffix = pathlib.Path(storage_path).suffix.lower()
        if mime.startswith("image/"):
            if suffix not in (".png",".jpg",".jpeg",".webp",".bmp"):
                suffix = ".jpg"
            target = job_dir / f"reference_image_{index+1:03d}{suffix}"
            target.write_bytes(downloaded.content)
            if target.stat().st_size < 1024:
                raise RuntimeError(f"La imagen de referencia {index+1} está incompleta.")
            references.append(target)
            reference_paths_by_storage[storage_path] = target
            continue
        if suffix not in (".mp4",".mov",".webm",".m4v"):
            raise RuntimeError(f"Formato de video no compatible para referencia: {suffix or mime}")
        source_video = job_dir / f"project_video_{index+1:03d}{suffix}"
        source_video.write_bytes(downloaded.content)
        probe = subprocess.run([
            "ffprobe","-v","error","-show_entries","format=duration",
            "-of","default=noprint_wrappers=1:nokey=1",str(source_video)
        ],check=True,capture_output=True,text=True)
        video_duration = max(0.1,float(probe.stdout.strip()))
        for frame_no, fraction in enumerate((0.12,0.5,0.88),start=1):
            frame = job_dir / f"reference_video_{index+1:03d}_{frame_no:02d}.jpg"
            timestamp = min(max(0.0,video_duration*fraction),max(0.0,video_duration-0.08))
            subprocess.run([
                "ffmpeg","-y","-ss",str(timestamp),"-i",str(source_video),
                "-frames:v","1","-q:v","2",str(frame)
            ],check=True,capture_output=True,text=True)
            if frame.is_file() and frame.stat().st_size > 1024:
                references.append(frame)
    return references



def fetch_segment_master_images(job, job_dir):
    """Fetch the exact AI-generated still assigned to every production-manifest segment."""
    manifest = (job.get("payload") or {}).get("production_manifest") or {}
    segments = manifest.get("segments") or []
    if not segments:
        raise RuntimeError(
            "El trabajo no contiene un manifiesto cinematográfico. "
            "Prepara la historia en Estudio de producción y genera los fotogramas maestros."
        )
    masters = {}
    ordered = sorted(segments, key=lambda item: int(item.get("order") or 0))
    for index, segment in enumerate(ordered, start=1):
        asset = (segment.get("assets") or {}).get("image") or {}
        storage_path = str(asset.get("storagePath") or "")
        if not storage_path:
            raise RuntimeError(
                f"Falta la imagen maestra del segmento {segment.get('id') or index}. "
                "No se sustituirá por una imagen genérica."
            )
        target = None
        if target is None:
            encoded = "/".join(urllib.parse.quote(part, safe="") for part in storage_path.split("/"))
            url = f"{SUPABASE_URL}/storage/v1/object/video-assets/{encoded}"
            response = HTTP.get(url, timeout=600)
            if not response.ok:
                raise RuntimeError(
                    f"No se pudo descargar la imagen maestra del segmento {index} "
                    f"({response.status_code}): {response.text[:500]}"
                )
            suffix = pathlib.Path(storage_path).suffix.lower()
            if suffix not in (".png", ".jpg", ".jpeg", ".webp"):
                raise RuntimeError(f"Formato de imagen maestra no compatible en segmento {index}: {suffix}")
            target = job_dir / f"segment_master_source_{index:04d}{suffix}"
            target.write_bytes(response.content)
        if not pathlib.Path(target).is_file() or pathlib.Path(target).stat().st_size < 1024:
            raise RuntimeError(f"La imagen maestra del segmento {index} está vacía o incompleta.")
        try:
            from PIL import Image, ImageStat
            with Image.open(target) as source_image:
                source_image.verify()
            with Image.open(target) as source_image:
                width, height = source_image.size
                variance = sum(ImageStat.Stat(source_image.convert("RGB")).stddev) / 3
            if width < 640 or height < 352 or variance < 4:
                raise RuntimeError(
                    f"La imagen maestra del segmento {index} no supera el control mínimo: "
                    f"{width}x{height}, variación {variance:.1f}."
                )
        except RuntimeError:
            raise
        except Exception as error:
            raise RuntimeError(f"La imagen maestra del segmento {index} está dañada: {error}") from error
        masters[index] = pathlib.Path(target)
    expected = int(job.get("total_segments") or 0)
    if len(masters) != expected:
        raise RuntimeError(f"El manifiesto contiene {len(masters)} imágenes maestras; se requieren {expected}.")
    return masters


def render_still_motion(image_path, duration, output_path, shot_index=0, resolution="720p"):
    """Apply Ken Burns zoom/pan camera motion to a still image using FFmpeg."""
    # Keep intermediate chunks identical to the 640x352 Wan output; final assembly upscales once.
    width, height = 640, 352
    motions = [
        ("min(zoom+0.00065,1.16)", "iw/2-(iw/zoom/2)+sin(on/52)*24", "ih/2-(ih/zoom/2)"),
        ("max(1.0,zoom-0.00055)", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)+cos(on/48)*18"),
        ("1.08", "iw/2-(iw/zoom/2)+sin(on/65)*42", "ih/2-(ih/zoom/2)"),
        ("1.08", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)+sin(on/58)*30"),
    ]
    z, x, y = motions[shot_index % len(motions)]
    vf = (f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},"
          f"zoompan=z='{z}':x='{x}':y='{y}':d=1:s={width}x{height}:fps={FPS},"
          f"trim=duration={duration},setpts=PTS-STARTPTS,format=yuv420p")
    subprocess.run(["ffmpeg","-y","-loop","1","-i",str(image_path),"-vf",vf,"-t",str(duration),
                    "-an","-r",str(FPS),"-c:v","libx264","-preset","veryfast",
                    "-pix_fmt","yuv420p",str(output_path)],check=True,capture_output=True,text=True)
    if not output_path.exists() or output_path.stat().st_size < 50000:
        raise RuntimeError("FFmpeg no produjo un clip animado válido desde la imagen.")
    return output_path


def _save_continuity_reference(job, frame_path, scene_number, segment_number):
    """Persist a master frame in the private render bucket and return its storage path."""
    suffix = pathlib.Path(frame_path).suffix.lower()
    if suffix not in (".png", ".jpg", ".jpeg", ".webp"):
        suffix = ".jpg"
    object_path = f"{job['user_id']}/{job['id']}/continuity/segment_{segment_number:03d}_scene_{scene_number:03d}{suffix}"
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{object_path}"
    mime = "image/png" if suffix == ".png" else "image/webp" if suffix == ".webp" else "image/jpeg"
    with pathlib.Path(frame_path).open("rb") as stream:
        response = HTTP.put(url, data=stream, headers={"Content-Type":mime,"x-upsert":"true"}, timeout=180)
    if not response.ok:
        raise RuntimeError(f"No se pudo conservar la imagen maestra del segmento ({response.status_code}): {response.text[:500]}")
    return object_path


def make_video(job, job_dir):
    duration = int(job["duration_seconds"])
    segment = int(job["segment_seconds"])
    total_segments = int(job["total_segments"])
    prompt = job["prompt"]
    payload = job.get("payload") or {}
    profile = str(payload.get("production_profile") or "balanced")
    requested_resolution = str(payload.get("requested_resolution") or "720p")
    # Quality is configurable without exceeding the validated 640x352 Wan latent.
    steps = {"cinematic":20, "balanced":16, "light":12}.get(profile,16)
    # The browser has already conditioned each master still on selected project images/video frames.
    # Download only the exact per-segment masters required for I2V; do not redownload every project video.
    segment_masters = fetch_segment_master_images(job, job_dir)
    references = list(segment_masters.values())
    if not references:
        raise RuntimeError("No hay imágenes maestras de segmento disponibles para Wan 2.2.")
    production_manifest = payload.get("production_manifest") or {}
    manifest_segments = sorted(production_manifest.get("segments") or [],
                               key=lambda item: int(item.get("order") or 0))
    if len(manifest_segments) != total_segments:
        raise RuntimeError(f"El manifiesto tiene {len(manifest_segments)} segmentos; se requieren {total_segments}.")
    character_profiles = production_manifest.get("characters") or []
    character_bible = "\n".join(
        f"{item.get('name', 'Personaje')}: {item.get('description', '').strip()[:180]}"
        for item in character_profiles if item.get("name")
    )
    scenes = _scene_timeline(prompt, duration)
    total_chunks = math.ceil(duration / CHUNK_SECONDS)
    print("PROJECT REFERENCE FRAMES",len(references),"| STORY SCENES",len(scenes),
          "| WAN I2V CLIPS",total_chunks,"| PROFILE",profile,"| STEPS",steps)
    camera_shots = [
        "wide establishing shot with slow dolly-in and natural environmental movement",
        "medium tracking shot, subject moves with physically plausible body mechanics",
        "close-up with subtle controlled push-in, preserve exact facial identity",
        "side tracking shot with realistic parallax and consistent background geometry",
        "low-angle follow shot, natural motion blur and stable subject proportions",
        "over-the-shoulder reaction shot, preserve wardrobe and screen direction",
        "wide dynamic shot showing the same established location without blending sets",
        "medium close-up, gentle camera arc, stable eyes, face, hair and clothing",
    ]
    files = []
    previous_frame = None
    previous_scene_index = None
    continuity_manifest = []
    global_chunk = 0
    for segment_index in range(total_segments):
        ensure_not_cancelled(job["id"])
        first_chunk = round(segment_index * total_chunks / total_segments)
        last_chunk = round((segment_index + 1) * total_chunks / total_segments)
        for local_index in range(last_chunk-first_chunk):
            ensure_not_cancelled(job["id"])
            global_chunk += 1
            chunk_start = (global_chunk-1) * CHUNK_SECONDS
            scene = _scene_for_time(scenes, chunk_start)
            scene_index = int(scene["index"])
            # Use the shot grammar already authored for this segment instead of cycling blindly.
            segment_record = manifest_segments[segment_index]
            segment_visual_prompt = str(segment_record.get("visualPrompt") or "")
            visual_lower = segment_visual_prompt.lower()
            if "close-up" in visual_lower or "primer plano" in visual_lower:
                shot = "close-up, subtle controlled push-in, stable facial identity and eye geometry"
            elif "tracking" in visual_lower or "travelling" in visual_lower or "seguimiento" in visual_lower:
                shot = "continuous tracking camera, physically plausible subject motion and natural parallax"
            elif "wide" in visual_lower or "plano general" in visual_lower:
                shot = "wide establishing composition, slow dolly or pan that preserves the established location"
            elif "over-the-shoulder" in visual_lower or "sobre el hombro" in visual_lower:
                shot = "over-the-shoulder reaction shot, maintain screen direction and character positions"
            elif "low-angle" in visual_lower or "contrapicado" in visual_lower:
                shot = "low-angle follow shot, stable body proportions and natural motion blur"
            else:
                shot = camera_shots[(segment_index + scene_index) % len(camera_shots)]
            # Each user-visible segment starts from its own generated master still.
            # Further Wan clips within that segment chain the exact preceding final frame.
            if local_index == 0:
                start_image = segment_masters[segment_index + 1]
            else:
                start_image = previous_frame
            chunk_prompt = (
                f"SEGMENT MASTER IMAGE PROMPT: {segment_visual_prompt[:1800]}\n"
                f"CHARACTER IDENTITY, FACE, BODY AND WARDROBE BIBLE: {character_bible[:2600]}\n"
                f"SCREENPLAY SCENE {scene_index+1}: {scene['text'][:2600]}\\n"
                f"OVERALL STORY AND VISUAL BIBLE: {prompt[:5000]}\\n"
                f"SHOT {global_chunk}: {shot}.\\n"
                "Animate the supplied first frame; do not redesign or replace the established subjects. "
                "Maintain identical character identity, face shape, eye spacing, hairstyle, age, body proportions, "
                "wardrobe colors, accessories, vehicle make and silhouette, location layout, props, weather, "
                "time of day, lighting direction and color grade. Preserve screen direction and spatial continuity. "
                "Show purposeful real physical movement, believable contact, wheel rotation when a vehicle moves, "
                "natural walking/running mechanics, cloth response and environmental motion. "
                "Camera movement must be smooth and motivated by the action. No frozen subjects, morphing, "
                "disappearing characters, duplicated limbs, changing costumes, blended locations or sudden cuts."
            )
            chunk_path = job_dir / f"chunk_{global_chunk:04d}.mp4"
            seed = int(uuid.uuid5(uuid.NAMESPACE_URL, f"{job['id']}:{global_chunk}").int % (2**32))
            chunk_path = render_chunk(chunk_prompt, seed, job_dir, global_chunk,
                                      start_image=start_image, steps=steps)
            next_frame = job_dir / f"continuity_{global_chunk:04d}.jpg"
            extract_last_frame(chunk_path, next_frame)
            # Save one immutable visual master per user-visible segment.
            if local_index == 0:
                master = job_dir / f"segment_master_{segment_index+1:03d}{segment_masters[segment_index+1].suffix.lower()}"
                shutil.copy2(segment_masters[segment_index+1], master)
                storage_path = _save_continuity_reference(job, master, scene_index+1, segment_index+1)
                continuity_manifest.append({
                    "segment":segment_index+1,"segment_id":segment_record.get("id"),
                    "scene":scene_index+1,"source_frame":str(master.name),
                    "source_asset_path":str((segment_record.get("assets") or {}).get("image",{}).get("storagePath") or ""),
                    "storage_path":storage_path,"start_seconds":round(chunk_start,3)
                })
                payload["continuity_reference_manifest"] = continuity_manifest
                update_job(job["id"], payload=payload)
            previous_frame = next_frame
            previous_scene_index = scene_index
            files.append(chunk_path)
            elapsed = min(duration, global_chunk*CHUNK_SECONDS)
            update_job(job["id"],progress=min(90,int(elapsed/duration*90)),
                       heartbeat_at=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()))
        update_job(job["id"],completed_segments=segment_index+1,
                   progress=min(90,int(min(duration,(segment_index+1)*segment)/duration*90)),
                   heartbeat_at=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()))
    if global_chunk != total_chunks or len(files) != total_chunks:
        raise RuntimeError(f"Plan de clips incompleto: esperados {total_chunks}, generados {global_chunk}.")
    ensure_not_cancelled(job["id"])
    concat = job_dir / "concat.txt"
    concat.write_text("".join(f"file '{p.as_posix()}'\n" for p in files),encoding="utf-8")
    output = job_dir / "VIDEO_STUDIO_AI.mp4"
    target_w,target_h = (1920,1080) if requested_resolution=="1080p" else (1280,720)
    # Wan's latent remains 640x352; use high-quality Lanczos upscaling only once at final assembly.
    final_vf = (f"scale={target_w}:{target_h}:force_original_aspect_ratio=increase:flags=lanczos,"
                f"crop={target_w}:{target_h},unsharp=5:5:0.35:3:3:0.12,setsar=1,format=yuv420p")
    subprocess.run([
        "ffmpeg","-y","-f","concat","-safe","0","-i",str(concat),
        "-t",str(duration),"-an","-vf",final_vf,"-r",str(FPS),
        "-c:v","libx264","-preset","medium","-crf","18","-pix_fmt","yuv420p",
        "-movflags","+faststart",str(output)
    ],check=True,capture_output=True,text=True)
    video_probe = subprocess.run([
        "ffprobe","-v","error","-select_streams","v:0",
        "-show_entries","stream=codec_name,width,height,r_frame_rate:format=duration",
        "-of","json",str(output)
    ],check=True,capture_output=True,text=True)
    video_data = json.loads(video_probe.stdout)
    actual_duration = float(video_data["format"]["duration"])
    if abs(actual_duration-duration)>0.25:
        raise RuntimeError(f"Duración final incorrecta: solicitada {duration}s, obtenida {actual_duration:.2f}s")
    video_streams = video_data.get("streams",[])
    if not video_streams or int(video_streams[0].get("width",0)) != target_w or int(video_streams[0].get("height",0)) != target_h:
        raise RuntimeError("El MP4 final no alcanzó las dimensiones solicitadas.")
    ensure_not_cancelled(job["id"])
    audio_path = build_audio_track(
        prompt,duration,job_dir,payload.get("audio_script"),
        voice_choice=str(payload.get("voice") or "female")
    )
    muxed = job_dir / "VIDEO_STUDIO_AI_with_audio.mp4"
    subprocess.run([
        "ffmpeg","-y","-i",str(output),"-i",str(audio_path),
        "-map","0:v:0","-map","1:a:0","-c:v","copy",
        "-c:a","aac","-b:a","256k","-ar","48000",
        "-t",str(duration),"-movflags","+faststart",str(muxed)
    ],check=True,capture_output=True,text=True)
    final_probe = subprocess.run([
        "ffprobe","-v","error","-show_entries",
        "format=duration:stream=codec_type,codec_name,width,height,sample_rate,channels",
        "-of","json",str(muxed)
    ],check=True,capture_output=True,text=True)
    final_data = json.loads(final_probe.stdout)
    streams = final_data.get("streams",[])
    if not any(s.get("codec_type")=="video" for s in streams):
        raise RuntimeError("El MP4 final no contiene video.")
    if not any(s.get("codec_type")=="audio" and s.get("codec_name")=="aac" for s in streams):
        raise RuntimeError("El MP4 final no contiene una pista de audio AAC.")
    if abs(float(final_data["format"]["duration"])-duration)>0.25:
        raise RuntimeError("La duración del MP4 con audio no coincide con la solicitada.")
    output.unlink()
    muxed.rename(output)
    manifest_path = job_dir / "continuity_manifest.json"
    manifest_path.write_text(json.dumps(continuity_manifest,ensure_ascii=False,indent=2),encoding="utf-8")
    return output


def upload_output(job, output):
    object_path=f"{job['user_id']}/{job['id']}/VIDEO_STUDIO_AI.mp4"
    url=f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{object_path}"
    with output.open("rb") as stream:
        r=HTTP.put(url,data=stream,headers={"Content-Type":"video/mp4","x-upsert":"true"},timeout=1800)
    if not r.ok: raise RuntimeError(f"Supabase Storage upload failed ({r.status_code}): {r.text[:2000]}")
    return object_path

def process_job(job):
    job_dir=OUTPUT_DIR/str(job["id"])
    job_dir.mkdir(parents=True,exist_ok=True)
    stop_heartbeat=threading.Event()
    def heartbeat_loop():
        while not stop_heartbeat.wait(60):
            try:
                update_job(job["id"], heartbeat_at=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()))
            except Exception as heartbeat_error:
                print("Heartbeat warning:",heartbeat_error)
    heartbeat_thread=threading.Thread(target=heartbeat_loop,daemon=True)
    heartbeat_thread.start()
    try:
        ensure_not_cancelled(job["id"])
        # claim_next_video_job already atomically marked this job as processing.
        output=make_video(job,job_dir)
        ensure_not_cancelled(job["id"])
        update_job(job["id"],status="assembling",progress=95,heartbeat_at=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()))
        ensure_not_cancelled(job["id"])
        object_path=upload_output(job,output)
        ensure_not_cancelled(job["id"])
        update_job(job["id"],status="completed",progress=100,completed_segments=int(job["total_segments"]),output_path=object_path,error_message=None)
        print("JOB COMPLETED",job["id"],object_path)
    except JobCancelled as exc:
        try:
            update_job(job["id"], status="cancelled",
                       error_message="Proceso detenido por solicitud del usuario.")
        except Exception as ack_error:
            print("Cancellation acknowledgement warning:", ack_error)
        print("JOB CANCELLED", job["id"], str(exc))
        raise
    except Exception as exc:
        if job_cancelled(job["id"]):
            try:
                update_job(job["id"], status="cancelled",
                           error_message="Proceso detenido por solicitud del usuario.")
            except Exception as ack_error:
                print("Cancellation acknowledgement warning:", ack_error)
            print("JOB CANCELLED", job["id"])
            raise JobCancelled(str(exc))
        update_job(job["id"],status="failed",error_message=str(exc)[:4000])
        raise
    finally:
        stop_heartbeat.set()
        heartbeat_thread.join(timeout=2)

def check_comfy_ready():
    try:
        response=requests.get(COMFY_URL+"/system_stats",timeout=10)
        response.raise_for_status()
        return True
    except requests.RequestException as exc:
        raise RuntimeError(
            "ComfyUI no está disponible en "+COMFY_URL+
            ". Ejecuta primero las celdas de instalación, modelos y arranque."
        ) from exc

def run_worker(poll_seconds=15):
    check_comfy_ready()
    print("VIDEO STUDIO AI worker active. Queue polling every",poll_seconds,"seconds.")
    print("GPU worker only processes while this Kaggle session remains active.")
    while True:
        try:
            try:
                sb("POST", "/rest/v1/rpc/fail_exhausted_video_jobs",
                   headers={"Content-Type":"application/json"}, json={})
            except Exception as cleanup_error:
                print("Queue cleanup warning:",cleanup_error)
            job=claim_job()
            if not job:
                time.sleep(poll_seconds)
                continue
            print("CLAIMED JOB",job["id"],"duration",job["duration_seconds"],"seconds")
            try:
                process_job(job)
            except JobCancelled as cancelled:
                # Cancellation is an expected user action, not a rendering failure.
                print("JOB CANCELLED; worker remains active:",job["id"],str(cancelled)[:1000])
            except Exception as job_error:
                # A failed render must not terminate the long-running GPU queue.
                print("JOB FAILED; worker remains active:",job["id"],str(job_error)[:2000])
        except Exception as loop_error:
            print("Worker loop warning:",str(loop_error)[:2000])
            time.sleep(max(poll_seconds,30))

if __name__=="__main__":
    run_worker()
