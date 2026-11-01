# Guía del Cazador

Asistente en español para **Monster Hunter: World**, su expansión **Iceborne** y **Monster Hunter Wilds**.
Eliges el juego, escribes tu duda y recibes: respuesta directa, tutorial paso a paso, requisitos y materiales,
hasta 3 videos y 2 guías escritas comprobadas, fuentes y un siguiente paso concreto.

Funciona como **página web**, **APK de Android** y **app de Windows 11**. No necesita cuenta.

## Cómo funciona

```
pregunta → comprensión (IA rápida) → ¿falta un dato? se pide
         → videos reales (API de YouTube) + búsqueda web real (herramienta web_search de Claude)
         → explicación fundamentada (IA) → validación → respuesta
```

La validación del servidor garantiza que:

- Cada guía y fuente es una URL que **apareció en una búsqueda real**; las demás se descartan y se avisa.
- Cada video es uno que **devolvió la API de YouTube** (título, canal, fecha e idioma vienen de YouTube, no de la IA).
- Las **marcas de tiempo** solo se muestran si coinciden con los capítulos que el creador puso en la descripción.
- Un dato solo se marca como **"Comprobado"** si tiene una fuente real; si no, aparece como **"Recomendación"**.
- Si no hay videos verificados, se ofrecen **búsquedas de YouTube** marcadas como búsquedas, no como tutoriales.
- Sin clave de IA, la app entra en **modo demostración** y lo dice claramente; nunca presenta respuestas predefinidas como búsquedas.

## Estructura

| Ruta | Qué es |
|---|---|
| `server.js` | Servidor Node.js sin dependencias: API `/api/preguntar`, `/api/estado` y la página web. Las claves viven solo aquí. |
| `public/` | Interfaz (HTML, CSS, JS sin frameworks). `juegos.js` es el catálogo de juegos. |
| `desktop/` | Envoltorio Electron para Windows 11. |
| `mobile/` | Configuración de Capacitor para Android. |
| `.github/workflows/compilar-apps.yml` | Compila el APK y el `.exe` en GitHub Actions. |
| `render.yaml` | Despliegue del servidor en Render con un clic. |
| `test/prueba.js` | Pruebas del flujo completo con servicios simulados. |
| `scripts/validar.js` | Prueba un servidor real con las preguntas de referencia. |

## 1. Claves que necesitas

| Variable | Para qué | Dónde se obtiene |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Obligatoria.** Búsqueda web + explicación. Sin ella: modo demostración. | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `YOUTUBE_API_KEY` | Recomendada. Videos con datos reales. | [Google Cloud Console](https://console.cloud.google.com) → habilitar *YouTube Data API v3* → Credenciales → Crear clave de API |

Opcionales: `MODELO` (por defecto `claude-sonnet-5-5`), `MODELO_RAPIDO` (`claude-haiku-5-5`), `BUSQUEDAS_MAX` (5),
`LIMITE_POR_HORA` por IP (40), `ORIGENES_PERMITIDOS` (`*`). Ver `.env.example`.

**Costo aproximado:** cada pregunta hace hasta 5 búsquedas web (la API cobra USD 10 por cada 1 000 búsquedas) más el consumo
de tokens del modelo. YouTube es gratuito dentro de su cuota diaria (unas 50 preguntas al día con la cuota estándar).

## 2. Publicar el servidor (Render, gratis)

1. Entra a [render.com](https://render.com) con tu cuenta de GitHub.
2. **New → Blueprint** → elige el repositorio **MHWW**. Render lee `render.yaml`.
3. Escribe tus claves `ANTHROPIC_API_KEY` y `YOUTUBE_API_KEY` cuando te las pida.
4. Al terminar tendrás una dirección como `https://guia-del-cazador.onrender.com`. Ábrela: esa es la versión web.

> En el plan gratuito el servidor "se duerme" tras 15 min sin uso; la primera pregunta después puede tardar ~1 minuto.

## 3. Conectar las apps con el servidor

En GitHub: **Settings → Secrets and variables → Actions → pestaña Variables → New repository variable**

- Nombre: `SERVER_URL`
- Valor: la dirección de Render, por ejemplo `https://guia-del-cazador.onrender.com`

Luego vuelve a compilar (paso 4). Si no lo haces, también puedes escribir la dirección dentro de la app en **Ajustes**.

## 4. Descargar el APK y la app de Windows

Cada cambio en `main` compila automáticamente. Para compilar a mano: pestaña **Actions → Compilar apps → Run workflow**.

- Al terminar, abre la ejecución y descarga en **Artifacts**: `GuiaDelCazador-Android` (APK) y `GuiaDelCazador-Windows` (instalador `.exe` y versión portátil).
- Para una descarga pública y permanente, crea una etiqueta `v0.1.0` (pestaña **Releases → Draft a new release → Choose a tag → v0.1.0**): los archivos se adjuntan al Release.

**Instalar en Android:** abre el APK en el teléfono y permite "instalar apps de origen desconocido". Es una compilación de prueba (debug), no está firmada para Google Play.

**Instalar en Windows 11:** ejecuta `GuiaDelCazador-…-instalador.exe`. Como no está firmada digitalmente, SmartScreen puede avisar: **Más información → Ejecutar de todas formas**. La versión `portable` no requiere instalación.

## Desarrollo local

```bash
cp .env.example .env      # y escribe tus claves
npm start                 # http://localhost:3000
npm test                  # pruebas con servicios simulados (no gasta créditos)
npm run validar           # 4 preguntas de referencia contra el servidor local real
```

Requiere Node.js 18 o superior.

## Agregar otro juego

Añade una entrada en `public/juegos.js` (nombre, plataformas, armas, rangos, fuentes preferidas como su base de Kiranico y preguntas sugeridas). La interfaz y el servidor lo toman automáticamente.

## Funciones implementadas (v0.1)

- [x] Selector de juego siempre visible: World, World + Iceborne (interruptor) y Wilds; cada juego tiene su propia conversación para no mezclar mecánicas.
- [x] Contexto opcional: plataforma, arma, rango y avance; la app solo lo pide cuando cambia la respuesta, y lo recuerda por juego.
- [x] Modo sin spoilers activado por defecto.
- [x] Chat con preguntas de seguimiento, lenguaje cotidiano, errores de escritura y nombres en español o inglés.
- [x] Aclaraciones cuando la pregunta es ambigua ("este material").
- [x] Respuesta estructurada: directa, pasos numerados, requisitos (comprobado / recomendación), consejos, términos explicados, videos, guías, fuentes, advertencias y siguiente paso.
- [x] Búsqueda web real priorizando Capcom, Kiranico del juego correspondiente y creadores originales; prioridad al español con aviso de idioma.
- [x] Videos reales de YouTube con título, canal, idioma, fecha, duración y por qué sirven; marcas de tiempo solo de capítulos comprobados.
- [x] Validación anti-invención de enlaces, videos y marcas de tiempo.
- [x] Estados de búsqueda, sin resultados, errores (con reintentar) y modo demostración identificado.
- [x] Modo oscuro/claro, historial y favoritos guardados en el dispositivo, con opción de borrar todo.
- [x] Claves solo en el servidor, límite de preguntas por IP.
- [x] Web adaptable a celular y computadora, APK de Android y app de Windows 11 compiladas en GitHub Actions.

## Pendiente / próximas versiones

- [ ] Iconos propios en el APK y en el instalador de Windows (hoy usan los predeterminados).
- [ ] APK firmado para publicar en Google Play y firma digital del instalador de Windows.
- [ ] Mostrar el progreso real de cada etapa (hoy se muestra un estado general "Buscando…").
- [ ] Caché de respuestas frecuentes para reducir costos.
- [ ] Comprobar automáticamente que cada enlace sigue en línea antes de mostrarlo.
- [ ] Más juegos (Rise/Sunbreak, Generations Ultimate…).
- [ ] Sincronizar historial y favoritos entre dispositivos (requeriría cuenta).

---
Proyecto de fans, sin afiliación con Capcom. *Monster Hunter* es una marca de Capcom.
