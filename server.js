/*
 * Guía del Cazador — servidor.
 * Flujo: pregunta → comprensión → búsqueda de videos (YouTube) y fuentes (búsqueda web)
 *        → explicación con IA → validación de enlaces → respuesta.
 * Sin dependencias externas: solo Node.js 18 o superior.
 * Las claves viven solo aquí (variables de entorno), nunca en la app.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const JUEGOS = require("./public/juegos.js");

// Carga opcional de un archivo .env local (sin dependencias)
try {
  const envTxt = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
  for (const linea of envTxt.split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (_) { /* sin .env */ }

const CFG = {
  puerto: Number(process.env.PORT) || 3000,
  claveIA: process.env.ANTHROPIC_API_KEY || "",
  claveYoutube: process.env.YOUTUBE_API_KEY || "",
  modelo: process.env.MODELO || "claude-sonnet-5-5",
  modeloRapido: process.env.MODELO_RAPIDO || "claude-haiku-5-5",
  urlIA: (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, ""),
  urlYoutube: (process.env.YOUTUBE_BASE_URL || "https://www.googleapis.com/youtube/v3").replace(/\/$/, ""),
  busquedasMax: Number(process.env.BUSQUEDAS_MAX) || 5,
  limitePorHora: Number(process.env.LIMITE_POR_HORA) || 40,
  origenes: (process.env.ORIGENES_PERMITIDOS || "*").split(",").map(s => s.trim()).filter(Boolean)
};
const VERSION = "0.1.0";
const DIR_PUBLICO = path.join(__dirname, "public");

/* ---------------------------------------------------------------- utilidades */

function json(res, estado, datos, cabeceras) {
  res.writeHead(estado, Object.assign({ "Content-Type": "application/json; charset=utf-8" }, cabeceras));
  res.end(JSON.stringify(datos));
}

function cors(req) {
  const origen = req.headers.origin;
  const h = { "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
  if (CFG.origenes.includes("*")) h["Access-Control-Allow-Origin"] = "*";
  else if (origen && CFG.origenes.includes(origen)) { h["Access-Control-Allow-Origin"] = origen; h.Vary = "Origin"; }
  return h;
}

function leerCuerpo(req, limite = 40000) {
  return new Promise((ok, mal) => {
    let datos = "";
    req.on("data", c => {
      datos += c;
      if (datos.length > limite) { mal(new Error("demasiado_grande")); req.destroy(); }
    });
    req.on("end", () => ok(datos));
    req.on("error", mal);
  });
}

const visitas = new Map();
function limiteExcedido(ip) {
  const ahora = Date.now(), hora = 3600e3;
  const lista = (visitas.get(ip) || []).filter(t => ahora - t < hora);
  if (lista.length >= CFG.limitePorHora) { visitas.set(ip, lista); return true; }
  lista.push(ahora); visitas.set(ip, lista);
  return false;
}

function extraerJSON(texto) {
  if (!texto) return null;
  const limpio = texto.replace(/```(?:json)?/gi, "");
  const ini = limpio.indexOf("{"), fin = limpio.lastIndexOf("}");
  if (ini < 0 || fin <= ini) return null;
  try { return JSON.parse(limpio.slice(ini, fin + 1)); } catch (_) { return null; }
}

function normalizarUrl(u) {
  try {
    const x = new URL(u);
    x.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(p => x.searchParams.delete(p));
    return (x.origin + x.pathname.replace(/\/+$/, "") + x.search).toLowerCase();
  } catch (_) { return ""; }
}

function sitioDe(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch (_) { return ""; }
}

function texto(v, max = 600) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function lista(v, max = 12) {
  return Array.isArray(v) ? v.slice(0, max) : [];
}

function urlBusquedaYoutube(q) {
  return "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);
}

/* ------------------------------------------------------------ contexto/juego */

function describirJuego(juego, conExpansion) {
  let d = juego.descripcion;
  if (juego.expansion) {
    d += conExpansion
      ? " El jugador TIENE la expansión " + juego.expansion.nombre + ". " + juego.descripcionExpansion
      : " El jugador NO tiene la expansión " + juego.expansion.nombre + ": no recomiendes nada que la requiera; si algo solo existe con ella, dilo claramente. (" + juego.descripcionExpansion + ")";
  }
  return d;
}

function nombreCompleto(juego, conExpansion) {
  return juego.nombre + (juego.expansion && conExpansion ? " + " + juego.expansion.nombre : "");
}

function describirContexto(c) {
  const p = [];
  if (c.plataforma) p.push("Plataforma: " + c.plataforma);
  if (c.arma) p.push("Arma: " + c.arma);
  if (c.rango) p.push("Rango: " + c.rango);
  if (c.avance) p.push("Avance en la historia / rango de cazador: " + c.avance);
  p.push(c.sinSpoilers === false ? "Spoilers: permitidos" : "Modo SIN SPOILERS activo: no reveles monstruos, giros ni contenido de historia que el jugador aún no alcanza; si es inevitable, avisa antes y mantén la mención mínima.");
  return p.join("\n");
}

function limpiarEntrada(b) {
  const juego = JUEGOS[b.juego];
  if (!juego) throw new Error("juego_invalido");
  const pregunta = texto(b.pregunta, 500);
  if (!pregunta) throw new Error("pregunta_vacia");
  const c = b.contexto || {};
  const contexto = {
    plataforma: texto(c.plataforma, 60),
    arma: texto(c.arma, 60),
    rango: texto(c.rango, 60),
    avance: texto(c.avance, 120),
    sinSpoilers: c.sinSpoilers !== false
  };
  const historial = lista(b.historial, 8).map(m => ({
    rol: m && m.rol === "asistente" ? "asistente" : "usuario",
    texto: texto(m && m.texto, 700)
  })).filter(m => m.texto);
  return { juego, conExpansion: !!b.expansion && !!juego.expansion, pregunta, contexto, historial };
}

/* ------------------------------------------------------------ API de Claude */

async function llamarIA(cuerpo) {
  const r = await fetch(CFG.urlIA + "/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": CFG.claveIA,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(cuerpo)
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error("ia_" + r.status);
    e.detalle = (datos.error && datos.error.message) || "";
    throw e;
  }
  return datos;
}

function textoDe(respuesta) {
  return (respuesta.content || []).filter(b => b.type === "text").map(b => b.text).join("");
}

/* Paso 1: entender la pregunta (rápido, sin búsqueda) */
async function comprender(e) {
  const historialTxt = e.historial.map(m => (m.rol === "usuario" ? "Jugador: " : "Guía: ") + m.texto).join("\n");
  const sistema =
    "Analizas preguntas de jugadores de Monster Hunter. Responde SOLO con un objeto JSON válido, sin texto adicional.\n" +
    "Juego seleccionado: " + nombreCompleto(e.juego, e.conExpansion) + ". " + describirJuego(e.juego, e.conExpansion) + "\n" +
    "Entiende español o inglés coloquial y con errores de escritura. Traduce nombres de objetos, monstruos o habilidades a su nombre oficial en inglés cuando lo sepas con seguridad.";
  const usuario =
    "Contexto conocido del jugador:\n" + describirContexto(e.contexto) + "\n\n" +
    (historialTxt ? "Conversación previa:\n" + historialTxt + "\n\n" : "") +
    "Pregunta nueva: " + e.pregunta + "\n\n" +
    "Devuelve este JSON:\n" +
    '{"tema":"materiales|monstruos|armas|armaduras|habilidades|sets|misiones|controles|comida|consumibles|acompanantes|apariencia|otro",' +
    '"preguntaCompleta":"la pregunta reescrita de forma completa y autónoma usando el contexto y la conversación",' +
    '"terminosIngles":"nombres clave en inglés oficial, o cadena vacía",' +
    '"busquedaVideoEs":"consulta corta para YouTube en español (incluye el nombre del juego)",' +
    '"busquedaVideoEn":"consulta corta para YouTube en inglés (incluye el nombre del juego)",' +
    '"aclaracion":"si la pregunta es imposible de responder sin un dato que solo el jugador sabe (p. ej. \'este material\' sin decir cuál), escribe aquí la pregunta breve que le harías; si no, cadena vacía",' +
    '"faltaContexto":[{"campo":"plataforma|arma|rango|avance","motivo":"por qué cambia la respuesta"}]}\n' +
    "Incluye en faltaContexto SOLO datos de contexto que no se conocen y que cambian de forma importante la respuesta. Si la pregunta se puede responder bien sin ellos, deja la lista vacía.";
  const r = await llamarIA({
    model: CFG.modeloRapido, max_tokens: 700, system: sistema,
    messages: [{ role: "user", content: usuario }]
  });
  const plan = extraerJSON(textoDe(r)) || {};
  return {
    tema: texto(plan.tema, 30) || "otro",
    preguntaCompleta: texto(plan.preguntaCompleta, 500) || e.pregunta,
    terminosIngles: texto(plan.terminosIngles, 200),
    busquedaVideoEs: texto(plan.busquedaVideoEs, 120) || e.juego.nombre + " " + e.pregunta,
    busquedaVideoEn: texto(plan.busquedaVideoEn, 120) || e.juego.nombre + " guide",
    aclaracion: texto(plan.aclaracion, 300),
    faltaContexto: lista(plan.faltaContexto, 4)
      .filter(f => f && ["plataforma", "arma", "rango", "avance"].includes(f.campo) && !e.contexto[f.campo])
      .map(f => ({ campo: f.campo, motivo: texto(f.motivo, 200) }))
  };
}

/* ------------------------------------------------------------ YouTube */

function duracionLegible(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
  if (!m) return "";
  const h = +m[1] || 0, mi = +m[2] || 0, s = +m[3] || 0;
  return (h ? h + ":" + String(mi).padStart(2, "0") : mi) + ":" + String(s).padStart(2, "0");
}

/* Capítulos que el propio creador puso en la descripción: son las únicas marcas de tiempo comprobadas */
function capitulos(descripcion) {
  const res = [];
  for (const linea of (descripcion || "").split(/\r?\n/)) {
    const m = linea.match(/^\s*[\[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*[-–—:|]?\s*(.{2,80})$/);
    if (m) res.push({ tiempo: m[1], tema: m[2].trim() });
  }
  return res.length >= 2 ? res.slice(0, 25) : [];
}

function segundos(t) {
  return t.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);
}

async function buscarVideos(consulta, idioma) {
  const p = new URLSearchParams({
    part: "snippet", type: "video", maxResults: "6", q: consulta,
    relevanceLanguage: idioma, safeSearch: "moderate", key: CFG.claveYoutube
  });
  const r = await fetch(CFG.urlYoutube + "/search?" + p);
  if (!r.ok) throw new Error("youtube_" + r.status);
  const d = await r.json();
  return (d.items || []).map(i => i.id && i.id.videoId).filter(Boolean);
}

async function detallesVideos(ids, idiomaBusqueda) {
  if (!ids.length) return [];
  const p = new URLSearchParams({ part: "snippet,contentDetails", id: ids.join(","), key: CFG.claveYoutube });
  const r = await fetch(CFG.urlYoutube + "/videos?" + p);
  if (!r.ok) throw new Error("youtube_" + r.status);
  const d = await r.json();
  return (d.items || []).map(v => {
    const s = v.snippet || {};
    const idiomaDeclarado = s.defaultAudioLanguage || s.defaultLanguage || "";
    return {
      id: v.id,
      titulo: s.title || "",
      canal: s.channelTitle || "",
      fecha: (s.publishedAt || "").slice(0, 10),
      idioma: idiomaDeclarado ? idiomaDeclarado.slice(0, 2).toLowerCase() : "",
      idiomaFuente: idiomaDeclarado ? "declarado por el canal" : "no declarado (búsqueda en " + idiomaBusqueda + ")",
      idiomaBusqueda,
      duracion: duracionLegible(v.contentDetails && v.contentDetails.duration),
      descripcion: (s.description || "").slice(0, 400),
      capitulos: capitulos(s.description),
      url: "https://www.youtube.com/watch?v=" + v.id,
      miniatura: "https://i.ytimg.com/vi/" + v.id + "/mqdefault.jpg"
    };
  });
}

async function candidatosVideo(plan) {
  if (!CFG.claveYoutube) return { videos: [], nota: "YouTube no configurado" };
  const [es, en] = await Promise.allSettled([
    buscarVideos(plan.busquedaVideoEs, "es"),
    buscarVideos(plan.busquedaVideoEn, "en")
  ]);
  const idsEs = es.status === "fulfilled" ? es.value : [];
  const idsEn = en.status === "fulfilled" ? en.value.filter(id => !idsEs.includes(id)) : [];
  const [dEs, dEn] = await Promise.allSettled([detallesVideos(idsEs, "es"), detallesVideos(idsEn, "en")]);
  const videos = [].concat(dEs.value || [], dEn.value || []);
  const fallo = [es, en, dEs, dEn].find(x => x.status === "rejected");
  return { videos, nota: fallo && !videos.length ? "Error al consultar YouTube" : "" };
}

/* ------------------------------------------------------------ Respuesta con búsqueda web */

const ESQUEMA_RESPUESTA = `{
"respuestaDirecta": "1 a 3 frases que responden directamente",
"pasos": ["paso 1", "paso 2"],
"requisitos": [{"texto":"material, requisito o desbloqueo", "tipo":"comprobado|recomendacion", "fuenteUrl":"URL de la búsqueda que lo respalda o cadena vacía"}],
"recomendaciones": ["consejos adaptados al jugador (opinión, no dato)"],
"terminos": [{"termino":"palabra técnica", "explicacion":"explicación sencilla"}],
"videos": [{"videoId":"id de la lista de candidatos", "porQue":"por qué responde la pregunta", "marcasTiempo":[{"tiempo":"m:ss copiado de los capítulos del video", "tema":"qué se ve ahí"}]}],
"guias": [{"url":"URL exacta de un resultado de búsqueda", "titulo":"", "sitio":"", "idioma":"es|en|otro", "fecha":"fecha visible o cadena vacía", "porQue":""}],
"fuentes": [{"url":"URL exacta de un resultado de búsqueda", "titulo":"", "sitio":""}],
"advertencias": ["contradicciones entre fuentes, datos que no se pudieron comprobar, diferencias de versión o idioma"],
"siguientePaso": "una acción concreta que el jugador puede hacer ahora",
"sinResultados": false
}`;

function promptSistema(e) {
  const j = e.juego;
  return [
    "Eres «Guía del Cazador», un asistente experto en Monster Hunter que responde en español claro de México/Latinoamérica.",
    "JUEGO: " + nombreCompleto(j, e.conExpansion) + ". " + describirJuego(j, e.conExpansion),
    "REGLA CRÍTICA: nunca mezcles mecánicas, materiales, monstruos, menús ni nombres de otro juego de la saga. Verifica que cada fuente corresponda a este juego" + (j.expansion ? " y a si aplica o no " + j.expansion.nombre : "") + ". Descarta fuentes de otro juego.",
    "BÚSQUEDA: usa la herramienta web_search para comprobar los datos. Prioriza, en este orden: documentación y notas de parche de Capcom; la base de datos Kiranico de este juego (" + j.fuentesPreferidas[0] + "); guías y tutoriales originales de creadores. Prefiere recursos en español; si el mejor está en otro idioma, indícalo y explica lo necesario en español.",
    "VERACIDAD: no inventes materiales, probabilidades, requisitos, funciones, títulos, autores ni enlaces. Usa en guias y fuentes SOLO URLs exactas que aparecieron en tus resultados de búsqueda. Los videos SOLO pueden ser de la lista de candidatos que te doy, por su videoId. Si ningún candidato encaja de verdad, deja videos vacío. Marcas de tiempo: SOLO si aparecen en los capítulos del candidato; si no, déjalas vacías.",
    "Distingue datos comprobados (tipo comprobado, con fuente) de recomendaciones (tipo recomendacion). Si faltan datos o hay contradicciones, explícalo en advertencias. Si no encuentras información fiable, pon sinResultados en true y explica en respuestaDirecta qué no se encontró.",
    "ADAPTACIÓN: ajusta todo al equipo, arma, rango y avance del jugador. No recomiendes equipo ni contenido que aún no pueda conseguir; si lo mencionas, aclara a partir de cuándo estará disponible. Explica los términos técnicos en terminos. Hasta 3 videos y hasta 2 guías.",
    "FORMATO: tu mensaje final debe ser ÚNICAMENTE un objeto JSON válido con esta forma (sin texto antes ni después, sin markdown):\n" + ESQUEMA_RESPUESTA
  ].join("\n\n");
}

function resumenCandidatos(videos) {
  if (!videos.length) return "No hay videos candidatos (lista vacía).";
  return videos.map(v =>
    "- videoId: " + v.id + " | título: " + v.titulo + " | canal: " + v.canal + " | fecha: " + v.fecha +
    " | idioma: " + (v.idioma || "no declarado, búsqueda en " + v.idiomaBusqueda) + " | duración: " + v.duracion +
    (v.capitulos.length ? " | capítulos: " + v.capitulos.map(c => c.tiempo + " " + c.tema).join("; ") : " | sin capítulos") +
    " | descripción: " + v.descripcion.replace(/\s+/g, " ").slice(0, 200)
  ).join("\n");
}

async function responder(e, plan, videos) {
  const historialTxt = e.historial.map(m => (m.rol === "usuario" ? "Jugador: " : "Guía: ") + m.texto).join("\n");
  const usuario =
    "Contexto del jugador:\n" + describirContexto(e.contexto) + "\n\n" +
    (historialTxt ? "Conversación previa (para preguntas de seguimiento):\n" + historialTxt + "\n\n" : "") +
    "Pregunta del jugador: " + e.pregunta + "\n" +
    "Interpretación: " + plan.preguntaCompleta + (plan.terminosIngles ? "\nTérminos en inglés: " + plan.terminosIngles : "") + "\n\n" +
    "Videos candidatos de YouTube (datos reales de la API de YouTube):\n" + resumenCandidatos(videos) + "\n\n" +
    "Busca en la web, verifica y responde con el JSON indicado.";

  const herramientas = [{ type: "web_search_20250305", name: "web_search", max_uses: CFG.busquedasMax }];
  const mensajes = [{ role: "user", content: usuario }];
  const resultados = new Map(); // url normalizada -> {url,titulo,fecha}
  const consultas = [];
  let final = null;

  for (let vuelta = 0; vuelta < 4; vuelta++) {
    const r = await llamarIA({ model: CFG.modelo, max_tokens: 4000, system: promptSistema(e), tools: herramientas, messages: mensajes });
    for (const b of r.content || []) {
      if (b.type === "server_tool_use" && b.input && b.input.query) consultas.push(b.input.query);
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const it of b.content) {
          if (it && it.url) resultados.set(normalizarUrl(it.url), { url: it.url, titulo: it.title || "", fecha: it.page_age || "" });
        }
      }
    }
    final = r;
    if (r.stop_reason !== "pause_turn") break;
    mensajes.push({ role: "assistant", content: r.content });
  }

  // El JSON es el último texto después de la última búsqueda
  const bloques = (final && final.content) || [];
  let ultimo = -1;
  bloques.forEach((b, i) => { if (b.type === "web_search_tool_result") ultimo = i; });
  const textoFinal = bloques.slice(ultimo + 1).filter(b => b.type === "text").map(b => b.text).join("") || textoDe(final || {});
  return { datos: extraerJSON(textoFinal), resultados, consultas };
}

/* Revisa todo lo que devolvió el modelo: solo pasan enlaces y videos comprobados */
function validar(datos, resultados, videos, e, plan) {
  const avisos = [];
  const d = datos || {};
  const porId = new Map(videos.map(v => [v.id, v]));

  const verificarUrl = u => resultados.get(normalizarUrl(u));

  const guias = [];
  for (const g of lista(d.guias, 4)) {
    const r = g && verificarUrl(g.url);
    if (!r) { if (g && g.url) avisos.push("Se descartó una guía porque su enlace no salió de una búsqueda real."); continue; }
    if (guias.some(x => normalizarUrl(x.url) === normalizarUrl(r.url))) continue;
    guias.push({ url: r.url, titulo: texto(g.titulo, 160) || r.titulo, sitio: sitioDe(r.url), idioma: texto(g.idioma, 10) || "no indicado", fecha: texto(g.fecha, 40) || r.fecha || "", porQue: texto(g.porQue, 300) });
    if (guias.length === 2) break;
  }

  const fuentes = [];
  for (const f of lista(d.fuentes, 10)) {
    const r = f && verificarUrl(f.url);
    if (!r || fuentes.some(x => x.url === r.url)) continue;
    fuentes.push({ url: r.url, titulo: texto(f.titulo, 160) || r.titulo, sitio: sitioDe(r.url), fecha: r.fecha });
  }

  const vids = [];
  for (const v of lista(d.videos, 5)) {
    const c = v && porId.get(v.videoId);
    if (!c) { if (v && v.videoId) avisos.push("Se descartó un video que no estaba entre los resultados reales de YouTube."); continue; }
    if (vids.some(x => x.id === c.id)) continue;
    const validos = new Set(c.capitulos.map(k => k.tiempo));
    const marcas = lista(v.marcasTiempo, 6)
      .filter(m => m && validos.has(String(m.tiempo).trim()))
      .map(m => ({ tiempo: String(m.tiempo).trim(), tema: texto(m.tema, 100), url: c.url + "&t=" + segundos(String(m.tiempo).trim()) + "s" }));
    vids.push({
      id: c.id, url: c.url, miniatura: c.miniatura, titulo: c.titulo, canal: c.canal, fecha: c.fecha,
      idioma: c.idioma || "no declarado", idiomaFuente: c.idiomaFuente, duracion: c.duracion,
      porQue: texto(v.porQue, 300), marcasTiempo: marcas
    });
    if (vids.length === 3) break;
  }

  const requisitos = lista(d.requisitos, 15).map(r => {
    if (typeof r === "string") return { texto: texto(r, 300), tipo: "recomendacion", fuenteUrl: "" };
    const fuente = r && r.fuenteUrl ? verificarUrl(r.fuenteUrl) : null;
    const tipo = r && r.tipo === "comprobado" && fuente ? "comprobado" : "recomendacion";
    return { texto: texto(r && r.texto, 300), tipo, fuenteUrl: fuente ? fuente.url : "" };
  }).filter(r => r.texto);

  // Las fuentes que respaldan requisitos también se listan
  for (const r of requisitos) {
    if (r.fuenteUrl && !fuentes.some(f => f.url === r.fuenteUrl)) {
      const x = verificarUrl(r.fuenteUrl);
      fuentes.push({ url: x.url, titulo: x.titulo, sitio: sitioDe(x.url), fecha: x.fecha });
    }
  }

  const busquedasSugeridas = [];
  if (!vids.length) {
    busquedasSugeridas.push({ tipo: "busqueda", titulo: "Buscar en YouTube (español): " + plan.busquedaVideoEs, url: urlBusquedaYoutube(plan.busquedaVideoEs) });
    busquedasSugeridas.push({ tipo: "busqueda", titulo: "Buscar en YouTube (inglés): " + plan.busquedaVideoEn, url: urlBusquedaYoutube(plan.busquedaVideoEn) });
  }

  return {
    respuestaDirecta: texto(d.respuestaDirecta, 900),
    pasos: lista(d.pasos, 15).map(p => texto(p, 400)).filter(Boolean),
    requisitos,
    recomendaciones: lista(d.recomendaciones, 8).map(p => texto(p, 400)).filter(Boolean),
    terminos: lista(d.terminos, 8).filter(t => t && t.termino).map(t => ({ termino: texto(t.termino, 60), explicacion: texto(t.explicacion, 300) })),
    videos: vids,
    guias,
    fuentes: fuentes.slice(0, 8),
    busquedasSugeridas,
    advertencias: lista(d.advertencias, 6).map(a => texto(a, 400)).filter(Boolean).concat([...new Set(avisos)]),
    siguientePaso: texto(d.siguientePaso, 400),
    sinResultados: !!d.sinResultados || (!d.respuestaDirecta && !vids.length && !guias.length)
  };
}

/* ------------------------------------------------------------ Modo demostración */

function respuestaDemo(e) {
  const q = e.juego.nombre + " " + e.pregunta;
  return {
    modo: "demo",
    tipo: "demo",
    juego: nombreCompleto(e.juego, e.conExpansion),
    aviso: "MODO DEMOSTRACIÓN: el servidor no tiene configurada la clave de IA (ANTHROPIC_API_KEY), así que no se hizo ninguna búsqueda real ni se generó una explicación. Solo se muestran enlaces de búsqueda sin verificar.",
    busquedasSugeridas: [
      { tipo: "busqueda", titulo: "Buscar en YouTube: " + q, url: urlBusquedaYoutube(q) },
      { tipo: "busqueda", titulo: "Buscar en " + e.juego.fuentesPreferidas[0], url: "https://www.google.com/search?q=" + encodeURIComponent("site:" + e.juego.fuentesPreferidas[0] + " " + e.pregunta) }
    ]
  };
}

/* ------------------------------------------------------------ Endpoint principal */

async function preguntar(cuerpo) {
  const e = limpiarEntrada(cuerpo);
  if (!CFG.claveIA) return respuestaDemo(e);

  const plan = await comprender(e);
  const base = { modo: "real", juego: nombreCompleto(e.juego, e.conExpansion), interpretacion: plan.preguntaCompleta, tema: plan.tema };

  if (plan.aclaracion) return Object.assign(base, { tipo: "aclaracion", aclaracion: plan.aclaracion, faltaContexto: plan.faltaContexto });
  if (plan.faltaContexto.length) return Object.assign(base, { tipo: "contexto", faltaContexto: plan.faltaContexto });

  const { videos, nota } = await candidatosVideo(plan);
  const { datos, resultados, consultas } = await responder(e, plan, videos);
  if (!datos) {
    const err = new Error("respuesta_ilegible");
    throw err;
  }
  const r = validar(datos, resultados, videos, e, plan);
  if (nota) r.advertencias.push(nota === "YouTube no configurado"
    ? "Los videos no se buscaron porque falta configurar YOUTUBE_API_KEY en el servidor; se ofrecen búsquedas de YouTube sin verificar."
    : "No se pudo consultar YouTube en este momento; se ofrecen búsquedas sin verificar.");
  return Object.assign(base, { tipo: r.sinResultados ? "sin_resultados" : "respuesta", busquedasWeb: consultas, resultadosRevisados: resultados.size }, r);
}

const MENSAJES_ERROR = {
  juego_invalido: [400, "Selecciona un juego válido."],
  pregunta_vacia: [400, "Escribe una pregunta."],
  demasiado_grande: [413, "La consulta es demasiado larga."],
  json_invalido: [400, "La solicitud no es válida."],
  respuesta_ilegible: [502, "La IA respondió en un formato que no se pudo leer. Intenta de nuevo."]
};

/* ------------------------------------------------------------ Archivos estáticos */

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

function estatico(req, res) {
  let ruta = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (ruta === "/") ruta = "/index.html";
  const archivo = path.normalize(path.join(DIR_PUBLICO, ruta));
  if (!archivo.startsWith(DIR_PUBLICO)) { res.writeHead(403); return res.end(); }
  fs.readFile(archivo, (err, datos) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("No encontrado"); }
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(archivo)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(datos);
  });
}

/* ------------------------------------------------------------ Servidor */

const servidor = http.createServer(async (req, res) => {
  const h = cors(req);
  const ruta = new URL(req.url, "http://x").pathname;
  if (req.method === "OPTIONS") { res.writeHead(204, h); return res.end(); }

  if (ruta === "/api/estado") {
    return json(res, 200, { ok: true, version: VERSION, ia: !!CFG.claveIA, youtube: !!CFG.claveYoutube, modelo: CFG.claveIA ? CFG.modelo : null, juegos: Object.keys(JUEGOS) }, h);
  }

  if (ruta === "/api/preguntar") {
    if (req.method !== "POST") return json(res, 405, { error: "Usa POST." }, h);
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    if (limiteExcedido(ip)) return json(res, 429, { error: "Hiciste muchas preguntas en poco tiempo. Espera unos minutos." }, h);
    try {
      const crudo = await leerCuerpo(req);
      let cuerpo;
      try { cuerpo = JSON.parse(crudo); } catch (_) { throw new Error("json_invalido"); }
      const r = await preguntar(cuerpo);
      return json(res, 200, r, h);
    } catch (err) {
      const conocido = MENSAJES_ERROR[err.message];
      if (conocido) return json(res, conocido[0], { error: conocido[1] }, h);
      console.error("[error]", err.message, err.detalle || "");
      if (/^ia_(401|403)$/.test(err.message)) return json(res, 502, { error: "La clave de IA del servidor no es válida. Revisa ANTHROPIC_API_KEY." }, h);
      if (err.message === "ia_429") return json(res, 503, { error: "El servicio de IA está saturado. Intenta en un minuto." }, h);
      return json(res, 502, { error: "No se pudo completar la búsqueda. Intenta de nuevo en un momento." }, h);
    }
  }

  if (req.method === "GET") return estatico(req, res);
  json(res, 404, { error: "No encontrado" }, h);
});

if (require.main === module) {
  servidor.listen(CFG.puerto, () => {
    console.log("Guía del Cazador en http://localhost:" + CFG.puerto);
    if (!CFG.claveIA) console.log("AVISO: falta ANTHROPIC_API_KEY → la app funciona en MODO DEMOSTRACIÓN.");
    if (!CFG.claveYoutube) console.log("AVISO: falta YOUTUBE_API_KEY → no se buscarán videos verificados.");
  });
}

module.exports = { servidor, validar, capitulos, normalizarUrl, extraerJSON };
