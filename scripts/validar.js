/*
 * Valida un servidor REAL con las 4 preguntas de referencia.
 * Uso:  node scripts/validar.js https://tu-servidor.onrender.com
 *       (sin argumento usa http://localhost:3000)
 * Gasta créditos de la API de IA y cuota de YouTube.
 */
"use strict";
const base = (process.argv[2] || "http://localhost:3000").replace(/\/+$/, "");
const contexto = { plataforma: "PC (Steam)", arma: "Espada larga", rango: "Rango alto", avance: "RC 30", sinSpoilers: true };
const casos = [
  { juego: "mhw", expansion: true, pregunta: "¿Cómo cambio la apariencia de mi armadura sin perder sus estadísticas?" },
  { juego: "mhw", expansion: false, pregunta: "¿Dónde consigo este material?" },
  { juego: "mhwilds", pregunta: "Enséñame a usar mi arma con un video." },
  { juego: "mhw", expansion: false, pregunta: "¿Qué armadura me conviene con mi rango actual?" },
  { juego: "mhwilds", pregunta: "asdfgh qwerty monstruo inexistente" }
];

(async () => {
  const estado = await fetch(base + "/api/estado").then(r => r.json()).catch(e => ({ error: e.message }));
  console.log("Servidor:", base, JSON.stringify(estado));
  for (const c of casos) {
    const t0 = Date.now();
    const r = await fetch(base + "/api/preguntar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ contexto }, c)) });
    const d = await r.json();
    console.log("\n=== " + c.pregunta + " [" + c.juego + (c.expansion ? "+Iceborne" : "") + "] " + r.status + " · " + ((Date.now() - t0) / 1000).toFixed(1) + " s");
    console.log("Tipo:", d.tipo || d.modo || "error", "| Juego:", d.juego || "-");
    if (d.error) console.log("Error:", d.error);
    if (d.aclaracion) console.log("Aclaración:", d.aclaracion);
    if (d.faltaContexto && d.faltaContexto.length) console.log("Falta:", d.faltaContexto.map(f => f.campo).join(", "));
    if (d.respuestaDirecta) console.log("Respuesta:", d.respuestaDirecta);
    (d.videos || []).forEach(v => console.log("  Video:", v.titulo, "—", v.canal, "(" + v.idioma + ")", v.url));
    (d.guias || []).forEach(g => console.log("  Guía:", g.titulo, "—", g.url));
    (d.fuentes || []).forEach(f => console.log("  Fuente:", f.url));
    (d.advertencias || []).forEach(a => console.log("  Aviso:", a));
  }
})();
