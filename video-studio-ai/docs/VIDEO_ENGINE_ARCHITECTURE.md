# Motor de animación neuronal gratuito: arquitectura e integración

## Decisión técnica adoptada — 19 de noviembre de 2026

La ruta gratuita elegida para la primera implementación es:

- **Motor:** ComfyUI.
- **Modelo principal:** Wan 2.2 TI2V-5B, mediante el workflow oficial de ComfyUI.
- **Acelerador inicial:** Kaggle Notebooks con GPU NVIDIA T4, cuando esté disponible. Si la sesión ofrece T4 x2, no se supondrá que la VRAM de ambas tarjetas se suma; la primera prueba utilizará una GPU y el offloading de ComfyUI.
- **Modo de ejecución:** trabajador temporal iniciado manualmente por el propietario de la aplicación. Procesa una tanda finita de trabajos, guarda los resultados en Supabase privado y termina. No será un servidor permanente ni expondrá ComfyUI a Internet.
- **Alternativa de modelo:** LTX-Video sólo se evaluará si Wan 2.2 no cabe en la GPU disponible o su velocidad real resulta inaceptable. No se cambiará de modelo sin una comparación con el mismo prompt y los mismos parámetros.

### Por qué esta elección

Kaggle documenta sesiones de notebook con GPU, ejecución de hasta 12 horas y almacenamiento de salida; documentación técnica de NVIDIA muestra opciones de GPU T4 x2 en el entorno Kaggle. La disponibilidad y la cuota gratuita siguen sujetas a las reglas y recursos de Kaggle. No se presupone una GPU garantizada ni se presenta Kaggle como infraestructura 24/7.

Google Colab gratuito queda descartado como trabajador de la aplicación: sus reglas restringen el alojamiento de servicios web, la entrega de contenido multimedia y los trabajadores distribuidos. Hugging Face ZeroGPU tampoco será la base de producción: su cuota gratuita documentada es de 5 minutos de GPU diarios por cuenta, insuficiente para planificar una producción audiovisual larga. Los créditos promocionales de otros proveedores no se consideran una base sostenible ni garantizada de costo cero.

### Parámetros de validación

1. Verificar GPU, VRAM disponible, espacio temporal y acceso a los pesos antes de descargar el modelo.
2. Primera prueba: texto-a-video, 640×352, 49 fotogramas (aprox. 2 segundos a 24 fps), con un prompt controlado. Después se validará imagen-a-video con una referencia visual.
3. Medir por separado descarga, carga del modelo, inferencia, decodificación y subida a Supabase. No se anunciará una velocidad antes de medirla en la GPU real.
4. Si pasa la prueba, comparar calidad y tiempo con LTX-Video bajo el mismo prompt. Se conservará Wan 2.2 como principal salvo que la evidencia demuestre una mejora material con LTX.
5. Después de validar el clip corto, aumentar resolución/duración gradualmente. Los segmentos de 15/30 segundos de la película podrán componerse con varios subclips neuronales cuando el workflow no genere de forma fiable toda esa duración en una sola inferencia.

**Restricción real:** una GPU gratuita temporal no puede garantizar generación automática continua, disponibilidad inmediata ni películas de 20 minutos en un solo trabajo. La aplicación conservará el manifiesto y permitirá reanudar; si no hay GPU/cuota, el trabajo se detiene sin costo. Para iniciar la tanda gratuita será necesario abrir y ejecutar el notebook de Kaggle; no se fingirá que existe un endpoint GPU permanente.

## Objetivo

Sustituir progresivamente el movimiento 2D de capas por generación real de clips animados, sin trasladar modelos de difusión a Cloudflare Pages ni activar servicios de pago.

La aplicación web seguirá siendo privada y estará alojada en Cloudflare Pages. El cómputo de video se ejecutará en un trabajador GPU externo y temporal (Kaggle Notebook). El navegador nunca recibirá credenciales administrativas del trabajador.

## Arquitectura prevista

1. **VIDEO STUDIO AI / Cloudflare Pages**
   - Analiza el guion, crea el manifiesto y divide la película en segmentos de 15 o 30 segundos.
   - Envía al backend el segmento, sus referencias visuales y el perfil de generación solicitado.
   - Muestra el estado de cada trabajo y permite reintentar los segmentos fallidos.

2. **Backend privado / Cloudflare Pages Functions**
   - Verifica la sesión Supabase del usuario.
   - Valida duración, tamaño, formato y límites del trabajo.
   - Mantiene las credenciales y permisos de la integración sólo en variables secretas del servidor.
   - Crea y consulta trabajos; nunca acepta una URL arbitraria del navegador como destino de proxy.
   - No activa fallback de pago. Si no hay trabajador GPU disponible o se agota su cuota, devuelve un estado explícito y conserva el manifiesto.

3. **Trabajador GPU temporal / Kaggle + ComfyUI**
   - Se inicia desde un notebook privado de Kaggle y procesa una tanda finita de trabajos.
   - Ejecuta workflows versionados para texto-a-video e imagen-a-video mediante la API local de ComfyUI.
   - El servidor ComfyUI escucha sólo en loopback dentro de la sesión; no se crea túnel público ni endpoint abierto.
   - Consulta trabajos autorizados, valida el resultado y lo sube a Supabase mediante un flujo autenticado de mínimo privilegio.
   - Al desconectarse, los trabajos incompletos se marcan como interrumpidos y se pueden reanudar desde el último segmento completado.

4. **Almacenamiento y montaje**
   - Cada clip terminado se guarda como recurso privado asociado al segmento.
   - El ensamblador de película consume los clips ya generados; no debe intentar generar los 20 minutos en una sola inferencia.
   - La exportación final y el audio se mantienen como etapas separadas para poder reanudar sin regenerar clips.

## Selección inicial de modelos

| Prioridad | Modelo / componente | Uso previsto | Decisión |
| --- | --- | --- | --- |
| 1 | Wan 2.2 TI2V-5B | Texto-a-video e imagen-a-video | Motor principal; primer workflow a validar en GPU gratuita, empezando con resolución y duración reducidas. |
| 2 | LTX-Video | Comparación de velocidad, calidad y memoria | Alternativa sólo después de medir Wan 2.2 con el mismo prompt y hardware. |
| 3 | AnimateDiff | Movimiento de imágenes con modelos compatibles de Stable Diffusion | Complemento para estilos ilustrados/anime; no sustituye todos los workflows de video. |
| 4 | CogVideoX | Alternativa de generación de video | Experimental hasta medir si cabe en la GPU gratuita asignada. |
| 5 | Stable Video Diffusion | Imagen-a-video | Alternativa especializada de imagen-a-clip; no es el motor principal de texto-a-video. |
| Complementario | Blender | Escenas 3D, cámaras, objetos y animación determinista | Usarlo cuando se requiera control repetible de cámaras, vehículos, trayectorias o continuidad espacial. |
| Complementario | Python, PyTorch y Diffusers | Automatización, pipelines y evaluación | Base para workflows propios; no implica que los modelos puedan ejecutarse dentro de Cloudflare. |

## Plataformas gratuitas: límites operativos

- **Kaggle Notebooks:** opción elegida para las primeras pruebas y tandas de generación. Tiene aceleradores GPU gratuitos sujetos a disponibilidad, cuota y límites de sesión. No es un backend permanente ni se debe exponer como servidor público.
- **Google Colab gratuito:** no se utilizará como trabajador de VIDEO STUDIO AI por las restricciones publicadas para alojamiento de servicios web, entrega de medios y trabajadores distribuidos.
- **Hugging Face ZeroGPU:** no se utilizará como base de producción debido a la cuota gratuita diaria documentada de GPU.
- **Equipo local:** no es requisito para la arquitectura elegida. La GPU AMD del equipo del usuario no se debe asumir compatible con los workflows CUDA de NVIDIA; no se trasladará el procesamiento al PC.

Por lo anterior, la integración debe tratar el trabajador GPU como **temporal y opcional**. Si está desconectado, la aplicación debe seguir permitiendo planificar, guardar y preparar segmentos, pero no fingir que generó animación.

## Seguridad obligatoria

- No poner tokens de ComfyUI, Kaggle ni Supabase service-role en JavaScript público, notebooks compartidos o repositorios.
- No exponer un servidor ComfyUI abierto a Internet.
- La autenticación entre el trabajador y la aplicación debe usar credenciales de mínimo privilegio y secretos configurados por el propietario; nunca una clave service-role en el notebook.
- Restringir los workflows a plantillas versionadas en el repositorio; no aceptar nodos/workflows arbitrarios desde el navegador.
- Validar que los archivos de salida correspondan al trabajo solicitado antes de copiarlos a Supabase.
- Mantener límites de concurrencia, duración, tamaño y número de reintentos.
- Si no hay GPU gratuita o el modelo falla por memoria/cuota, detener el trabajo y mostrar el motivo. Nunca cambiar a un endpoint con cobro.

## Entregas y criterios de aceptación

### A. Conector de trabajos
- Diagnóstico autenticado del estado del trabajador: disponible/no disponible y capacidades.
- Creación de trabajos desde la aplicación y seguimiento de estado sin bloquear la interfaz.
- Cancelación/reintento y manejo de desconexión.
- Secretos sólo en backend.

### B. Primer workflow neuronal
- Wan 2.2 TI2V-5B, primero texto-a-video para validar la inferencia y después imagen-a-video con referencias visuales para continuidad.
- Probar un clip corto antes de aumentar parámetros.
- Guardar MP4 generado en Supabase Storage privado y vincularlo al segmento.
- Comparar continuidad de personaje, movimiento, artefactos, velocidad y memoria.
- Criterio de aceptación: generar un clip neuronal real, guardarlo en Supabase y recuperarlo/reproducirlo desde la biblioteca privada.

### C. Integración con producción
- Generar un clip por segmento de 15/30 segundos o subclips más cortos concatenados cuando el modelo tenga límite menor.
- Reanudar una película sin volver a generar segmentos ya terminados.
- Conservar el compositor 2D como fallback gratuito explícito, no como si fuera generación neuronal.
- Sólo después de validar lotes cortos, probar una película de 1 minuto, 5 minutos y finalmente 20 minutos.

## Estado

Este documento registra la decisión técnica y los criterios de implementación. **No significa que ComfyUI, Kaggle o Wan 2.2 ya estén conectados ni que se haya generado un clip neuronal.** La rama actual conserva el compositor 2D y el ensamblador WebM existentes hasta completar las etapas anteriores y probarlas de extremo a extremo.
