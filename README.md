# Jardín de pendientes

Checklist gamificado: vacías la cabeza, ordenas tus tareas y cada tarea terminada planta una flor. Tiene puntos, niveles, premios que tú eliges y logros.

## Instalarla en el celular

1. Abre la app en el navegador del teléfono (Safari en iPhone, Chrome en Android).
2. **iPhone:** botón Compartir → «Agregar a pantalla de inicio».
   **Android:** menú ⋮ → «Instalar app» (o «Agregar a pantalla principal»).
3. Ábrela siempre desde el ícono 🌸.

Todo (tareas, puntos, premios, logros) se guarda automáticamente en el teléfono y funciona sin internet.
Desde «Tus datos» puedes guardar una copia y restaurarla en otro teléfono.

## Publicación

Es un sitio estático (GitHub Pages): `index.html`, `manifest.webmanifest`, `sw.js` e `icons/`.

## Sincronizar entre dispositivos (Supabase)

1. En Supabase → **SQL Editor**, pega y ejecuta [`supabase/setup.sql`](supabase/setup.sql).
2. En **Authentication → URL Configuration**, pon como *Site URL* `https://burubm.github.io/the-checklist/`.
3. En **Project Settings → API** copia la *Project URL* y la *anon / publishable key* en [`config.js`](config.js).
4. En la app, **Tus datos → Crear cuenta** (mail + contraseña) y después **Entrar** en cada dispositivo.

Los cambios sin conexión se guardan en el dispositivo y se suben al volver; si dos dispositivos
cambiaron a la vez, se combinan (tareas, puntos, logros y premios) en vez de pisarse.

## Recordatorio diario (notificaciones)

1. **Edge Function**: Supabase → Edge Functions → *Deploy a new function* → *Via editor*, nombre `daily-reminder`,
   pegar [`supabase/functions/daily-reminder/index.ts`](supabase/functions/daily-reminder/index.ts) y desplegar.
   En los detalles de la función, desactivar **Verify JWT** (la función valida por su cuenta).
2. **Secrets** (Edge Functions → Secrets): `VAPID_PUBLIC_KEY` (la misma de `config.js`), `VAPID_PRIVATE_KEY`, `CRON_SECRET`.
3. **SQL**: ejecutar [`supabase/notifications.sql`](supabase/notifications.sql) poniendo el valor de `CRON_SECRET`.
4. En la app: **Tus datos → Recordatorio diario → Activar** (en cada dispositivo) y **Probar ahora**.
