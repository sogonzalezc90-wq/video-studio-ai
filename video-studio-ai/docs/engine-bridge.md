# VIDEO STUDIO AI — puente de trabajos Supabase ↔ Kaggle Wan 2.2

## Estado de integración
Esta rama prepara el contrato de la cola; no habilita generación todavía y no cambia `main` ni producción.

Flujo previsto:
1. La sesión Supabase del usuario autoriza a Pages Function a insertar un trabajo en `video_jobs`.
2. La fila conserva prompt, duración, tamaño de segmento y progreso. La duración admitida es 15–1200 segundos; los segmentos son de 15 o 30 segundos (hasta 80 segmentos de 15 s para 20 min).
3. El notebook Kaggle, iniciado por el usuario y mientras su sesión GPU siga activa, consulta `claim_next_video_job()` con una clave `service_role) guardada como Kaggle Secret. La función reclama una fila atómicamente usando `FOR UPDATE SKIP LOCKED`.
4. El worker procesa los segmentos con ComfyUI/Wan 2.2, los une con FFmpeg, sube el MP4 al bucket privado y actualiza estado/progreso.
5. La web consulta únicamente los trabajos propios del usuario y muestra estado y enlace de salida autorizado.

## Requisitos de secretos (nunca ponerlos en el navegador ni en Git)
- Cloudflare Pages: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (la API valida la sesión del usuario).
- Kaggle Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY). La clave service_role solo vive en el entorno privado del notebook.
- Bucket privado para resultados: definir nombre y políticas antes de activar la subida.

## Instalación pendiente
1. Revisar compatibilidad del tipo de `projects.id` antes de añadir FK (por eso `project_id` queda inicialmente sin FK).
2. Ejecutar `supabase/migrations/202611190001_video_jobs.sql` en Supabase SQL Editor.
3. Confirmar que la clave service_role se puede guardar en Kaggle Secrets y no está expuesta en el notebook.
4. Implementar endpoints Pages para crear/listar trabajos y el worker Kaggle para reclamar, renderizar, subir y completar.
5. Probar con un único clip corto antes de habilitar duraciones largas.

## Restricción operativa importante
Kaggle no es un servidor persistente: la cola solo se procesa mientras el notebook GPU está iniciado y activo. No se debe mostrar la generación como disponible si el worker no está conectado. No se garantiza que una sesión gratuita procese 20 minutos en una sola ejecución; se requieren reintentos, checkpoints y posiblemente varias sesiones.

## Validación de duración
- 15 s: 1 × 15 s
- 30 s: 1 × 30 s
- 60 s: 2 × 30 s
- 1200 s: 40 × 30 s o 80 × 15 s

La fila de trabajo no demuestra que el render esté terminado: solo se marca `completed` después de verificar el MP4 final (duración, contenedor y tamaño no nulo).

## Estado técnico de esta entrega (día 3)
- La API toma URL y clave pública del mismo proyecto Supabase que el navegador ya usa; no requiere un segundo proyecto ni otra página de prueba.
- El endpoint usa el JWT de la sesión para crear y listar trabajos bajo RLS.
- El worker incluye reclamación atómica, heartbeat, recuperación de trabajos abandonados, reintentos limitados, reanudación de fragmentos ya escritos y subida privada del MP4.
- El ensamblaje recorta el resultado a la duración solicitada y valida la duración final con FFprobe.
- La interfaz presenta estado, progreso y enlace firmado al MP4 terminado.
- GitHub Actions validó JavaScript, Python, JSON del notebook y coincidencia exacta entre el worker del repositorio y el incrustado en Kaggle. La ejecución del 19 nov 2026 terminó correctamente.

## Límites que siguen abiertos
La inferencia Wan actualmente usa fragmentos internos de 49 fotogramas a 24 fps (~2,04 s), porque esa es la configuración ya comprobada en la T4. Para 20 minutos esto implica aproximadamente 589 inferencias, agrupadas para producir la duración final. Esto es técnicamente costoso y no demuestra que una sesión gratuita Kaggle pueda completar un trabajo de 20 minutos. Se necesita prueba end-to-end y checkpoint persistente entre sesiones para afirmar esa capacidad.
El worker todavía no genera voces, diálogos, música ni efectos de sonido. El MP4 producido por esta versión es video sin audio.

## Segunda fase: secciones de producción
El worker ahora itera explícitamente sobre las secciones de 15 o 30 segundos solicitadas por la web. Dentro de cada sección genera subclips Wan de ~2,04 s para ajustarse a la T4, aplica variación de encuadre/cámara entre subclips, actualiza el contador al completar cada sección y ensambla el MP4 recortado a la duración solicitada (validación de duración con tolerancia de 0,25 s). Un fallo individual no detiene el bucle del worker; ComfyUI se verifica antes de reclamar trabajos.

Esto es una primera estructura de montaje por secciones, no todavía un guion visual inteligente: el prompt completo sigue siendo la instrucción base para todas las secciones. La continuidad de personajes y la progresión narrativa no están garantizadas. El audio sigue sin implementarse; no se debe presentar esta versión como generación audiovisual completa.


## Integración de audio (20 nov 2026)
- El worker importa `worker/audio_pipeline.py` y añade audio al MP4 después de ensamblar el video.
- Voz neuronal: Piper TTS 1.8.0 con modelo mexicano `es_MX-claude-high`, descargado desde la revisión fija `rhasspy/piper-voices@v1.0.0`. El modelo declara español de México, calidad alta, 22.05 kHz; su ficha atribuye Apache 2.0 al dataset. El paquete de ejecución Piper TTS está bajo GPL-3.0-or-later; la voz se sintetiza localmente en Kaggle, sin API de pago.
- Diálogos: únicamente se sintetizan fragmentos entre comillas presentes en el prompt. No se inventan conversaciones ni se pronuncian instrucciones de producción. Esta primera integración usa una voz masculina; todavía no asigna timbres distintos por personaje ni sincroniza labios.
- Música y ambiente: se genera una cama sonora original mediante filtros de FFmpeg (tonos musicales y ruido filtrado según palabras clave como lluvia, viento, motor o ciudad). No se descargan pistas comerciales ni efectos externos.
- Mezcla: el WAV se mezcla con el video mediante AAC a 192 kb/s y se comprueba que el MP4 contenga una pista de audio.
- Límites: los efectos son una primera síntesis procedural, no grabaciones realistas ni un modelo generativo de música. La clasificación ambiental es por palabras clave globales del prompt, no por análisis de cada escena. La sincronización de diálogo es aproximada por puntos equidistantes, no por timecodes de guion.
- El notebook descarga worker y módulo de audio desde un commit fijado para evitar que cambien durante una sesión. La clave `service_role` permanece en Kaggle Secrets.


## Integración audiovisual por escenas (20 nov 2026 — ampliación)
- El módulo `worker/audio_pipeline.py` divide el prompt por encabezados de escena (`ESCENA 1`, `INT.`, `EXT.`), párrafos o grupos de oraciones. Distribuye el tiempo solicitado entre las escenas y crea un manifiesto `audio_scene_manifest.json` con inicio, duración, estado de ánimo, ambiente, efectos y diálogos.
- Reparto de voces de la historia de los hermanos: Kiyoshima usa Piper `es_MX-claude-high` con variante más grave; Kashymoto usa `es_MX-ald-medium`; Keriko usa Claude con variante de tono más agudo. La tercera es una modificación de tono de Claude, no un tercer modelo ni una identidad neuronal independiente. Los modelos se descargan desde `rhasspy/piper-voices@v1.0.0`. Claude es de calidad alta; Ald de calidad media. Ald declara dataset Unlicense y el repositorio de voces Piper indica MIT.
- Se aceptan líneas de guion atribuidas como `Kiyoshima: «... »`, `Kashymoto: «... »` o `Nombre dijo: «... »`. La voz se mantiene estable por personaje a lo largo de la película.
- Se añadió generación opcional de diálogos con Workers AI `@cf/meta/llama-3.2-1b-instruct`. Está DESACTIVADA por defecto y solo se invoca si existe binding `AI` y la variable `VSA_ENABLE_AI_DIALOGUE=true`. El modelo recibe el prompt, puede proponer hasta 18 intervenciones y el worker las coloca en la línea de tiempo. Si no está habilitada o falla, se usan únicamente los diálogos explícitos del guion.
- Control de coste: la documentación de Cloudflare indica una asignación gratuita de 10,000 Neurons/día en Workers Free; al agotarse, las solicitudes gratuitas dejan de procesarse. En Workers Paid el consumo que exceda la asignación gratuita puede generar cargos. Por eso la función no se activa automáticamente y debe permanecer deshabilitada hasta confirmar que la cuenta está en Workers Free.
- Música: se sintetiza una cama instrumental original por escena con motivos armónicos distintos para acción, suspenso, tristeza, calidez o neutralidad. No es música comercial ni una composición de un modelo musical generativo.
- Ambientes: lluvia, viento, bosque, ciudad, taller, pista/carrera, interiores y noche se sintetizan por escena mediante fuentes de audio FFmpeg.
- Efectos: motor, pasos, puerta, impacto, herramientas y público se sintetizan por escena. Son efectos procedurales, no grabaciones fotorrealistas ni una biblioteca de Foley.
- La mezcla final aplica limitador y normalización EBU R128, exporta WAV estéreo 48 kHz, lo incorpora al MP4 como AAC y verifica que exista la pista. El manifiesto de escenas se conserva en el directorio temporal de trabajo.
- Límites honestos: los diálogos IA son opcionales y no están habilitados por defecto; el clasificador de ambientes/efectos es por palabras clave y no una comprensión visual real de cada fotograma; la ubicación de diálogos es aproximada dentro de la escena, no sincronización labial. La calidad perceptual y el tiempo de procesamiento aún requieren una prueba real en Kaggle con voces y FFmpeg.
