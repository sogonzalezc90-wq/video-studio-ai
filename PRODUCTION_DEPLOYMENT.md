# Despliegue de producción — VIDEO STUDIO AI

Esta guía corresponde a los archivos desplegados desde `main`. Cloudflare Pages usa `video-studio-ai/` como directorio raíz del proyecto y `public/` como salida.

## 1. GitHub y Cloudflare

- Rama de producción: `main`.
- Directorio raíz de Cloudflare Pages: `video-studio-ai`.
- Directorio de salida: `public`.
- La aplicación web y la API de producción están en `video-studio-ai/public/` y `video-studio-ai/functions/api/jobs.js`.
- El worker GPU y el módulo de audio están en `worker/`; Kaggle los descarga directamente del último commit de `main`.

No copies los archivos de la raíz del repositorio dentro de la aplicación de Cloudflare: son archivos históricos y no están dentro del directorio raíz configurado en Pages.

## 2. Supabase

Si ya existe el proyecto y las tablas de VIDEO STUDIO AI, abre y ejecuta una sola vez el archivo completo `supabase/VIDEO_STUDIO_AI_PRODUCTION_UPGRADE.sql` en Supabase SQL Editor. Es la unión íntegra de las dos migraciones nuevas; no ejecutes además las dos migraciones por separado.

Si prefieres aplicar el sistema de migraciones, ejecuta en este orden:
1. `supabase/migrations/202611230003_free_ai_quota.sql`
2. `supabase/migrations/202611230004_segment_master_assets.sql`

Las instrucciones son aditivas. No eliminan proyectos, imágenes, videos ni trabajos anteriores.

Si se trata de una instalación nueva, ejecuta primero `supabase/schema.sql` y `supabase/migrations/202611190001_video_jobs.sql`, y después el archivo completo de actualización.

## 3. Cloudflare

Conserva las variables de entorno existentes:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Conserva el binding de Workers AI llamado `AI`. El generador de imágenes utiliza FLUX.2 Klein 4B con hasta cuatro referencias de imagen. La aplicación reserva un máximo de 30 imágenes y 1 solicitud de voz por usuario y día.

**Costo cero:** la asignación gratuita de Workers AI es compartida por la cuenta. Mantén el plan Workers Free para que el exceso de cuota falle sin facturarse. Workers Paid puede cobrar el uso que supere la asignación gratuita. No habilites Workers Paid ni AI Gateway de pago. Deja `VSA_ENABLE_AI_DIALOGUE` sin configurar; los diálogos del guion se toman del manifiesto de producción.

## 4. Kaggle

Importa el notebook completo:

`notebooks/VIDEO_STUDIO_AI_Wan22_Supabase_Worker.ipynb`

Configura estos Kaggle Secrets, sin pegarlos en el código:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GITHUB_TOKEN` (Contents: Read-only para el repositorio privado)

Selecciona GPU NVIDIA e Internet y ejecuta todas las celdas en orden. La última celda descarga los dos módulos Python del último commit de `main` y arranca el trabajador. No descargues ni pegues manualmente fragmentos de los módulos.

La sesión Kaggle debe permanecer activa mientras procesa. Si se interrumpe, vuelve a ejecutar el notebook para recuperar la cola.

## 5. Flujo de producción por historia

1. Crea o selecciona el proyecto correcto en VIDEO STUDIO AI.
2. Guarda en ese proyecto imágenes y videos de referencia de personajes, vestuario, objetos y escenarios.
3. En Estudio de producción cinematográfica analiza el guion y prepara el manifiesto con la duración y tamaño de segmento elegidos.
4. Registra cada personaje y su ficha de apariencia permanente: edad aparente, rostro, cabello, complexión, vestuario y accesorios.
5. Asigna referencias de personajes, escenarios y objetos a las tomas correspondientes.
6. Genera los fotogramas maestros pendientes. Cada imagen se genera con hasta cuatro referencias reales del proyecto. Si la referencia es un video, el navegador extrae un fotograma correspondiente al tiempo relativo del segmento. El fotograma maestro se guarda en Supabase antes de animar.
7. Cuando todos los segmentos tengan su imagen maestra, envía el trabajo a Wan 2.2.
8. El worker descarga la imagen exacta de cada segmento, la anima con I2V, encadena los últimos fotogramas dentro del segmento, conserva el manifiesto de continuidad y mezcla el audio. Los diálogos respetan sus marcas de tiempo y los efectos detectados en el plan se colocan en el inicio temporal de su segmento.

El sistema rechaza el envío a Wan si falta una imagen maestra. Los fotogramas guardados no se repiten al reanudar. El límite interno de imágenes es 30 por día: una película de 20 minutos puede requerir varios días para completar sus imágenes maestras antes de animarse (80 imágenes si se usan segmentos de 15 segundos; 40 si se usan segmentos de 30 segundos).

## 6. Límites técnicos que se mantienen visibles

- Wan 2.2 genera en esta configuración a 640×352. 720p/1080p se obtiene por reescalado y no equivale a resolución neuronal nativa.
- El audio local usa dos voces base Piper en español latino, asignación estable y variación de tono. No son diez actores distintos.
- La música, ambientes y efectos se sintetizan proceduralmente con FFmpeg; no son grabaciones de campo ni una biblioteca profesional de efectos.
- La continuidad visual mejora con FLUX.2 multirreferencia, imágenes maestras por segmento y encadenamiento Wan I2V, pero los modelos generativos no garantizan identidad perfecta en todos los fotogramas.
- No se debe iniciar una película de 20 minutos hasta validar una producción corta completa con imagen, video, diálogo, ambiente, mezcla, subida y reproducción desde Supabase.
