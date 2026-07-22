# ROIS IA - activacion futura

El modulo funciona actualmente con la metodologia comercial local ROIS, sin consumo de API. ROIS IA aparece como una mejora proxima y la Edge Function queda preparada para activarse cuando exista presupuesto disponible.

Para activar ROIS IA en el futuro, agrega `roisIAEnabled: true` a `window.ROIS_CONFIG`. La clave debe vivir en Supabase y nunca en `app.js` ni `app-config.js`.

## 1. Base de datos

Ejecuta `supabase-sponsor-deck-ai-mvp.sql` en Supabase SQL Editor antes de publicar la nueva version del frontend.

## 2. Funcion segura

Despliega `supabase/functions/generate-sponsor-deck/index.ts` como Edge Function llamada `generate-sponsor-deck`, con verificacion JWT habilitada. Si la funcion ya existe, reemplaza su codigo y vuelve a desplegarla: la version actual genera beneficios para un ticket mensual unico y ya no devuelve tres niveles de precios.

Configura estos secretos en Supabase:

```text
OPENAI_API_KEY=tu_clave_privada
OPENAI_MODEL=gpt-5.6-sol
```

`OPENAI_MODEL` es opcional. El modelo predeterminado prioriza velocidad y costo para generacion masiva de decks.

## 3. Orden de despliegue

1. Ejecutar SQL.
2. Desplegar la Edge Function y sus secretos.
3. Subir `app.js`, `index.html` y `styles.css`.
4. Iniciar sesion como Athlete y Creador.
5. Abrir `Sponsor Deck ROIS`, agregar beneficios e imagenes, generar y revisar.
6. Iniciar sesion como Empresa y validar `Ver Sponsor Deck` en Mercado de fichajes y Creadores.

Mientras `roisIAEnabled` no sea `true`, el frontend no llama a OpenAI: guarda inmediatamente un deck estructurado con la metodologia comercial ROIS y no muestra errores de cuota al usuario.
