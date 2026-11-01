/*
 * Prueba del flujo completo con servicios SIMULADOS (no gasta créditos ni usa internet).
 * Comprueba: aclaraciones, petición de contexto, validación de enlaces y videos,
 * marcas de tiempo, modo demostración, sin resultados y errores.
 * Uso: npm test
 */
"use strict";
const http = require("http");
const assert = require("assert");

const URL_REAL = "https://mhworld.kiranico.com/es/armors";
const VIDEO_REAL = "vidReal0001";

function plan(pregunta, historial) {
  const p = pregunta.toLowerCase();
  if (p.includes("este material") && !historial.includes("Conversación previa")) return { tema: "materiales", preguntaCompleta: pregunta, aclaracion: "¿Qué material buscas?", faltaContexto: [] };
  if (/\bmi arma\b/.test(p) && !historial.includes("Arma:")) return { tema: "armas", preguntaCompleta: pregunta, aclaracion: "", faltaContexto: [{ campo: "arma", motivo: "Cada arma se juega distinto" }] };
  if (p.includes("rango actual")) return { tema: "armaduras", preguntaCompleta: pregunta, aclaracion: "", faltaContexto: [{ campo: "rango", motivo: "Las armaduras dependen del rango" }, { campo: "arma", motivo: "Ya indicado" }] };
  if (p.includes("zzz")) return { tema: "otro", preguntaCompleta: pregunta, aclaracion: "", faltaContexto: [] };
  return { tema: "apariencia", preguntaCompleta: pregunta, busquedaVideoEs: "mhw apariencia", busquedaVideoEn: "mhw layered armor", aclaracion: "", faltaContexto: [] };
}

const simulador = http.createServer((req, res) => {
  let cuerpo = "";
  req.on("data", c => (cuerpo += c));
  req.on("end", () => {
    const u = new URL(req.url, "http://x");
    res.setHeader("Content-Type", "application/json");
    if (u.pathname === "/search") {
      return res.end(JSON.stringify({ items: [{ id: { videoId: VIDEO_REAL } }, { id: { videoId: "vidReal0002" } }] }));
    }
    if (u.pathname === "/videos") {
      return res.end(JSON.stringify({ items: u.searchParams.get("id").split(",").map(id => ({
        id, snippet: { title: "Tutorial " + id, channelTitle: "Canal de prueba", publishedAt: "2024-05-01T00:00:00Z", defaultAudioLanguage: "es-419",
          description: "Capítulos:\n0:00 Intro\n1:25 Abrir el menú de apariencia\n4:10 Guardar" }, contentDetails: { duration: "PT9M5S" } })) }));
    }
    if (u.pathname === "/v1/messages") {
      const b = JSON.parse(cuerpo);
      if (req.headers["x-api-key"] !== "clave-prueba") { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: "bad key" } })); }
      const usuario = b.messages[0].content;
      if (b.system.includes("Analizas preguntas")) {
        const pregunta = /Pregunta nueva: (.*)/.exec(usuario)[1];
        return res.end(JSON.stringify({ content: [{ type: "text", text: "```json\n" + JSON.stringify(plan(pregunta, usuario)) + "\n```" }] }));
      }
      assert.ok(b.tools && b.tools[0].type === "web_search_20250305", "debe usar la herramienta de búsqueda web");
      assert.ok(b.system.includes("NUNCA") || b.system.includes("nunca mezcles"), "debe prohibir mezclar juegos");
      if (usuario.includes("zzz")) {
        return res.end(JSON.stringify({ stop_reason: "end_turn", content: [
          { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "zzz" } },
          { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
          { type: "text", text: JSON.stringify({ respuestaDirecta: "No encontré información fiable sobre «zzz» en este juego.", sinResultados: true }) }] }));
      }
      const respuesta = {
        respuestaDirecta: "Usa la armadura de capa en la tienda de equipo.",
        pasos: ["Ve a la caja de objetos", "Abre Equipo de capa"],
        requisitos: [
          { texto: "Iceborne instalado", tipo: "comprobado", fuenteUrl: URL_REAL + "/" },
          { texto: "Dato inventado", tipo: "comprobado", fuenteUrl: "https://inventado.com/x" }
        ],
        videos: [
          { videoId: VIDEO_REAL, porQue: "Muestra el menú", marcasTiempo: [{ tiempo: "1:25", tema: "Menú" }, { tiempo: "7:77", tema: "Inventada" }] },
          { videoId: "videoInventado", porQue: "no existe" }
        ],
        guias: [
          { url: URL_REAL, titulo: "Armaduras", idioma: "es", porQue: "Lista oficial" },
          { url: "https://inventado.com/guia", titulo: "Falsa" }
        ],
        fuentes: [{ url: URL_REAL, titulo: "Kiranico" }],
        siguientePaso: "Prueba un set de capa"
      };
      return res.end(JSON.stringify({ stop_reason: "end_turn", content: [
        { type: "text", text: "Voy a buscar." },
        { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "mhw layered armor" } },
        { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: URL_REAL + "?utm_source=x", title: "Armaduras - Kiranico", page_age: "2024" }] },
        { type: "text", text: JSON.stringify(respuesta) }] }));
    }
    res.statusCode = 404; res.end("{}");
  });
});

async function post(puerto, cuerpo) {
  const r = await fetch("http://127.0.0.1:" + puerto + "/api/preguntar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  return { estado: r.status, datos: await r.json() };
}

function cargarServidor(env) {
  for (const k of ["ANTHROPIC_API_KEY", "YOUTUBE_API_KEY", "ANTHROPIC_BASE_URL", "YOUTUBE_BASE_URL"]) delete process.env[k];
  Object.assign(process.env, env);
  delete require.cache[require.resolve("../server.js")];
  return require("../server.js").servidor;
}

function escuchar(s) { return new Promise(ok => s.listen(0, "127.0.0.1", () => ok(s.address().port))); }

(async () => {
  const pSim = await escuchar(simulador);
  const base = "http://127.0.0.1:" + pSim;
  let fallos = 0;
  const prueba = async (nombre, fn) => {
    try { await fn(); console.log("  ✔ " + nombre); } catch (e) { fallos++; console.log("  ✘ " + nombre + "\n    " + e.message); }
  };

  console.log("Modo real (servicios simulados):");
  const real = cargarServidor({ ANTHROPIC_API_KEY: "clave-prueba", YOUTUBE_API_KEY: "yt", ANTHROPIC_BASE_URL: base, YOUTUBE_BASE_URL: base, LIMITE_POR_HORA: "100" });
  const p = await escuchar(real);
  const ctx = { plataforma: "PC (Steam)", rango: "Rango maestro", sinSpoilers: true };

  await prueba("¿Cómo cambio la apariencia…? → respuesta validada", async () => {
    const { estado, datos } = await post(p, { juego: "mhw", expansion: true, pregunta: "¿Cómo cambio la apariencia de mi armadura sin perder sus estadísticas?", contexto: ctx });
    assert.strictEqual(estado, 200);
    assert.strictEqual(datos.tipo, "respuesta");
    assert.strictEqual(datos.juego, "Monster Hunter: World + Iceborne");
    assert.strictEqual(datos.guias.length, 1, "la guía inventada debe descartarse");
    assert.strictEqual(datos.guias[0].url, URL_REAL + "?utm_source=x", "usa la URL exacta de la búsqueda");
    assert.strictEqual(datos.videos.length, 1, "el video inventado debe descartarse");
    assert.strictEqual(datos.videos[0].marcasTiempo.length, 1, "la marca de tiempo inventada debe descartarse");
    assert.ok(datos.videos[0].marcasTiempo[0].url.endsWith("&t=85s"));
    assert.strictEqual(datos.videos[0].idioma, "es");
    assert.strictEqual(datos.requisitos.find(r => r.texto === "Dato inventado").tipo, "recomendacion", "un dato sin fuente real no es 'comprobado'");
    assert.strictEqual(datos.requisitos.find(r => r.texto === "Iceborne instalado").tipo, "comprobado");
    assert.ok(datos.advertencias.some(a => a.includes("descartó")));
    assert.deepStrictEqual(datos.busquedasWeb, ["mhw layered armor"]);
  });

  await prueba("¿Dónde consigo este material? → pide aclaración sin buscar", async () => {
    const { datos } = await post(p, { juego: "mhw", expansion: false, pregunta: "¿Dónde consigo este material?", contexto: ctx });
    assert.strictEqual(datos.tipo, "aclaracion");
    assert.ok(datos.aclaracion.includes("material"));
    assert.strictEqual(datos.juego, "Monster Hunter: World");
  });

  await prueba("Enséñame a usar mi arma con un video → pide el arma", async () => {
    const { datos } = await post(p, { juego: "mhwilds", pregunta: "Enséñame a usar mi arma con un video.", contexto: ctx });
    assert.strictEqual(datos.tipo, "contexto");
    assert.deepStrictEqual(datos.faltaContexto.map(f => f.campo), ["arma"]);
  });

  await prueba("Enséñame a usar mi arma (con arma indicada) → responde con video", async () => {
    const { datos } = await post(p, { juego: "mhwilds", pregunta: "Enséñame a usar mi arma con un video.", contexto: Object.assign({ arma: "Arco" }, ctx) });
    assert.strictEqual(datos.tipo, "respuesta");
    assert.strictEqual(datos.juego, "Monster Hunter Wilds");
    assert.ok(datos.videos.length >= 1);
  });

  await prueba("¿Qué armadura me conviene con mi rango actual? → no pide lo que ya sabe", async () => {
    const { datos } = await post(p, { juego: "mhw", expansion: true, pregunta: "¿Qué armadura me conviene con mi rango actual?", contexto: Object.assign({ arma: "Martillo" }, ctx) });
    assert.notStrictEqual(datos.tipo, "contexto", "rango y arma ya estaban indicados");
  });

  await prueba("Consulta sin resultados → tipo sin_resultados con búsquedas sin verificar", async () => {
    const { datos } = await post(p, { juego: "mhw", pregunta: "zzz qwerty", contexto: ctx });
    assert.strictEqual(datos.tipo, "sin_resultados");
    assert.strictEqual(datos.videos.length, 0);
    assert.ok(datos.busquedasSugeridas.every(b => b.tipo === "busqueda"));
  });

  await prueba("Errores de entrada → 400 con mensaje claro", async () => {
    let r = await post(p, { juego: "zelda", pregunta: "hola" });
    assert.strictEqual(r.estado, 400);
    r = await post(p, { juego: "mhw", pregunta: "   " });
    assert.strictEqual(r.estado, 400);
  });
  real.close();

  console.log("Clave inválida:");
  const mala = cargarServidor({ ANTHROPIC_API_KEY: "otra", ANTHROPIC_BASE_URL: base, YOUTUBE_BASE_URL: base });
  const pm = await escuchar(mala);
  await prueba("Clave de IA inválida → error 502 explicado", async () => {
    const { estado, datos } = await post(pm, { juego: "mhw", pregunta: "hola" });
    assert.strictEqual(estado, 502);
    assert.ok(datos.error.includes("ANTHROPIC_API_KEY"));
  });
  mala.close();

  console.log("Modo demostración:");
  const demo = cargarServidor({});
  const pd = await escuchar(demo);
  await prueba("Sin clave → modo demo claramente identificado", async () => {
    const est = await (await fetch("http://127.0.0.1:" + pd + "/api/estado")).json();
    assert.strictEqual(est.ia, false);
    const { datos } = await post(pd, { juego: "mhw", pregunta: "¿Dónde consigo Gema de wyvern?" });
    assert.strictEqual(datos.modo, "demo");
    assert.ok(datos.aviso.includes("MODO DEMOSTRACIÓN"));
    assert.ok(datos.busquedasSugeridas.every(b => b.tipo === "busqueda"));
  });
  await prueba("Sirve la página principal", async () => {
    const r = await fetch("http://127.0.0.1:" + pd + "/");
    assert.strictEqual(r.status, 200);
    assert.ok((await r.text()).includes("Guía del Cazador"));
    assert.strictEqual((await fetch("http://127.0.0.1:" + pd + "/../server.js")).status, 404);
  });
  demo.close();
  simulador.close();

  console.log(fallos ? "\n" + fallos + " prueba(s) fallaron" : "\nTodas las pruebas pasaron");
  process.exit(fallos ? 1 : 0);
})();
