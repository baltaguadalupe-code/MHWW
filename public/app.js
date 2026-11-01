/* Guía del Cazador — lógica de la interfaz (sin dependencias) */
(function () {
  "use strict";

  /* ------------------------------------------------ almacenamiento local */
  var CLAVES = { tema: "gdc_tema", juego: "gdc_juego", servidor: "gdc_servidor", conversaciones: "gdc_conversaciones", favoritos: "gdc_favoritos", contexto: "gdc_contexto_" };
  function leer(clave, porDefecto) {
    try { var v = localStorage.getItem(clave); return v === null ? porDefecto : JSON.parse(v); } catch (_) { return porDefecto; }
  }
  function guardar(clave, valor) { try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (_) {} }
  function borrar(clave) { try { localStorage.removeItem(clave); } catch (_) {} }

  /* ------------------------------------------------ utilidades DOM */
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "texto") n.textContent = v;
      else if (k === "clase") n.className = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (var i = 2; i < arguments.length; i++) {
      var h = arguments[i];
      if (h === null || h === undefined || h === false) continue;
      if (Array.isArray(h)) h.forEach(function (x) { if (x) n.appendChild(typeof x === "string" ? document.createTextNode(x) : x); });
      else n.appendChild(typeof h === "string" ? document.createTextNode(h) : h);
    }
    return n;
  }
  function svgIcono(d) {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.innerHTML = d;
    return s;
  }
  var ICONO_ESTRELLA = '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>';
  var ICONO_BORRAR = '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>';
  var ICONO_BUSCAR = '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>';

  function urlSegura(u) { return /^https?:\/\//i.test(u || "") ? u : null; }
  function enlace(url, contenido, clase) {
    var seguro = urlSegura(url);
    if (!seguro) return el("span", { clase: clase }, contenido);
    return el("a", { href: seguro, target: "_blank", rel: "noopener noreferrer", clase: clase }, contenido);
  }
  function nombreIdioma(c) {
    var m = { es: "Español", en: "Inglés", ja: "Japonés", pt: "Portugués", fr: "Francés", de: "Alemán", it: "Italiano" };
    return m[c] || (c && c !== "no declarado" && c !== "no indicado" ? c : "Idioma no declarado");
  }
  function fechaCorta(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "numeric" });
  }
  function id() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* ------------------------------------------------ estado */
  var estado = {
    juego: leer(CLAVES.juego, { id: "mhw", expansion: true }),
    conversacion: null,
    enviando: false,
    servidorInfo: null
  };
  if (!window.JUEGOS[estado.juego.id]) estado.juego = { id: "mhw", expansion: true };

  function juegoActual() { return window.JUEGOS[estado.juego.id]; }
  function nombreJuego() {
    var j = juegoActual();
    if (!j.expansion) return j.nombre;
    return j.nombre + (estado.juego.expansion ? " + " + j.expansion.nombre : " (sin " + j.expansion.nombre + ")");
  }
  function contexto() {
    return leer(CLAVES.contexto + estado.juego.id, { plataforma: "", arma: "", rango: "", avance: "", sinSpoilers: true });
  }
  function guardarContexto(c) { guardar(CLAVES.contexto + estado.juego.id, c); pintarContexto(); }

  /* ------------------------------------------------ servidor */
  function esAppNativa() {
    return !!window.Capacitor || location.protocol === "file:" || location.protocol === "capacitor:" || !!window.esElectron;
  }
  function servidor() {
    var propio = leer(CLAVES.servidor, "");
    var base = propio || (window.GUIA_CONFIG && window.GUIA_CONFIG.servidor) || "";
    return base.replace(/\/+$/, "");
  }
  function servidorDisponible() { return servidor() !== "" || !esAppNativa(); }

  function pedir(ruta, opciones) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, (opciones && opciones.espera) || 120000);
    return fetch(servidor() + ruta, Object.assign({ signal: ctrl.signal }, opciones))
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) { var e = new Error(d.error || "Error del servidor (" + r.status + ")"); e.http = r.status; throw e; }
          return d;
        });
      })
      .catch(function (e) {
        if (e.name === "AbortError") throw new Error("El servidor tardó demasiado en responder. Intenta de nuevo.");
        if (e.http) throw e;
        throw new Error("No se pudo conectar con el servidor. Revisa tu conexión o la dirección del servidor en Ajustes.");
      })
      .finally(function () { clearTimeout(t); });
  }

  function revisarServidor() {
    var aviso = $("aviso-servidor");
    aviso.hidden = true; aviso.className = "aviso"; aviso.textContent = "";
    if (!servidorDisponible()) {
      aviso.hidden = false;
      aviso.append("Falta configurar la dirección del servidor para buscar respuestas.");
      aviso.appendChild(el("button", { clase: "boton sec", type: "button", onclick: function () { abrirPanel("ajustes"); } }, "Abrir Ajustes"));
      return;
    }
    pedir("/api/estado", { espera: 15000 }).then(function (info) {
      estado.servidorInfo = info;
      if (!info.ia) {
        aviso.hidden = false;
        aviso.textContent = "Modo demostración: el servidor aún no tiene configurada la clave de IA, así que no hace búsquedas reales ni explicaciones. Solo verás enlaces de búsqueda sin verificar.";
      } else if (!info.youtube) {
        aviso.hidden = false;
        aviso.textContent = "Los videos de YouTube no están activados en el servidor (falta YOUTUBE_API_KEY). Las respuestas y guías sí usan búsqueda real.";
      }
    }).catch(function (e) {
      aviso.hidden = false; aviso.className = "aviso error";
      aviso.textContent = e.message;
      aviso.appendChild(el("button", { clase: "boton sec", type: "button", onclick: revisarServidor }, "Reintentar"));
    });
  }

  /* ------------------------------------------------ tema */
  function aplicarTema() {
    var t = leer(CLAVES.tema, "");
    if (t) document.documentElement.setAttribute("data-tema", t);
    else document.documentElement.removeAttribute("data-tema");
  }
  function alternarTema() {
    var oscuroAhora = document.documentElement.getAttribute("data-tema") === "oscuro" ||
      (!document.documentElement.getAttribute("data-tema") && window.matchMedia("(prefers-color-scheme: dark)").matches);
    guardar(CLAVES.tema, oscuroAhora ? "claro" : "oscuro");
    aplicarTema();
  }

  /* ------------------------------------------------ barra de juego y contexto */
  function pintarSelectorJuego() {
    var cont = $("selector-juego");
    cont.innerHTML = "";
    Object.keys(window.JUEGOS).forEach(function (clave) {
      var j = window.JUEGOS[clave];
      cont.appendChild(el("button", {
        type: "button", role: "radio", "aria-checked": String(clave === estado.juego.id),
        onclick: function () { cambiarJuego(clave, estado.juego.expansion); }
      }, j.corto));
    });
    var j = juegoActual();
    $("caja-expansion").hidden = !j.expansion;
    if (j.expansion) { $("nombre-expansion").textContent = j.expansion.nombre; $("chk-expansion").checked = !!estado.juego.expansion; }
    $("jugando").textContent = nombreJuego();
  }

  function cambiarJuego(clave, expansion) {
    var cambio = clave !== estado.juego.id || !!expansion !== !!estado.juego.expansion;
    estado.juego = { id: clave, expansion: !!expansion };
    guardar(CLAVES.juego, estado.juego);
    pintarSelectorJuego();
    pintarContexto();
    // Cada juego tiene su propia conversación para no mezclar mecánicas
    if (cambio) nuevaConversacion();
  }

  var CAMPOS = { plataforma: "Plataforma", arma: "Arma", rango: "Rango", avance: "Avance" };

  function pintarContexto() {
    var c = contexto(), cont = $("chips-contexto");
    cont.innerHTML = "";
    Object.keys(CAMPOS).forEach(function (k) {
      cont.appendChild(el("button", { type: "button", clase: "chip" + (c[k] ? " lleno" : ""), onclick: function () { abrirPanel("contexto"); } },
        c[k] ? c[k] : "+ " + CAMPOS[k]));
    });
    cont.appendChild(el("button", { type: "button", clase: "chip lleno", title: "Cambiar modo de spoilers", onclick: function () {
      var x = contexto(); x.sinSpoilers = !x.sinSpoilers; guardarContexto(x);
    } }, c.sinSpoilers ? "🛡 Sin spoilers" : "Spoilers permitidos"));
  }

  function opcionesCampo(campo) {
    var j = juegoActual();
    if (campo === "plataforma") return j.plataformas;
    if (campo === "arma") return j.armas;
    if (campo === "rango") return j.rangos.concat(estado.juego.expansion ? j.rangosExpansion : []);
    return null;
  }

  function controlCampo(campo, valor) {
    var ops = opcionesCampo(campo);
    if (!ops) return el("input", { type: "text", "data-campo": campo, value: valor || "", maxlength: "120", placeholder: "Ej.: RC 25, acabo de terminar la historia" });
    var s = el("select", { "data-campo": campo }, el("option", { value: "" }, "Sin indicar"));
    ops.forEach(function (o) { s.appendChild(el("option", { value: o, selected: o === valor }, o)); });
    return s;
  }

  /* ------------------------------------------------ conversaciones */
  function nuevaConversacion() {
    estado.conversacion = { id: id(), juego: estado.juego.id, expansion: estado.juego.expansion, nombreJuego: nombreJuego(), titulo: "", fecha: Date.now(), mensajes: [] };
    pintarChat();
  }

  function guardarConversacion() {
    var c = estado.conversacion;
    if (!c || !c.mensajes.length) return;
    var todas = leer(CLAVES.conversaciones, []).filter(function (x) { return x.id !== c.id; });
    c.fecha = Date.now();
    todas.unshift(c);
    guardar(CLAVES.conversaciones, todas.slice(0, 60));
  }

  function historialParaServidor() {
    return estado.conversacion.mensajes.slice(-7, -1).map(function (m) {
      if (m.rol === "usuario") return { rol: "usuario", texto: m.texto };
      var d = m.datos || {};
      return { rol: "asistente", texto: d.respuestaDirecta || d.aclaracion || d.error || "" };
    }).filter(function (m) { return m.texto; });
  }

  function enviar(pregunta) {
    pregunta = (pregunta || "").trim();
    if (!pregunta || estado.enviando) return;
    if (!servidorDisponible()) { abrirPanel("ajustes"); return; }
    var c = estado.conversacion;
    if (!c.titulo) c.titulo = pregunta.slice(0, 80);
    c.mensajes.push({ rol: "usuario", texto: pregunta });
    var asistente = { rol: "asistente", estado: "cargando", pregunta: pregunta, id: id() };
    c.mensajes.push(asistente);
    pintarChat();
    estado.enviando = true; $("btn-enviar").disabled = true;

    pedir("/api/preguntar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ juego: c.juego, expansion: c.expansion, pregunta: pregunta, contexto: contexto(), historial: historialParaServidor() })
    }).then(function (d) {
      asistente.estado = "listo"; asistente.datos = d;
    }).catch(function (e) {
      asistente.estado = "error"; asistente.datos = { error: e.message };
    }).finally(function () {
      estado.enviando = false; $("btn-enviar").disabled = false;
      guardarConversacion();
      pintarChat();
    });
  }

  /* ------------------------------------------------ pintado del chat */
  function pintarChat() {
    var chat = $("chat"), c = estado.conversacion;
    chat.innerHTML = "";
    if (!c.mensajes.length) { chat.appendChild(bienvenida()); return; }
    c.mensajes.forEach(function (m, i) {
      if (m.rol === "usuario") chat.appendChild(el("div", { clase: "msg usuario" }, el("div", { clase: "burbuja" }, m.texto)));
      else chat.appendChild(el("div", { clase: "msg" }, tarjetaAsistente(m, i === c.mensajes.length - 1)));
    });
    var ultimo = chat.lastElementChild;
    if (ultimo) ultimo.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function bienvenida() {
    var j = juegoActual();
    return el("section", { clase: "bienvenida" },
      el("h1", { texto: "¿Qué necesitas, cazador?" }),
      el("p", { texto: "Pregunta sobre materiales, monstruos, armas, sets, misiones, controles o apariencia de " + nombreJuego() + ". Te respondo con pasos, fuentes y videos comprobados." }),
      el("div", { clase: "sugerencias" }, j.sugerencias.map(function (s) {
        return el("button", { type: "button", clase: "sugerencia", onclick: function () { enviar(s); } }, s);
      }))
    );
  }

  function cabecera(m, d) {
    var esFav = esFavorito(m.id);
    var boton = el("button", { type: "button", clase: "icono" + (esFav ? " activo" : ""), title: esFav ? "Quitar de favoritos" : "Guardar en favoritos", "aria-label": "Favorito",
      onclick: function () { alternarFavorito(m); pintarChat(); } }, svgIcono(ICONO_ESTRELLA));
    return el("div", { clase: "tarjeta-cabeza" },
      el("span", { clase: "etiqueta juego" }, (d && d.juego) || estado.conversacion.nombreJuego),
      d && d.modo === "demo" ? el("span", { clase: "etiqueta alerta" }, "Modo demostración") : null,
      d && d.modo === "real" && d.busquedasWeb ? el("span", { clase: "etiqueta" }, d.busquedasWeb.length + " búsquedas · " + (d.resultadosRevisados || 0) + " páginas revisadas") : null,
      m.estado === "listo" && d && d.tipo !== "aclaracion" && d.tipo !== "contexto" ? boton : null
    );
  }

  function tarjetaAsistente(m, esUltimo) {
    if (m.estado === "cargando") {
      return el("div", { clase: "tarjeta" }, el("div", { clase: "cargando" }, el("div", { clase: "giro" }),
        el("div", null, el("b", null, "Buscando fuentes y videos…"), el("div", { texto: "Reviso documentación, Kiranico y tutoriales de " + estado.conversacion.nombreJuego + ". Puede tardar hasta un minuto." }))));
    }
    var d = m.datos || {};
    if (m.estado === "error") {
      return el("div", { clase: "tarjeta error" },
        el("p", { clase: "respuesta-directa", texto: "No pude completar la búsqueda" }),
        el("p", { texto: d.error }),
        esUltimo ? el("div", { clase: "fila-botones" }, el("button", { type: "button", clase: "boton", onclick: function () { reintentar(m); } }, "Reintentar")) : null);
    }
    if (d.modo === "demo") return tarjetaDemo(m, d);
    if (d.tipo === "aclaracion" || d.tipo === "contexto") return tarjetaPedirDatos(m, d, esUltimo);
    return tarjetaRespuesta(m, d);
  }

  function reintentar(m) {
    var c = estado.conversacion;
    c.mensajes = c.mensajes.filter(function (x) { return x !== m; });
    var u = c.mensajes.pop();
    pintarChat();
    if (u) enviar(u.texto);
  }

  function tarjetaDemo(m, d) {
    return el("div", { clase: "tarjeta demo" }, cabecera(m, d),
      el("p", { clase: "respuesta-directa", texto: "Sin búsqueda real (modo demostración)" }),
      el("p", { texto: d.aviso }),
      seccionBusquedas(d.busquedasSugeridas));
  }

  function tarjetaPedirDatos(m, d, esUltimo) {
    var cont = el("div", { clase: "tarjeta" }, cabecera(m, d));
    var c = contexto();
    if (d.tipo === "aclaracion") {
      cont.appendChild(el("p", { clase: "respuesta-directa", texto: d.aclaracion }));
      cont.appendChild(el("p", { clase: "interpretacion", texto: "Escribe la respuesta abajo y continúo con la búsqueda." }));
    } else {
      cont.appendChild(el("p", { clase: "respuesta-directa", texto: "Para darte una respuesta útil necesito un dato más:" }));
    }
    var faltan = (d.faltaContexto || []).filter(function (f) { return CAMPOS[f.campo]; });
    if (faltan.length && esUltimo) {
      var fila = el("div", { clase: "pregunta-contexto" });
      faltan.forEach(function (f) {
        fila.appendChild(el("label", null, CAMPOS[f.campo] + (f.motivo ? " — " + f.motivo : ""), controlCampo(f.campo, c[f.campo])));
      });
      fila.appendChild(el("button", { type: "button", clase: "boton", onclick: function () {
        var x = contexto();
        fila.querySelectorAll("[data-campo]").forEach(function (inp) { x[inp.getAttribute("data-campo")] = inp.value.trim(); });
        guardarContexto(x);
        enviar(m.pregunta);
      } }, "Continuar"));
      cont.appendChild(fila);
    } else if (faltan.length) {
      cont.appendChild(el("ul", null, faltan.map(function (f) { return el("li", { texto: CAMPOS[f.campo] + (f.motivo ? ": " + f.motivo : "") }); })));
    }
    return cont;
  }

  function seccion(titulo, contenido) {
    if (!contenido) return null;
    return el("div", { clase: "seccion" }, el("h3", { texto: titulo }), contenido);
  }

  function seccionBusquedas(busquedas) {
    if (!busquedas || !busquedas.length) return null;
    return seccion("Búsquedas sugeridas (no son tutoriales verificados)", el("div", { clase: "recursos" }, busquedas.map(function (b) {
      return enlace(b.url, [svgIcono(ICONO_BUSCAR), el("span", { texto: b.titulo })], "busqueda-link");
    })));
  }

  function tarjetaVideo(v) {
    var meta = [v.canal, nombreIdioma(v.idioma) + (v.idioma === "no declarado" ? "" : ""), fechaCorta(v.fecha), v.duracion].filter(Boolean).join(" · ");
    var aviso = v.idioma && v.idioma !== "es" ? (v.idioma === "no declarado" ? " (el canal no declara el idioma)" : " — está en otro idioma; arriba te explico lo necesario en español") : "";
    var cuerpo = el("div", null,
      el("div", { clase: "recurso-titulo", texto: v.titulo }),
      el("div", { clase: "recurso-meta", texto: "YouTube · " + meta + aviso }),
      v.porQue ? el("p", { clase: "recurso-porque", texto: v.porQue }) : null);
    if (v.marcasTiempo && v.marcasTiempo.length) {
      cuerpo.appendChild(el("div", { clase: "marcas" }, v.marcasTiempo.map(function (t) {
        return enlace(t.url, t.tiempo + " " + t.tema);
      })));
    }
    var a = enlace(v.url, [el("img", { src: v.miniatura, alt: "", loading: "lazy" }), cuerpo], "recurso");
    return a;
  }

  function tarjetaGuia(g) {
    var meta = [g.sitio, nombreIdioma(g.idioma), g.fecha].filter(Boolean).join(" · ");
    return enlace(g.url, el("div", null,
      el("div", { clase: "recurso-titulo", texto: g.titulo || g.sitio }),
      el("div", { clase: "recurso-meta", texto: meta + (g.idioma && g.idioma !== "es" ? " — en otro idioma" : "") }),
      g.porQue ? el("p", { clase: "recurso-porque", texto: g.porQue }) : null), "recurso sin-imagen");
  }

  function tarjetaRespuesta(m, d) {
    var t = el("div", { clase: "tarjeta" }, cabecera(m, d));
    if (d.tipo === "sin_resultados") t.appendChild(el("span", { clase: "etiqueta alerta" }, "Sin resultados fiables"));
    t.appendChild(el("p", { clase: "respuesta-directa", texto: d.respuestaDirecta || "No encontré información fiable para esta pregunta." }));
    if (d.interpretacion && d.interpretacion !== m.pregunta) t.appendChild(el("p", { clase: "interpretacion", texto: "Entendí: " + d.interpretacion }));

    if (d.pasos && d.pasos.length) t.appendChild(seccion("Paso a paso", el("ol", null, d.pasos.map(function (p) { return el("li", { texto: p }); }))));

    if (d.requisitos && d.requisitos.length) {
      t.appendChild(seccion("Lo que necesitas", el("ul", null, d.requisitos.map(function (r) {
        return el("li", { clase: "requisito" },
          el("span", { clase: "etiqueta " + (r.tipo === "comprobado" ? "ok" : "info") }, r.tipo === "comprobado" ? "Comprobado" : "Recomendación"),
          el("span", null, r.texto, r.fuenteUrl ? [" ", enlace(r.fuenteUrl, "(fuente)")] : null));
      }))));
    }

    if (d.recomendaciones && d.recomendaciones.length) t.appendChild(seccion("Consejos para tu partida", el("ul", null, d.recomendaciones.map(function (p) { return el("li", { texto: p }); }))));

    if (d.terminos && d.terminos.length) {
      var dl = el("dl", { clase: "terminos" });
      d.terminos.forEach(function (x) { dl.appendChild(el("dt", { texto: x.termino })); dl.appendChild(el("dd", { texto: x.explicacion })); });
      t.appendChild(seccion("Términos explicados", dl));
    }

    if (d.videos && d.videos.length) t.appendChild(seccion("Videos", el("div", { clase: "recursos" }, d.videos.map(tarjetaVideo))));
    if (d.guias && d.guias.length) t.appendChild(seccion("Guías escritas", el("div", { clase: "recursos" }, d.guias.map(tarjetaGuia))));
    var b = seccionBusquedas(d.busquedasSugeridas);
    if (b) t.appendChild(b);

    if (d.fuentes && d.fuentes.length) {
      t.appendChild(seccion("Fuentes", el("ul", { clase: "fuentes" }, d.fuentes.map(function (f) {
        return el("li", null, enlace(f.url, f.titulo || f.url), el("span", { clase: "sitio", texto: " — " + f.sitio + (f.fecha ? " · " + f.fecha : "") }));
      }))));
    }

    if (d.advertencias && d.advertencias.length) t.appendChild(seccion("Ten en cuenta", el("ul", { clase: "advertencias" }, d.advertencias.map(function (a) { return el("li", { texto: a }); }))));
    if (d.siguientePaso) t.appendChild(el("div", { clase: "seccion siguiente" }, el("b", null, "Siguiente paso: "), d.siguientePaso));
    return t;
  }

  /* ------------------------------------------------ favoritos */
  function favoritos() { return leer(CLAVES.favoritos, []); }
  function esFavorito(mid) { return favoritos().some(function (f) { return f.id === mid; }); }
  function alternarFavorito(m) {
    var lista = favoritos();
    if (lista.some(function (f) { return f.id === m.id; })) lista = lista.filter(function (f) { return f.id !== m.id; });
    else lista.unshift({ id: m.id, pregunta: m.pregunta, juego: estado.conversacion.nombreJuego, fecha: Date.now(), datos: m.datos });
    guardar(CLAVES.favoritos, lista.slice(0, 100));
  }

  /* ------------------------------------------------ panel lateral */
  function abrirPanel(tipo) {
    var cuerpo = $("panel-cuerpo");
    cuerpo.innerHTML = "";
    var titulos = { historial: "Historial", favoritos: "Favoritos", ajustes: "Ajustes", contexto: "Tu partida" };
    $("panel-titulo").textContent = titulos[tipo];
    ({ historial: panelHistorial, favoritos: panelFavoritos, ajustes: panelAjustes, contexto: panelContexto })[tipo](cuerpo);
    $("velo").hidden = false;
    $("panel").classList.add("abierto");
    $("panel").setAttribute("aria-hidden", "false");
    var foco = cuerpo.querySelector("select, input, button");
    if (foco) setTimeout(function () { foco.focus(); }, 50);
  }
  function cerrarPanel() {
    $("velo").hidden = true;
    $("panel").classList.remove("abierto");
    $("panel").setAttribute("aria-hidden", "true");
  }

  function panelContexto(cuerpo) {
    var c = contexto();
    cuerpo.appendChild(el("p", { clase: "ayuda", texto: "Opcional. Solo te pediré estos datos cuando cambien la respuesta. Se guardan en este dispositivo para " + juegoActual().nombre + "." }));
    Object.keys(CAMPOS).forEach(function (k) {
      cuerpo.appendChild(el("label", { clase: "campo" }, el("span", { texto: CAMPOS[k] + (k === "avance" ? " (rango de cazador, misión o zona)" : "") }), controlCampo(k, c[k])));
    });
    var spo = el("input", { type: "checkbox", id: "chk-spoilers", checked: c.sinSpoilers });
    cuerpo.appendChild(el("label", { clase: "interruptor campo" }, spo, el("span", { clase: "pista" }), el("span", { texto: "Modo sin spoilers" })));
    cuerpo.appendChild(el("div", { clase: "fila-botones" },
      el("button", { type: "button", clase: "boton", onclick: function () {
        var x = contexto();
        cuerpo.querySelectorAll("[data-campo]").forEach(function (inp) { x[inp.getAttribute("data-campo")] = inp.value.trim(); });
        x.sinSpoilers = spo.checked;
        guardarContexto(x); cerrarPanel();
      } }, "Guardar"),
      el("button", { type: "button", clase: "boton sec", onclick: function () {
        guardarContexto({ plataforma: "", arma: "", rango: "", avance: "", sinSpoilers: true }); cerrarPanel();
      } }, "Limpiar")));
  }

  function panelHistorial(cuerpo) {
    var todas = leer(CLAVES.conversaciones, []);
    if (!todas.length) { cuerpo.appendChild(el("p", { clase: "vacio", texto: "Aún no hay conversaciones guardadas." })); return; }
    todas.forEach(function (c) {
      cuerpo.appendChild(el("div", { clase: "elemento" },
        el("button", { type: "button", clase: "elemento-abrir", onclick: function () {
          estado.juego = { id: c.juego, expansion: c.expansion }; guardar(CLAVES.juego, estado.juego);
          estado.conversacion = c; pintarSelectorJuego(); pintarContexto(); pintarChat(); cerrarPanel();
        } }, el("b", { texto: c.titulo || "Conversación" }), el("small", { texto: c.nombreJuego + " · " + new Date(c.fecha).toLocaleString("es-MX") })),
        el("button", { type: "button", clase: "icono", "aria-label": "Borrar", title: "Borrar", onclick: function () {
          guardar(CLAVES.conversaciones, leer(CLAVES.conversaciones, []).filter(function (x) { return x.id !== c.id; }));
          if (estado.conversacion.id === c.id) nuevaConversacion();
          abrirPanel("historial");
        } }, svgIcono(ICONO_BORRAR))));
    });
    cuerpo.appendChild(el("div", { clase: "fila-botones" }, el("button", { type: "button", clase: "boton peligro", onclick: function () {
      if (confirm("¿Borrar todo el historial de este dispositivo?")) { borrar(CLAVES.conversaciones); nuevaConversacion(); abrirPanel("historial"); }
    } }, "Borrar todo el historial")));
  }

  function panelFavoritos(cuerpo) {
    var lista = favoritos();
    if (!lista.length) { cuerpo.appendChild(el("p", { clase: "vacio", texto: "Toca la estrella de una respuesta para guardarla aquí." })); return; }
    lista.forEach(function (f) {
      cuerpo.appendChild(el("div", { clase: "elemento" },
        el("button", { type: "button", clase: "elemento-abrir", onclick: function () {
          estado.conversacion = { id: id(), juego: estado.juego.id, expansion: estado.juego.expansion, nombreJuego: f.juego, titulo: f.pregunta, fecha: Date.now(),
            mensajes: [{ rol: "usuario", texto: f.pregunta }, { rol: "asistente", estado: "listo", pregunta: f.pregunta, id: f.id, datos: f.datos }] };
          pintarChat(); cerrarPanel();
        } }, el("b", { texto: f.pregunta }), el("small", { texto: f.juego + " · " + new Date(f.fecha).toLocaleDateString("es-MX") })),
        el("button", { type: "button", clase: "icono", "aria-label": "Quitar", title: "Quitar", onclick: function () {
          guardar(CLAVES.favoritos, favoritos().filter(function (x) { return x.id !== f.id; })); abrirPanel("favoritos");
        } }, svgIcono(ICONO_BORRAR))));
    });
    cuerpo.appendChild(el("div", { clase: "fila-botones" }, el("button", { type: "button", clase: "boton peligro", onclick: function () {
      if (confirm("¿Borrar todos los favoritos?")) { borrar(CLAVES.favoritos); abrirPanel("favoritos"); }
    } }, "Borrar todos los favoritos")));
  }

  function panelAjustes(cuerpo) {
    var entrada = el("input", { type: "url", value: leer(CLAVES.servidor, ""), placeholder: (window.GUIA_CONFIG && window.GUIA_CONFIG.servidor) || "https://tu-servidor.onrender.com" });
    cuerpo.appendChild(el("label", { clase: "campo" }, el("span", { texto: "Dirección del servidor" }), entrada));
    cuerpo.appendChild(el("p", { clase: "ayuda", texto: esAppNativa()
      ? "La app necesita la dirección pública de tu servidor de la Guía del Cazador (donde están guardadas las claves de búsqueda e IA)."
      : "Déjalo vacío para usar este mismo sitio." }));
    var estadoTxt = el("p", { clase: "ayuda" });
    cuerpo.appendChild(el("div", { clase: "fila-botones" },
      el("button", { type: "button", clase: "boton", onclick: function () {
        var v = entrada.value.trim();
        if (v && !/^https?:\/\//i.test(v)) { estadoTxt.textContent = "La dirección debe empezar con https://"; return; }
        guardar(CLAVES.servidor, v.replace(/\/+$/, ""));
        estadoTxt.textContent = "Guardado. Comprobando…";
        revisarServidor();
        pedir("/api/estado", { espera: 15000 }).then(function (i) {
          estadoTxt.textContent = "Conectado. IA: " + (i.ia ? "activa" : "no configurada (modo demostración)") + " · YouTube: " + (i.youtube ? "activo" : "no configurado") + ".";
        }).catch(function (e) { estadoTxt.textContent = e.message; });
      } }, "Guardar y probar")));
    cuerpo.appendChild(estadoTxt);
    cuerpo.appendChild(el("hr", { style: "border:0;border-top:1px solid var(--borde);margin:20px 0" }));
    cuerpo.appendChild(el("p", { clase: "ayuda", texto: "Todo (historial, favoritos, tu partida y ajustes) se guarda solo en este dispositivo. No necesitas cuenta." }));
    cuerpo.appendChild(el("button", { type: "button", clase: "boton peligro", onclick: function () {
      if (!confirm("¿Borrar historial, favoritos, datos de tu partida y ajustes de este dispositivo?")) return;
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf("gdc_") === 0) borrar(k); });
      location.reload();
    } }, "Borrar todos mis datos"));
    cuerpo.appendChild(el("p", { clase: "ayuda", style: "margin-top:20px", texto: "Guía del Cazador v0.1 · Proyecto de fans, no afiliado a Capcom. Monster Hunter es marca de Capcom." }));
  }

  /* ------------------------------------------------ eventos */
  function iniciar() {
    aplicarTema();
    pintarSelectorJuego();
    pintarContexto();
    nuevaConversacion();
    revisarServidor();

    $("chk-expansion").addEventListener("change", function (e) { cambiarJuego(estado.juego.id, e.target.checked); });
    $("btn-nuevo").addEventListener("click", nuevaConversacion);
    $("btn-historial").addEventListener("click", function () { abrirPanel("historial"); });
    $("btn-favoritos").addEventListener("click", function () { abrirPanel("favoritos"); });
    $("btn-ajustes").addEventListener("click", function () { abrirPanel("ajustes"); });
    $("btn-tema").addEventListener("click", alternarTema);
    $("btn-cerrar-panel").addEventListener("click", cerrarPanel);
    $("velo").addEventListener("click", cerrarPanel);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") cerrarPanel(); });

    var area = $("pregunta");
    function ajustarAltura() { area.style.height = "auto"; area.style.height = Math.min(area.scrollHeight, 160) + "px"; }
    area.addEventListener("input", ajustarAltura);
    area.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("form-pregunta").requestSubmit(); }
    });
    $("form-pregunta").addEventListener("submit", function (e) {
      e.preventDefault();
      var v = area.value; area.value = ""; ajustarAltura();
      enviar(v);
    });

    // En el APK, los enlaces externos se abren en el navegador del teléfono
    if (window.Capacitor) {
      document.addEventListener("click", function (e) {
        var a = e.target.closest && e.target.closest("a[target=_blank]");
        if (a) { e.preventDefault(); window.location.href = a.href; }
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
