# VIDEO STUDIO AI

Aplicación web privada para organizar proyectos audiovisuales a partir de historias, con autenticación, biblioteca de recursos y herramientas de planificación cinematográfica.

## Estado funcional actual

- Acceso privado con Supabase Auth.
- Proyectos y biblioteca de archivos en Supabase.
- Almacenamiento privado de imágenes y videos en Supabase Storage.
- Generación de imágenes con Cloudflare Workers AI (FLUX Schnell), sujeta a la cuota gratuita disponible.
- Generación de voz en español mediante Workers AI Aura-2, sujeta a la cuota gratuita disponible.
- Análisis narrativo basado en reglas, escenas, tomas y diálogos.
- Planificación de películas de 15 segundos a 20 minutos mediante segmentos audiovisuales fijos de 15 o 30 segundos.
- Manifiestos de producción guardados en Supabase con políticas RLS.
- Asignación de personajes, voces, imágenes de referencia y referencias de escenarios/objetos.
- Compositor 2D de capas PNG con transparencia para desplazar personajes y vehículos sobre fondos estáticos.
- Ensamblaje en el navegador de segmentos de video o fondos animados, con voz TTS, audio original de clips, efectos sintetizados y pista musical sintetizada; exportación WebM.
- Validación de línea de tiempo sin huecos, solapamientos ni segmentos de duración variable.

## Límites que deben mantenerse claros

El compositor de navegador admite movimiento 2D por capas: requiere imágenes PNG con transparencia para cada personaje/vehículo que se quiera mover. No separa automáticamente sujetos de una imagen, no genera gestos, articulación ni movimiento neuronal de video. Las capas se desplazan con trayectorias simples. El ensamblaje graba la línea de tiempo en WebM en tiempo real dentro del navegador; exportaciones largas pueden requerir mucha memoria y deben probarse primero con una duración corta. No se ha validado todavía una exportación de 20 minutos en navegadores reales.

No hay un proveedor de generación neuronal de video que se haya verificado como utilizable dentro de la cuota gratuita de esta instalación. Los modelos de video de terceros del catálogo pueden requerir créditos o facturación. Este proyecto se mantiene en modalidad gratuita: no debe activar proveedores de pago, claves de facturación ni servicios alternativos con cargo. Si se agota una cuota gratuita, la operación debe detenerse y mostrar un mensaje claro.

## Arquitectura

- `public/`: interfaz web y motores del navegador.
- `functions/api/jobs.js`: endpoint autenticado para generación de imágenes y voz.
- `supabase/schema.sql`: tablas, almacenamiento privado y políticas RLS.
- `tests/`: pruebas automatizadas de motores y contratos.
- `.github/workflows/validate.yml`: validación de sintaxis y pruebas con Node.js.

## Configuración

### Supabase

1. Configura autenticación por correo.
2. Ejecuta el contenido de `supabase/schema.sql` en el SQL Editor del proyecto Supabase. Si ya existe una instalación, revisa el script y aplica la migración de `production_manifests` para habilitar persistencia de manifiestos.
3. Mantén el bucket `video-assets` privado.
4. No publiques claves `service_role` en el navegador ni en GitHub.

La tabla `production_manifests` guarda el manifiesto JSON, el proyecto, el usuario propietario, la duración y el número de segmentos. Sus políticas RLS limitan lectura y escritura al propietario del proyecto.

### Cloudflare Pages

1. Conecta el repositorio privado.
2. Usa `video-studio-ai` como directorio raíz y `public` como directorio de salida.
3. Configura el binding Workers AI con el nombre `AI`.
4. Configura `SUPABASE_URL` y `SUPABASE_ANON_KEY` en las variables de entorno de Pages.
5. Vuelve a desplegar después de cambiar bindings o variables.

## Validación

Desde la carpeta `video-studio-ai`:

```bash
npm test
```

El workflow también ejecuta comprobaciones de sintaxis para los módulos del navegador y la función de API.

## Seguridad y costos

- No hay pagos integrados.
- No se configura fallback a proveedores de pago.
- Las solicitudes requieren sesión válida de Supabase.
- Los archivos y manifiestos se almacenan en recursos privados con RLS.
- Para mantener el costo en cero, la cuenta debe permanecer en **Workers Free**. En Workers Paid, el uso de Workers AI que supere la asignación gratuita diaria puede generar cargos; la aplicación no puede imponer un límite de gasto a nivel de cuenta.
- Las cuotas gratuitas y la disponibilidad de modelos dependen de Cloudflare y pueden cambiar.


## Motor de animación neuronal: integración planificada

La arquitectura para conectar ComfyUI con un trabajador GPU gratuito temporal (Colab/Kaggle), los modelos abiertos candidatos, las medidas de seguridad y los criterios de aceptación están documentados en [`docs/VIDEO_ENGINE_ARCHITECTURE.md`](docs/VIDEO_ENGINE_ARCHITECTURE.md). Esta documentación no implica que el conector o los modelos ya estén operativos: la integración debe realizarse y probarse por etapas, sin exponer credenciales ni activar proveedores de pago.
