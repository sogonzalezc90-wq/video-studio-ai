# Guía de primera prueba: Wan 2.2 en Kaggle (gratuito)

## Archivo del cuaderno

Abre el cuaderno `notebooks/wan22_kaggle_free.ipynb` desde el repositorio privado y descárgalo. En Kaggle, crea un Notebook nuevo y usa **File → Import Notebook** para cargar el archivo.

Repositorio: https://github.com/sogonzalezc90-wq/video-studio-ai/tree/codex/video-studio-ai-integral-fixes/video-studio-ai/notebooks

## Configuración de Kaggle

1. Inicia sesión en Kaggle y crea un Notebook privado.
2. En Settings, selecciona **Accelerator: GPU**. Si hay T4 disponible, se usará una sola GPU; no se suman las VRAM de dos tarjetas.
3. Habilita Internet para descargar ComfyUI y los pesos públicos de Hugging Face.
4. No adjuntes datasets privados ni agregues secretos de Supabase.
5. Ejecuta las celdas en orden. La primera ejecución descarga los modelos y puede tardar; el tiempo de inferencia se medirá, no se presupone.

## Prueba inicial

El notebook crea un clip de 640×352, 49 fotogramas, 24 fps y 12 pasos. Es una prueba de compatibilidad y rendimiento, no la calidad final de producción. Si finaliza correctamente, guarda MP4 y un JSON de parámetros en `/kaggle/working`.

Si se produce falta de memoria (CUDA OOM), la siguiente prueba debe reducir resolución a 512×288 y longitud a 33 fotogramas. No aumentes parámetros hasta lograr un render completo.

## Guardar en la biblioteca privada

La aplicación ya dispone de una carga autenticada de archivos de imagen y video. Descarga el MP4 desde Kaggle y súbelo mediante el panel **IMAGEN DE REFERENCIA** de VIDEO STUDIO AI, seleccionando el proyecto correspondiente. El sistema lo registra como video en el bucket privado `video-assets`; después debe aparecer y reproducirse en la biblioteca.

No copies service_role, tokens de acceso ni contraseñas a Kaggle. No abras túneles, no publiques ComfyUI y no configures un endpoint público. Esta versión es un trabajador manual por sesión; no es todavía una integración automática Cloudflare↔GPU.

## Límites conocidos

- GPU gratuita, cuota y sesiones están sujetas a disponibilidad y reglas de Kaggle.
- La descarga inicial de modelos es grande y requiere Internet y espacio temporal suficiente.
- El primer clip no contiene audio. La app incorpora voces y pistas de audio en el montaje.
- La duración final de 15/30 segundos se construirá a partir de clips o subclips generados; una película de 20 minutos requiere muchos trabajos y no se garantiza en una sesión GPU gratuita.
- Si Kaggle no asigna GPU o la sesión se interrumpe, no se activa ningún servicio de pago. Se puede reanudar la prueba en otra sesión.
