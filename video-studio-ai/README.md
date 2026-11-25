# VIDEO STUDIO AI

Aplicación privada de generación audiovisual con Supabase, Cloudflare Pages y un trabajador GPU opcional en Kaggle. No integra pagos ni compra créditos.

## Capacidades integradas en esta rama

- Autenticación privada, biblioteca de proyectos y cola de trabajos en Supabase.
- Generación de video con Wan 2.2 TI2V-5B mediante ComfyUI.
- Entrada de texto, imágenes de referencia o ambas.
- Las imágenes adjuntas a una producción se guardan en el bucket privado `video-assets`, se descargan por el trabajador y se conectan al nodo `Wan22ImageToVideoLatent.start_image` para generar movimiento con IA.
- Perfil ligero: movimiento de cámara Ken Burns (paneo y zoom) sobre imágenes fijas mediante FFmpeg.
- Perfil equilibrado: combina video generado desde texto e imágenes de referencia animadas con Wan 2.2.
- Perfil cinematográfico: aumenta la proporción de tomas animadas desde imágenes de referencia.
- Instrucciones de cámara en los prompts de cada toma: seguimiento, acercamientos, planos generales, laterales y primeros planos.
- Música original sintetizada por escena, ambientes y efectos sonoros procedurales con FFmpeg.
- Diálogos explícitos mediante Piper en español de México. Los protagonistas reconocidos conservan su asignación de voz para mantener continuidad; la preferencia femenina/masculina se aplica a personajes adicionales. La opción «Sin voces» desactiva los diálogos hablados.
- Ensamblaje MP4 con audio AAC, salida seleccionable 720p/1080p y comprobación de duración con ffprobe.
- Notebook Kaggle descarga los archivos de la última revisión de `main` y añade la carpeta del trabajador a `sys.path`.

## Límites que deben tenerse presentes

- Los efectos y ambientes incluidos se sintetizan de forma procedural; no son grabaciones de campo ni una librería de efectos comerciales.
- La voz Piper es TTS local. No equivale a doblaje humano ni a clonación de voz.
- El movimiento de cámara Ken Burns desplaza/escala la imagen; el perfil Wan 2.2 sí intenta generar movimiento de escena desde la imagen inicial.
- La generación depende de que el notebook Kaggle esté activo y disponga de GPU. Una sesión gratuita puede detenerse por límites de tiempo o disponibilidad.
- Los fragmentos temporales están en el almacenamiento de trabajo de Kaggle. Si se reinicia la sesión, el trabajo puede necesitar repetirse; el checkpoint persistente de cada fragmento aún no está implementado.
- Un video de 20 minutos implica cientos de inferencias Wan 2.2 y no se puede garantizar que termine en una sola sesión gratuita.

## Configuración

### Cloudflare Pages
- Proyecto conectado al repositorio privado.
- Variables públicas de Supabase en Pages: `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
- El despliegue se inicia automáticamente al integrar cambios en `main`.

### Kaggle
Crear Secrets (sin incluirlos en el repositorio):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GITHUB_TOKEN` con Contents: Read-only para este repositorio privado.

Ejecutar el notebook `notebooks/VIDEO_STUDIO_AI_Wan22_Supabase_Worker.ipynb` en un entorno Linux Kaggle con GPU e Internet. Arrancar ComfyUI antes de iniciar la celda del trabajador.

## Validación

GitHub Actions valida sintaxis Python/JavaScript, estructura JSON del notebook y contratos básicos de audio, referencias y configuración. Esas pruebas no sustituyen una prueba real de render con ComfyUI, GPU Kaggle y Supabase.

## Seguridad

- No publicar `SUPABASE_SERVICE_ROLE_KEY`, tokens ni secretos en archivos públicos o en el navegador.
- Mantener privado el repositorio y el bucket de imágenes y renders.
- La aplicación no procesa pagos ni requiere créditos de proveedores externos.
