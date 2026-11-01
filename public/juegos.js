/*
 * Catálogo de juegos de la Guía del Cazador.
 * Se usa en el navegador (window.JUEGOS) y en el servidor (require).
 * Para agregar un juego nuevo, añade una entrada a JUEGOS con la misma forma.
 */
(function () {
  var ARMAS_MH = [
    "Gran espada", "Espada larga", "Espada y escudo", "Espadas dobles",
    "Martillo", "Cornamusa", "Lanza", "Lanza pistola", "Hacha espada",
    "Hacha cargada", "Glaive insecto", "Arco", "Ballesta ligera", "Ballesta pesada"
  ];

  var JUEGOS = {
    mhw: {
      id: "mhw",
      nombre: "Monster Hunter: World",
      corto: "World",
      expansion: { id: "iceborne", nombre: "Iceborne" },
      plataformas: ["PlayStation 4 / 5", "Xbox One / Series", "PC (Steam)"],
      armas: ARMAS_MH,
      rangos: ["Rango bajo", "Rango alto"],
      rangosExpansion: ["Rango maestro"],
      fuentesPreferidas: ["mhworld.kiranico.com", "monsterhunter.com", "capcom.com"],
      descripcion:
        "Monster Hunter: World (Capcom, 2018). Juego base con rango bajo y rango alto.",
      descripcionExpansion:
        "Iceborne es la expansión de pago de World: agrega rango maestro, la garra retráctil (clutch claw), nuevas zonas, monstruos, armas y sistemas. Sin Iceborne nada de eso está disponible.",
      sugerencias: [
        "¿Cómo cambio la apariencia de mi armadura sin perder sus estadísticas?",
        "¿Dónde consigo este material?",
        "Enséñame a usar mi arma con un video.",
        "¿Qué armadura me conviene con mi rango actual?",
        "¿Qué comida me conviene antes de una cacería difícil?"
      ]
    },
    mhwilds: {
      id: "mhwilds",
      nombre: "Monster Hunter Wilds",
      corto: "Wilds",
      expansion: null,
      plataformas: ["PlayStation 5", "Xbox Series X|S", "PC (Steam)"],
      armas: ARMAS_MH,
      rangos: ["Rango bajo", "Rango alto"],
      rangosExpansion: [],
      fuentesPreferidas: ["mhwilds.kiranico.com", "monsterhunter.com", "capcom.com"],
      descripcion:
        "Monster Hunter Wilds (Capcom, 2025). Juego independiente de World: sus mecánicas, materiales, monstruos y menús son distintos.",
      descripcionExpansion: "",
      sugerencias: [
        "¿Cómo cambio la apariencia de mi armadura sin perder sus estadísticas?",
        "¿Dónde consigo este material?",
        "Enséñame a usar mi arma con un video.",
        "¿Qué armadura me conviene con mi rango actual?",
        "¿Cómo funciona el modo enfoque?"
      ]
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = JUEGOS;
  if (typeof window !== "undefined") window.JUEGOS = JUEGOS;
})();
