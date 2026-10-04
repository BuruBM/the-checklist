# Jardín de pendientes

Checklist gamificado: vaciás la cabeza, ordenás tus tareas y cada tarea terminada planta una flor. Tiene puntos, niveles, premios que elegís vos y logros.

## Metas y dictado

- **Metas**: podés tener varias a la vez (ej. 🏖️ La Playa · 10/10 y 🩺 Estudio médico · 25/10), cada una con su cuenta regresiva y su barra de progreso. Tocá una meta para ver solo sus tareas; cuando pasa la fecha, la cerrás y elegís qué hacer con lo que quedó.
- **Etiquetas al cargar**: `#categoria`, `@rapida|@mediana|@grande`, `!hoy`, `!mañana`, `!2/10`, `!diaria|!cada2|!semanal`, `+meta` (ej. `+playa`), `!sinmeta`.
- **Interpretación automática**: lo que escribís o dictás sin etiquetas se clasifica solo por palabras clave (categoría, tamaño según el primer verbo, fechas como «mañana» o «el viernes», y la meta si la nombrás). Las etiquetas siempre mandan.
- **Dictar**: en «Vaciar la cabeza», 🎙️ Dictar y hablás de corrido. Al tocar «Terminar», la app separa las tareas (por «después», «también», o un «y» seguido de otro verbo), saca los «tengo que» y las muletillas, descarta repetidos y deja la lista en el cuadro para revisar antes de agregar.
- **Deshacer y borrar varias**: después de «Agregar todo» aparece «Deshacer». Con «Elegir varias» marcás tareas (o «Último vaciado» de un toque) y las borrás juntas.

## Instalarla en el celular

1. Abrí la app en el navegador del teléfono (Safari en iPhone, Chrome en Android).
2. **iPhone:** botón Compartir → «Agregar a pantalla de inicio».
   **Android:** menú ⋮ → «Instalar app» (o «Agregar a pantalla principal»).
3. Abrila siempre desde el ícono 🌸.

Todo (tareas, puntos, premios, logros) se guarda automáticamente en el teléfono y funciona sin internet.
Desde «Tus datos» podés guardar una copia y restaurarla en otro teléfono.

## Cómo está hecho

Sitio estático (GitHub Pages, rama `main`), sin frameworks ni paso de compilación:

| Archivo | Qué tiene |
|---|---|
| `index.html` | La estructura de la página |
| `css/app.css` | El diseño (modo claro y oscuro) |
| `js/core.js` | Núcleo de datos sin pantalla: normalizar y migrar datos, días que empiezan a las 5, combinar dos dispositivos |
| `js/classify.js` | Interpretar lo escrito o dictado: separar lo dicho en tareas, categoría, tamaño, fechas, meta y lo aprendido de las correcciones |
| `js/app.js` | La app: pantallas, gamificación, metas, dictado, sincronización y avisos |
| `sw.js`, `manifest.webmanifest`, `icons/` | Instalación como app y funcionamiento sin internet |
| `supabase/` | Tablas, horarios y la función de notificaciones |

## Pruebas

```bash
npm install
npm test           # lógica: núcleo, clasificador (con frases reales) y notificaciones
npm run test:e2e   # la app en un celular simulado con Playwright
```

GitHub las corre solas en cada cambio (pestaña **Actions**).

## Sincronizar entre dispositivos (Supabase)

1. En Supabase → **SQL Editor**, pegá y ejecutá [`supabase/setup.sql`](supabase/setup.sql).
2. En **Authentication → URL Configuration**, poné como *Site URL* `https://burubm.github.io/the-checklist/`.
3. En **Project Settings → API** copiá la *Project URL* y la *anon / publishable key* en [`config.js`](config.js).
4. En la app, **Tus datos → Crear cuenta** (mail + contraseña) y después **Entrar** en cada dispositivo.

Los cambios sin conexión se guardan en el dispositivo y se suben al volver; si dos dispositivos
cambiaron a la vez, se combinan (tareas, puntos, logros y premios) en vez de pisarse.

## Recordatorio diario (notificaciones)

1. **Edge Function**: Supabase → Edge Functions → *Deploy a new function* → *Via editor*, nombre `daily-reminder`,
   pegar [`supabase/functions/daily-reminder/index.ts`](supabase/functions/daily-reminder/index.ts) y desplegar.
   En los detalles de la función, desactivar **Verify JWT** (la función valida por su cuenta).
2. **Secrets** (Edge Functions → Secrets): `VAPID_PUBLIC_KEY` (la misma de `config.js`), `VAPID_PRIVATE_KEY`, `CRON_SECRET`.
3. **SQL**: ejecutar [`supabase/notifications.sql`](supabase/notifications.sql) poniendo el valor de `CRON_SECRET`.
4. En la app: **Tus datos → Avisos → Activar** (en cada dispositivo) y **Probar ahora**.

Qué llega: a la mañana, los nombres de lo más urgente de hoy (máx. 5); los domingos, el repaso de lo vencido; a la noche (opcional), lo que quedó pendiente; y cada tarea repetida con 🔔 a su horario.
