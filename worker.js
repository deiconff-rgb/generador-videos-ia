// Worker: API de IA (/api/*). Las páginas web viven en la carpeta /public.
// Modelos "-fast" porque los demás Llama 3.x fueron retirados el 30-05-2026.
// Si uno falla o se queda corto, el Worker prueba el siguiente de la lista.

const MODELOS = [
  "@cf/meta/llama-3.1-8b-instruct-fast",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
];

// Imágenes: FLUX.2 klein (muy realista, tamaño libre) y SDXL-Lightning (rápido, bueno para anime/caricatura).
const MODELO_KLEIN = "@cf/black-forest-labs/flux-2-klein-4b";
const MODELO_SDXL = "@cf/bytedance/stable-diffusion-xl-lightning";
const MODELO_FLUX1 = "@cf/black-forest-labs/flux-1-schnell";
const MODELO_VOZ = "@cf/myshell-ai/melotts";

// Ajustes de SDXL-Lightning (si las imágenes salen muy saturadas, baja IMG_GUIDANCE)
const IMG_GUIDANCE = 2.5;
const IMG_STEPS = 8;

const PALABRAS_POR_SEG = 2.5;      // ~150 palabras por minuto de narración

// Perfiles por formato de video
const PERFILES = {
  "9:16": {
    resolucion: "720x1280", escenas: 4, tomas: 2,
    minPalabrasEscena: 24, maxPalabrasEscena: 32, umbralEscena: 18,
    minSeg: 0, maxSeg: 60,
    descripcion: "un video vertical corto de MÁXIMO 1 minuto (una sola idea clara, ritmo rápido)",
  },
  "16:9": {
    resolucion: "1280x720", escenas: 10, tomas: 2,
    minPalabrasEscena: 58, maxPalabrasEscena: 72, umbralEscena: 45,
    minSeg: 240, maxSeg: 300,
    descripcion: "un video horizontal de 4 a 5 minutos (con desarrollo, giros y buen cierre)",
  },
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Caracteres chinos, japoneses o coreanos que a veces se cuelan en el texto
const NO_LATINO = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

function perfilDe(formato) {
  return PERFILES[formato] || PERFILES["9:16"];
}

// ---------- Detección del tipo de historia (decide estilo de imagen, nombres y tono) ----------
const ESTILOS = {
  historia: {
    realista: true,
    narrador: "narrador de documental histórico: solemne, claro y apasionante, con datos reales",
    en: "photorealistic historical scene, realistic human faces and skin texture, authentic period clothing, architecture and props, natural cinematic lighting, vintage 35mm film photograph, muted warm earthy tones, highly detailed",
  },
  anime: {
    realista: false,
    narrador: "narrador de una serie de anime: épico, emotivo y lleno de energía",
    en: "high quality anime illustration, clean line art, vibrant colors, cel shading, expressive anime characters, dramatic cinematic lighting, detailed background",
  },
  comedia: {
    realista: false,
    narrador: "narrador cómico, con ironía y humor ligero, como quien cuenta una anécdota muy divertida",
    en: "colorful 2D cartoon illustration, funny exaggerated expressions, bold outlines, bright playful colors, humorous scene",
  },
  terror: {
    realista: true,
    narrador: "narrador de historias de terror: voz baja y tensa, con pausas y detalles inquietantes",
    en: "dark horror cinematic photograph, photorealistic, realistic human faces, low-key lighting, deep shadows, thick fog, desaturated cold colors, unsettling eerie atmosphere, film grain",
  },
  misterio: {
    realista: true,
    narrador: "narrador de misterio: intrigante, que plantea preguntas y dosifica la información",
    en: "moody film noir cinematic photograph, photorealistic, realistic human faces, dramatic shadows, rain, muted colors, mysterious atmosphere",
  },
  scifi: {
    realista: true,
    narrador: "narrador de ciencia ficción: asombrado, preciso y visionario",
    en: "photorealistic futuristic cinematic scene, realistic human faces, neon and volumetric lighting, highly detailed",
  },
  general: {
    realista: true,
    narrador: "cuentacuentos: cálido, cercano y con buen ritmo",
    en: "photorealistic cinematic photograph, realistic human faces and skin texture, natural lighting, shallow depth of field, highly detailed",
  },
};

function detectarGenero(texto) {
  const t = String(texto || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const reglas = [
    ["anime", /anime|manga|japon|samurai|ninja|shonen|otaku/],
    ["comedia", /chiste|comedi|humor|gracios|broma|risa|parodia|meme/],
    ["terror", /terror|horror|miedo|fantasma|embrujad|demonio|maldic|pesadilla|asesino|zombi|paranormal|espeluznant|llorona/],
    ["misterio", /misterio|enigma|detective|crimen|conspiraci/],
    ["scifi", /ciencia ficcion|futurista|robot|espacial|alien|extraterrestre|cyberpunk|galaxia/],
    ["historia", /histori|revolucion|independencia|azteca|mexica|maya|conquista|imperio|batalla|guerra|siglo|prehispan|colonia|virrey|presidente|heroe|cultura|tradicion|civilizacion|antiguo|medieval|egipto|roma|vikingo/],
  ];
  for (const [g, re] of reglas) if (re.test(t)) return g;
  return "general";
}

function estiloDe(genero) {
  return ESTILOS[genero] || ESTILOS.general;
}

// ---------- Nombres de personajes según el tipo de historia ----------
const NOMBRES_ES = ["Marisol Hernández", "Chuy Ramírez", "Lupita Gómez", "Beto Salazar", "Rocío Mendoza",
  "Memo Torres", "Karla Domínguez", "Nacho Villanueva", "Fernanda Ruiz", "Tomás Aguilar", "Paty Cervantes",
  "Rigoberto Luna", "Yesenia Ortega", "Arturo Campos", "Daniela Pineda", "Joaquín Rangel", "Abigail Fuentes",
  "Rodrigo Castañeda", "Itzel Navarro", "Gael Montes", "Xóchitl Barrera", "Emiliano Rojas", "Valeria Cisneros",
  "Octavio Peña"];
const NOMBRES_JP = ["Haruto Takahashi", "Sakura Fujimoto", "Ren Kobayashi", "Yuki Nakamura", "Hiro Tanaka",
  "Aoi Matsumoto", "Kaito Shimizu", "Mio Hayashi", "Daichi Yamamoto", "Rina Kuroda", "Sota Mori", "Hana Ishikawa",
  "Takumi Okada", "Akari Sasaki", "Riku Fujita", "Nanami Endo"];

function alAzar(lista, n) {
  const c = lista.slice();
  for (let i = c.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c.slice(0, n);
}

function reglaNombres(genero) {
  const prohibido = 'Nunca uses nombres genéricos como "Agente T", "El Jefe", "La Sombra" ni "La mujer del pueblo".';
  if (genero === "historia") {
    return `Nombres de los personajes (obligatorio): usa los nombres REALES de las personas históricas que participaron (por ejemplo Emiliano Zapata, Francisco Villa, Francisco I. Madero, Miguel Hidalgo, Benito Juárez, según el tema) y respeta los hechos, lugares y fechas reales. Si no estás seguro de un dato, no lo inventes. ${prohibido}`;
  }
  if (genero === "anime") {
    return `Nombres de los personajes (obligatorio): nombres japoneses completos en letras latinas (romaji), por ejemplo: ${alAzar(NOMBRES_JP, 5).join(", ")}. ${prohibido}`;
  }
  return `Nombres de los personajes (obligatorio): nombres de personas reales y comunes, elegidos al azar, por ejemplo: ${alAzar(NOMBRES_ES, 5).join(", ")}. ${prohibido}`;
}

// ---------- Utilidades de IA ----------
function textoDeRespuesta(r) {
  if (!r) return "";
  if (typeof r.response === "string") return r.response;
  if (r.response && typeof r.response === "object") return JSON.stringify(r.response);
  const c = r.choices && r.choices[0] && r.choices[0].message;
  if (c && typeof c.content === "string") return c.content;
  return JSON.stringify(r);
}

function extraerJSON(texto) {
  const ini = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (ini === -1 || fin === -1) throw new Error("La IA no devolvió JSON");
  return JSON.parse(texto.slice(ini, fin + 1));
}

async function pedirIA(env, modelo, sistema, pedido, maxTokens) {
  const r = await env.AI.run(modelo, {
    messages: [
      { role: "system", content: sistema },
      { role: "user", content: pedido },
    ],
    max_tokens: maxTokens,
  });
  const obj = extraerJSON(textoDeRespuesta(r));
  if (NO_LATINO.test(JSON.stringify(obj))) throw new Error("La IA mezcló caracteres de otro idioma");
  return obj;
}

const SISTEMA =
  "Eres guionista y director de arte de videos para redes sociales. Respondes SOLO con JSON válido, sin texto extra, en español. Escribe únicamente con alfabeto latino: nunca uses caracteres chinos, japoneses ni coreanos.";

function fichaHistoria(h) {
  const pers = (h.personajes || [])
    .map((p) => `${p.nombre} (${p.genero || ""}): ${p.descripcion || ""}`)
    .join("; ");
  return (
    `Título: ${h.titulo || ""}\n` +
    `Sinopsis: ${h.sinopsis || h.trama || ""}\n` +
    `Escenografía general: ${h.escenografia || ""}\n` +
    `Personajes: ${pers}`
  ).slice(0, 2500);
}

function normalizar(n) {
  return String(n || "").trim().toLowerCase();
}

function palabrasDe(texto) {
  return String(texto || "").trim().split(/\s+/).filter(Boolean).length;
}

// Divide una narración en frases (cada frase se convierte en una voz y un subtítulo).
function dividirFrases(texto) {
  const limpio = String(texto || "").replace(/\s+/g, " ").trim();
  if (!limpio) return [];
  const partes = limpio.match(/[^.!?…]+[.!?…]+["”»)]*|[^.!?…]+$/g) || [limpio];
  // une "Francisco I." con lo que sigue (inicial suelta + punto)
  const unidas = [];
  for (const p of partes) {
    const t = p.trim();
    if (!t) continue;
    if (unidas.length && /(^|\s)[A-ZÁÉÍÓÚÑ]\.$/.test(unidas[unidas.length - 1])) {
      unidas[unidas.length - 1] += " " + t;
    } else unidas.push(t);
  }
  const frases = [];
  for (let p of unidas) {
    while (p.length > 230) {
      let corte = p.lastIndexOf(",", 200);
      if (corte < 60) corte = p.lastIndexOf(" ", 200);
      if (corte < 60) corte = 200;
      frases.push(p.slice(0, corte + 1).trim());
      p = p.slice(corte + 1).trim();
    }
    if (p) frases.push(p);
  }
  return frases;
}

// ---------- Paso 1: 5 ideas con sinopsis y escenografía ----------
// Se hace UNA llamada por idea (en paralelo) porque así la IA siempre entrega las 5.
const TONOS = [
  "épico y dramático",
  "misterioso y de suspenso",
  "emotivo y humano",
  "de aventura y acción",
  "con un giro final inesperado",
];

async function generarUna(env, tema, tono, numero, perfil, genero) {
  const pedido = `Crea UNA idea de video sobre: ${tema}.
Es la idea ${numero} de 5: debe tener un tono ${tono} y ser distinta de las otras cuatro.
Debe servir para ${perfil.descripcion}.
Formato exacto:
{"historia":{"titulo":"","sinopsis":"","escenografia":"","estilo_visual":"","personajes":[{"nombre":"","genero":"hombre|mujer","descripcion":""}],"narracion_muestra":""}}
Reglas:
- sinopsis: de 4 a 6 frases que expliquen de qué trata, cómo empieza, cuál es el conflicto y cómo termina.
- escenografia: de 3 a 4 frases que describan cómo se verá: lugares, época, iluminación, colores y ambiente.
- estilo_visual: una frase corta (ejemplo: anime, óleo realista, cinematográfico oscuro).
- 2 o 3 personajes, cada uno con una descripción breve de aspecto y personalidad.
- narracion_muestra: 2 o 3 frases con las que un narrador abriría el video (tono narrativo, sin diálogos).
${reglaNombres(genero)}`;

  let ultimoError = "Sin respuesta";
  for (const modelo of MODELOS) {
    try {
      const obj = await pedirIA(env, modelo, SISTEMA, pedido, 1800);
      const h = obj.historia || (obj.historias && obj.historias[0]) || (obj.titulo ? obj : null);
      if (!h || !h.titulo) throw new Error("JSON sin historia");
      return h;
    } catch (e) {
      ultimoError = modelo + ": " + String(e.message || e);
    }
  }
  throw new Error(ultimoError);
}

async function generarHistorias(env, tema, formato) {
  const perfil = perfilDe(formato);
  const genero = detectarGenero(tema);
  const res = await Promise.allSettled(
    TONOS.map((t, i) => generarUna(env, tema, t, i + 1, perfil, genero))
  );
  const ok = res.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (!ok.length) {
    const primero = res.find((r) => r.status === "rejected");
    throw new Error(primero ? String(primero.reason.message || primero.reason) : "Sin respuesta");
  }
  return { historias: ok, incompleto: ok.length < TONOS.length, genero, formato: PERFILES[formato] ? formato : "9:16" };
}

// ---------- Paso 2: guion narrado (esquema + escenas en paralelo) ----------
const ESQUEMA_BASE = [
  "Gancho inicial: se presenta el lugar y a los protagonistas",
  "Se muestra el conflicto principal",
  "El conflicto crece y se toma una decisión",
  "Un descubrimiento importante cambia todo",
  "Una complicación o giro inesperado",
  "El momento más tenso de la historia",
  "Las consecuencias empiezan a verse",
  "El desenlace del conflicto",
  "Lo que quedó después de todo",
  "Cierre claro y reflexión final",
];

function esquemaBase(n) {
  if (n <= ESQUEMA_BASE.length && n === 4) {
    return [ESQUEMA_BASE[0], ESQUEMA_BASE[1], ESQUEMA_BASE[5], ESQUEMA_BASE[9]];
  }
  return ESQUEMA_BASE.slice(0, n);
}

function primeraFrase(texto) {
  const f = dividirFrases(texto)[0] || "";
  return f.replace(/[.!?…]+$/, "");
}

async function generarEsquema(env, historia, perfil) {
  const n = perfil.escenas;
  const pedido = `Divide esta historia en EXACTAMENTE ${n} escenas para ${perfil.descripcion}, y crea la ficha visual y el gancho de apertura.
${fichaHistoria(historia)}
Formato exacto:
{"dato_gancho":"","titulo_video":"","personajes":[{"nombre":"","aspecto_en":""}],"escenas":[{"numero":1,"resumen":""}]}
Reglas:
- dato_gancho: un dato sorprendente (o una afirmación intrigante si es ficción) sobre la historia, de 12 a 20 palabras, SIN empezar con "¿Sabías que" (ejemplo: "En 1862, un ejército mal armado derrotó a la mayor potencia del mundo.").
- titulo_video: un título llamativo y corto (3 a 8 palabras) que enganche al público.
- personajes: para cada personaje, "aspecto_en" es una descripción física en inglés (edad, rostro, cabello, ropa) para que se vea igual en todas las imágenes.
- escenas: cada resumen tiene 1 o 2 frases con lo que ocurre; la escena 1 abre la historia, la ${n} es el cierre; la historia avanza con claridad de una escena a la siguiente.`;

  const aspectos = {};
  (historia.personajes || []).forEach((p) => {
    if (p && p.nombre) aspectos[normalizar(p.nombre)] = String(p.descripcion || "").slice(0, 160);
  });
  let beats = null;
  let dato = "";
  let tituloVideo = "";

  for (const modelo of MODELOS) {
    try {
      const obj = await pedirIA(env, modelo, SISTEMA, pedido, 2200);
      const res = (obj.escenas || []).map((e) => String(e.resumen || "").trim()).filter(Boolean);
      if (res.length < Math.min(3, n)) continue;
      const base = esquemaBase(n);
      while (res.length < n) res.push(base[res.length]);
      beats = res.slice(0, n);
      dato = String(obj.dato_gancho || "").trim();
      tituloVideo = String(obj.titulo_video || "").trim();
      (obj.personajes || []).forEach((p) => {
        if (p && p.nombre && p.aspecto_en) aspectos[normalizar(p.nombre)] = String(p.aspecto_en).slice(0, 200);
      });
      break;
    } catch (_) {}
  }
  if (!dato) dato = primeraFrase(historia.sinopsis || historia.trama || historia.titulo);
  if (!tituloVideo) tituloVideo = historia.titulo || "Sin título";
  return { beats: beats || esquemaBase(n), aspectos, dato, tituloVideo };
}

async function generarEscena(env, tema, historia, esquema, n, ficha, perfil, genero) {
  const lista = esquema.map((b, i) => `${i + 1}) ${b}`).join("\n");
  const nombres =
    (historia.personajes || []).map((p) => p.nombre).filter(Boolean).join(", ") ||
    "los personajes de la historia";
  const estilo = estiloDe(genero);
  const pedido = `Tema general: ${tema}
${fichaHistoria(historia)}
Esquema de las ${esquema.length} escenas:
${lista}

Escribe SOLO la escena ${n}: ${esquema[n - 1]}
Formato exacto:
{"escena":{"numero":${n},"escenografia":"","narracion":"","tomas":[{"imagen":""},{"imagen":""}]}}
Reglas:
- narracion: texto que leerá UN narrador (${estilo.narrador}). Debe tener entre ${perfil.minPalabrasEscena} y ${perfil.maxPalabrasEscena} palabras. Cuenta los hechos como una historia continua en tercera persona, con ritmo (mezcla frases cortas y largas). NO escribas diálogos entre personajes (puedes citar una frase célebre entre comillas), ni viñetas, ni títulos.
- Continúa la historia desde la escena anterior sin repetir lo ya contado.${n === 1 ? " La escena 1 empieza directamente con la acción (el gancho de apertura se dice aparte)." : ""}${n === esquema.length ? " Esta es la última escena: termina con un cierre memorable." : ""}
- escenografia: 2 a 3 frases (lugar, luz, ambiente y qué se ve).
- tomas: exactamente 2. Cada una describe en inglés lo que SE VE en pantalla en ese momento: la toma 1 corresponde a la primera mitad de la narración y la toma 2 a la segunda mitad. Describe acción concreta, postura y expresión de los personajes, lugar y luz. No pongas texto ni letras en la imagen.
- Usa solo estos personajes: ${nombres}. Si la historia es real, respeta los hechos, lugares y fechas reales.`;

  let mejor = null;
  let ultimoError = "Sin respuesta";
  for (const modelo of MODELOS) {
    try {
      const obj = await pedirIA(env, modelo, SISTEMA, pedido, 1800);
      const e = obj.escena || (obj.narracion ? obj : null);
      if (!e || !String(e.narracion || "").trim()) throw new Error("JSON sin narración");
      e.numero = n;
      const p = palabrasDe(e.narracion);
      const distancia = p < perfil.minPalabrasEscena ? perfil.minPalabrasEscena - p : Math.max(0, p - perfil.maxPalabrasEscena);
      if (!mejor || distancia < mejor.distancia) mejor = { e, distancia, p };
      if (p >= perfil.umbralEscena && p <= perfil.maxPalabrasEscena + 10) break;
    } catch (err) {
      ultimoError = modelo + ": " + String(err.message || err);
    }
  }
  if (!mejor) throw new Error(ultimoError);
  return mejor.e;
}

// Reparte las frases de la escena entre sus tomas y arma el prompt final de cada imagen.
function componerPrompts(e, aspectos, genero, perfil) {
  e.frases = dividirFrases(e.narracion);
  const frases = e.frases;
  let tomas = Array.isArray(e.tomas) ? e.tomas.filter((t) => t && (t.imagen || t.prompt)).slice(0, perfil.tomas) : [];
  if (!tomas.length) tomas = [{ imagen: e.escenografia || "" }];
  const m = tomas.length;
  const estilo = estiloDe(genero).en;
  e.tomas = tomas.map((t, j) => {
    const desde = Math.floor((j * frases.length) / m);
    const hasta = Math.floor(((j + 1) * frases.length) / m);
    const texto = normalizar(frases.slice(desde, hasta).join(" ") + " " + (t.imagen || ""));
    const ficha = Object.keys(aspectos)
      .filter((nombre) => nombre.split(/\s+/).some((w) => w.length >= 4 && texto.includes(w)))
      .slice(0, 2)
      .map((nombre) => nombre + ": " + aspectos[nombre])
      .join("; ");
    const base = String(t.imagen || t.prompt || "").trim();
    const prompt = (base + "." + (ficha ? " Characters: " + ficha + "." : "") + " " + estilo + ", no text, no letters.").slice(0, 1700);
    return { imagen: base, prompt, desde, hasta };
  });
}

// Si la IA escribió de más, se recortan frases del final de las escenas más largas (menos la última).
function recortarExceso(escenas, maxPalabras) {
  const total = () => escenas.reduce((a, e) => a + palabrasDe(e.narracion), 0);
  let guardia = 200;
  while (total() > maxPalabras && guardia-- > 0) {
    const candidatas = escenas.slice(0, -1).filter((e) => dividirFrases(e.narracion).length > 2);
    if (!candidatas.length) break;
    candidatas.sort((a, b) => palabrasDe(b.narracion) - palabrasDe(a.narracion));
    const e = candidatas[0];
    const f = dividirFrases(e.narracion);
    f.pop();
    e.narracion = f.join(" ");
  }
}

async function generarGuion(env, tema, historia, formato, generoCliente) {
  const perfil = perfilDe(formato);
  const fmt = PERFILES[formato] ? formato : "9:16";
  const genero = generoCliente && ESTILOS[generoCliente] && generoCliente !== "general"
    ? generoCliente
    : detectarGenero([tema, historia.titulo, historia.estilo_visual].join(" "));

  const ficha = await generarEsquema(env, historia, perfil);
  const esquema = ficha.beats;
  const tarea = (i) => generarEscena(env, tema, historia, esquema, i + 1, ficha, perfil, genero);

  let res = await Promise.allSettled(esquema.map((_, i) => tarea(i)));
  // segundo intento solo para las escenas que fallaron
  const pendientes = res.map((r, i) => (r.status === "rejected" ? i : -1)).filter((i) => i >= 0);
  if (pendientes.length) {
    const otra = await Promise.allSettled(pendientes.map((i) => tarea(i)));
    pendientes.forEach((i, k) => { res[i] = otra[k]; });
  }
  const escenas = res.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (!escenas.length) {
    const primero = res.find((r) => r.status === "rejected");
    throw new Error(primero ? String(primero.reason.message || primero.reason) : "Sin respuesta");
  }

  // gancho de apertura: "¿Sabías que ...?" + título llamativo (se leen en voz alta al inicio)
  const dato = ficha.dato.replace(/[.!?…]+$/, "");
  const intro = {
    pregunta: "¿Sabías que…?",
    dato: dato.charAt(0).toUpperCase() + dato.slice(1) + ".",
    hablado: "¿Sabías que " + dato.charAt(0).toLowerCase() + dato.slice(1) + "?",
    titulo: ficha.tituloVideo,
  };
  const palabrasIntro = palabrasDe(intro.hablado) + palabrasDe(intro.titulo);

  const maxPalabras = Math.floor(perfil.maxSeg * PALABRAS_POR_SEG) - palabrasIntro;
  recortarExceso(escenas, maxPalabras);
  escenas.forEach((e) => componerPrompts(e, ficha.aspectos, genero, perfil));

  const palabras = escenas.reduce((a, e) => a + palabrasDe(e.narracion), 0) + palabrasIntro;
  const duracion = Math.round(palabras / PALABRAS_POR_SEG);
  return {
    titulo: ficha.tituloVideo,
    titulo_historia: historia.titulo || "",
    formato: fmt,
    resolucion: perfil.resolucion,
    genero,
    intro,
    escenas,
    palabras,
    duracion_estimada: duracion,
    min_seg: perfil.minSeg,
    max_seg: perfil.maxSeg,
    corto: perfil.minSeg > 0 && duracion < perfil.minSeg,
    largo: duracion > perfil.maxSeg + 3,
    imagenes: escenas.reduce((a, e) => a + e.tomas.length, 0),
    escenas_fallidas: esquema.length - escenas.length,
  };
}

// ---------- Paso 3: imagen por toma y voz por frase ----------
function base64ABytes(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

function aBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

async function aBytes(r) {
  if (!r) throw new Error("Respuesta vacía");
  if (r instanceof ArrayBuffer) return new Uint8Array(r);
  if (r instanceof Uint8Array) return r;
  if (typeof r.getReader === "function") return new Uint8Array(await new Response(r).arrayBuffer());
  if (typeof r.image === "string") return base64ABytes(r.image);
  if (typeof r === "string") return base64ABytes(r);
  throw new Error("Formato de imagen desconocido");
}

function mimeDe(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  return "image/jpeg";
}

// Devuelve { bytes, mime, modelo }. Elige el modelo según el estilo y, si falla, prueba los demás.
async function generarImagen(env, prompt, genero, formato) {
  const horizontal = formato === "16:9";
  const estilo = estiloDe(genero);
  const texto = String(prompt).slice(0, 1700);
  const corto = String(prompt).slice(0, 240) + ", " + estilo.en;
  const errores = [];

  const klein = ["FLUX.2 klein", async () => {
    const form = new FormData();
    form.append("prompt", texto);
    form.append("width", String(horizontal ? 1024 : 576));
    form.append("height", String(horizontal ? 576 : 1024));
    const fr = new Response(form);
    return env.AI.run(MODELO_KLEIN, { multipart: { body: fr.body, contentType: fr.headers.get("content-type") } });
  }];
  const sdxl = ["SDXL", () => env.AI.run(MODELO_SDXL, {
    prompt: texto,
    negative_prompt: estilo.realista
      ? "cartoon, anime, illustration, painting, drawing, deformed face, extra fingers, blurry, text, letters, watermark"
      : "photorealistic, photo, deformed, extra fingers, blurry, text, letters, watermark",
    width: horizontal ? 1344 : 768,
    height: horizontal ? 768 : 1344,
    num_steps: IMG_STEPS,
    guidance: IMG_GUIDANCE,
  })];
  const flux1 = ["FLUX.1", () => env.AI.run(MODELO_FLUX1, { prompt: corto, steps: 4 })];

  const orden = estilo.realista ? [klein, sdxl, flux1] : [sdxl, klein, flux1];
  for (const [nombre, llamar] of orden) {
    try {
      const bytes = await aBytes(await llamar());
      if (bytes.length < 1000) throw new Error("Imagen vacía");
      return { bytes, mime: mimeDe(bytes), modelo: nombre };
    } catch (e) {
      errores.push(nombre + ": " + String((e && e.message) || e).slice(0, 160));
    }
  }
  throw new Error(errores.join(" | "));
}

async function generarVoz(env, texto, lang) {
  const r = await env.AI.run(MODELO_VOZ, {
    prompt: String(texto).slice(0, 500),
    lang: lang || "es",
  });
  if (r && r.audio) return r.audio;
  if (typeof r === "string") return r;
  if (r instanceof ArrayBuffer) return aBase64(r);
  if (r && typeof r.getReader === "function") return aBase64(await new Response(r).arrayBuffer());
  throw new Error("La IA no devolvió audio");
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      let cuerpo = {};
      if (request.method === "POST") {
        try {
          cuerpo = await request.json();
        } catch (_) {}
      }
      const tema = String(cuerpo.tema || url.searchParams.get("tema") || "").slice(0, 200);
      const formato = cuerpo.formato === "16:9" ? "16:9" : "9:16";

      try {
        if (url.pathname === "/api/historias") {
          if (!tema) return json({ error: "Falta el tema. Ejemplo: ?tema=terror" }, 400);
          return json(await generarHistorias(env, tema, formato));
        }
        if (url.pathname === "/api/guion") {
          if (!tema || !cuerpo.historia) return json({ error: "Falta el tema o la historia" }, 400);
          return json(await generarGuion(env, tema, cuerpo.historia, formato, cuerpo.genero));
        }
        if (url.pathname === "/api/imagen") {
          if (!cuerpo.prompt) return json({ error: "Falta el prompt de la imagen" }, 400);
          const img = await generarImagen(env, cuerpo.prompt, cuerpo.genero, formato);
          return new Response(img.bytes, {
            headers: { "Content-Type": img.mime, "X-Modelo": img.modelo, ...CORS },
          });
        }
        if (url.pathname === "/api/voz") {
          if (!cuerpo.texto) return json({ error: "Falta el texto" }, 400);
          return json({ audio: await generarVoz(env, cuerpo.texto, cuerpo.lang) });
        }
        return json({ error: "Ruta no encontrada" }, 404);
      } catch (e) {
        return json({ error: String(e.message || e) }, 500);
      }
    }

    // Todo lo demás son las páginas de /public
    return env.ASSETS.fetch(request);
  },
};
