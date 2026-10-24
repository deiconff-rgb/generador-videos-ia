// Worker: API de IA (/api/*). Las páginas web viven en la carpeta /public.
// Modelos "-fast" porque los demás Llama 3.x fueron retirados el 30-05-2026.
// Si uno falla o se queda corto, el Worker prueba el siguiente de la lista.

const MODELOS = [
  "@cf/meta/llama-3.1-8b-instruct-fast",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
];
// Imagen: primero SDXL-Lightning (permite formato vertical 9:16 real); si falla, FLUX (cuadrada).
const MODELO_IMAGEN_VERTICAL = "@cf/bytedance/stable-diffusion-xl-lightning";
const MODELO_IMAGEN_FLUX = "@cf/black-forest-labs/flux-1-schnell";
const MODELO_VOZ = "@cf/myshell-ai/melotts";

const FORMATO = "9:16";
const RESOLUCION = "1080x1920";
const NUM_ESCENAS = 8;
const PALABRAS_POR_SEG = 2.5;      // ~150 palabras por minuto
const MIN_PALABRAS = 300;          // 2 minutos
const MIN_PALABRAS_ESCENA = 60;    // 8 escenas x 60 = 480 palabras (~3 min)

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
  "Eres guionista y director de arte de videos verticales 9:16 para Reels, Shorts y TikTok. Respondes SOLO con JSON válido, sin texto extra, en español. Escribe únicamente con alfabeto latino: nunca uses caracteres chinos, japoneses ni coreanos.";

function fichaHistoria(h) {
  const pers = (h.personajes || [])
    .map((p) => `${p.nombre} (${p.genero || ""}): ${p.descripcion || ""}`)
    .join("; ");
  return (
    `Título: ${h.titulo || ""}\n` +
    `Sinopsis: ${h.sinopsis || h.trama || ""}\n` +
    `Escenografía general: ${h.escenografia || ""}\n` +
    `Estilo visual: ${h.estilo_visual || ""}\n` +
    `Personajes: ${pers}`
  ).slice(0, 2500);
}

// ---------- Nombres de personajes según el tema ----------
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

function reglaNombres() {
  return `Nombres de los personajes (obligatorio, elige según el tema):
- Si el tema es de historia, cultura, tradiciones o hechos reales (por ejemplo la cultura de México o la Revolución Mexicana): usa los nombres REALES de las personas históricas que participaron (por ejemplo Emiliano Zapata, Francisco Villa, Francisco I. Madero, Miguel Hidalgo, Benito Juárez) y respeta los hechos, lugares y fechas reales. Si no estás seguro de un dato, no lo inventes.
- Si el tema es anime o Japón: usa nombres japoneses completos en letras latinas (romaji), por ejemplo: ${alAzar(NOMBRES_JP, 5).join(", ")}.
- Si el tema es chiste, comedia o cualquier otra historia de ficción: usa nombres de personas reales y comunes, elegidos al azar, por ejemplo: ${alAzar(NOMBRES_ES, 5).join(", ")}.
- Nunca uses nombres genéricos como "Agente T", "El Jefe", "La Sombra" ni "La mujer del pueblo".`;
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

async function generarUna(env, tema, tono, numero) {
  const pedido = `Crea UNA idea de video sobre: ${tema}.
Es la idea ${numero} de 5: debe tener un tono ${tono} y ser distinta de las otras cuatro.
Debe servir para un video vertical 9:16 de al menos 2 minutos.
Formato exacto:
{"historia":{"titulo":"","sinopsis":"","escenografia":"","estilo_visual":"","personajes":[{"nombre":"","genero":"hombre|mujer","descripcion":""}],"dialogo_muestra":[{"personaje":"","texto":""}]}}
Reglas:
- sinopsis: de 4 a 6 frases que expliquen de qué trata, cómo empieza, cuál es el conflicto y cómo termina.
- escenografia: de 3 a 4 frases que describan cómo se verá: lugares, época, iluminación, colores y ambiente.
- estilo_visual: una frase corta (ejemplo: anime, óleo realista, cinematográfico oscuro).
- 2 o 3 personajes, cada uno con una descripción breve de aspecto y personalidad.
- dialogo_muestra: 4 líneas de diálogo del inicio de la historia.
${reglaNombres()}`;

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

async function generarHistorias(env, tema) {
  const res = await Promise.allSettled(TONOS.map((t, i) => generarUna(env, tema, t, i + 1)));
  const ok = res.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (!ok.length) {
    const primero = res.find((r) => r.status === "rejected");
    throw new Error(primero ? String(primero.reason.message || primero.reason) : "Sin respuesta");
  }
  return { historias: ok, incompleto: ok.length < TONOS.length };
}

// ---------- Paso 2: guion completo (esquema + 8 escenas en paralelo) ----------
function contarPalabras(escenas) {
  let n = 0;
  for (const esc of escenas || []) {
    for (const d of esc.dialogos || []) {
      n += String(d.texto || "").trim().split(/\s+/).filter(Boolean).length;
    }
  }
  return n;
}

const ESQUEMA_BASE = [
  "Gancho inicial: se presenta el lugar y a los personajes",
  "Se muestra el conflicto principal",
  "El conflicto crece y los personajes toman una decisión",
  "Un descubrimiento importante cambia todo",
  "Una complicación o giro inesperado",
  "El momento más tenso de la historia",
  "El desenlace del conflicto",
  "Cierre claro y reflexión final",
];

function normalizar(n) {
  return String(n || "").trim().toLowerCase();
}

async function generarEsquema(env, historia) {
  const pedido = `Divide esta historia en EXACTAMENTE ${NUM_ESCENAS} escenas para un video vertical de 2 a 3 minutos y crea la ficha visual para generar imágenes.
${fichaHistoria(historia)}
Formato exacto:
{"estilo_visual_en":"","personajes":[{"nombre":"","aspecto_en":""}],"escenas":[{"numero":1,"resumen":""}]}
Reglas:
- estilo_visual_en: una frase en inglés con el estilo de las imágenes (técnica, colores, luz).
- personajes: para cada personaje, "aspecto_en" es una descripción física en inglés (edad, rostro, cabello, ropa) para que se vea igual en todas las imágenes.
- escenas: cada resumen tiene 1 o 2 frases con lo que ocurre; la escena 1 es un gancho fuerte, la ${NUM_ESCENAS} es el cierre; la historia avanza con claridad de una escena a la siguiente.`;

  const aspectos = {};
  (historia.personajes || []).forEach((p) => {
    if (p && p.nombre) aspectos[normalizar(p.nombre)] = String(p.descripcion || "").slice(0, 160);
  });
  let estilo = String(historia.estilo_visual || "cinematic").slice(0, 120);
  let beats = null;

  for (const modelo of MODELOS) {
    try {
      const obj = await pedirIA(env, modelo, SISTEMA, pedido, 2000);
      const res = (obj.escenas || []).map((e) => String(e.resumen || "").trim()).filter(Boolean);
      if (res.length < 4) continue;
      while (res.length < NUM_ESCENAS) res.push(ESQUEMA_BASE[res.length]);
      beats = res.slice(0, NUM_ESCENAS);
      if (obj.estilo_visual_en) estilo = String(obj.estilo_visual_en).slice(0, 160);
      (obj.personajes || []).forEach((p) => {
        if (p && p.nombre && p.aspecto_en) aspectos[normalizar(p.nombre)] = String(p.aspecto_en).slice(0, 200);
      });
      break;
    } catch (_) {}
  }
  return { beats: beats || ESQUEMA_BASE, estilo, aspectos };
}

async function generarEscena(env, tema, historia, esquema, n, ficha) {
  const lista = esquema.map((b, i) => `${i + 1}) ${b}`).join("\n");
  const nombres =
    (historia.personajes || []).map((p) => p.nombre).filter(Boolean).join(", ") ||
    "los personajes de la historia";
  const pedido = `Tema general: ${tema}
${fichaHistoria(historia)}
Esquema de las ${NUM_ESCENAS} escenas:
${lista}
Ficha visual (inglés): estilo = ${ficha.estilo}. ${Object.entries(ficha.aspectos).map(([k, v]) => k + ": " + v).join(". ")}

Escribe SOLO la escena ${n}: ${esquema[n - 1]}
Formato exacto:
{"escena":{"numero":${n},"escenografia":"","tomas":[{"imagen":""},{"imagen":""}],"dialogos":[{"personaje":"","texto":""}]}}
Reglas:
- escenografia: 2 a 3 frases (lugar, luz, ambiente y qué se ve).
- tomas: exactamente 2. Cada una describe en inglés lo que SE VE en pantalla en ese momento, siguiendo la acción de los diálogos: la toma 1 corresponde a los diálogos 1 a 3 y la toma 2 a los diálogos 4 a 6. Describe acción concreta, postura y expresión de los personajes, lugar y luz. No pongas texto ni letras en la imagen.
- Si la historia es real, respeta los hechos, lugares y fechas reales.
- Exactamente 6 diálogos. Cada diálogo es una frase larga y completa de 15 a 25 palabras.
- Entre los 6 diálogos deben sumar al menos 90 palabras.
- Usa solo estos personajes: ${nombres}.${n === 1 ? " Empieza con un gancho fuerte." : ""}${n === NUM_ESCENAS ? " Termina con un cierre claro." : ""}`;

  let mejor = null;
  let ultimoError = "Sin respuesta";
  for (const modelo of MODELOS) {
    try {
      const obj = await pedirIA(env, modelo, SISTEMA, pedido, 1800);
      const e = obj.escena || (obj.dialogos ? obj : null);
      if (!e || !e.dialogos || !e.dialogos.length) throw new Error("JSON sin escena");
      e.numero = n;
      const p = contarPalabras([e]);
      if (!mejor || p > mejor.p) mejor = { e, p };
      if (p >= MIN_PALABRAS_ESCENA) break;
    } catch (err) {
      ultimoError = modelo + ": " + String(err.message || err);
    }
  }
  if (!mejor) throw new Error(ultimoError);
  return mejor.e;
}

function componerPrompts(e, estilo, aspectos) {
  const dials = e.dialogos || [];
  let tomas = Array.isArray(e.tomas) ? e.tomas.filter((t) => t && (t.imagen || t.prompt)).slice(0, 2) : [];
  if (!tomas.length) tomas = [{ imagen: e.prompt_imagen || e.escenografia || "" }];
  const m = tomas.length;
  e.tomas = tomas.map((t, j) => {
    const desde = Math.floor((j * dials.length) / m);
    const hasta = Math.floor(((j + 1) * dials.length) / m);
    const hablan = [...new Set(dials.slice(desde, hasta).map((d) => d.personaje))];
    const ficha = hablan
      .map((n) => (aspectos[normalizar(n)] ? n + ": " + aspectos[normalizar(n)] : ""))
      .filter(Boolean)
      .join("; ");
    const base = String(t.imagen || t.prompt || "").trim();
    const prompt = (base + "." + (ficha ? " Characters: " + ficha + "." : "") + " Style: " + estilo + ".").slice(0, 1700);
    return { imagen: base, prompt, desde, hasta };
  });
  e.prompt_imagen = e.tomas[0].prompt;
}

async function generarGuion(env, tema, historia) {
  const ficha = await generarEsquema(env, historia);
  const esquema = ficha.beats;
  const res = await Promise.allSettled(
    esquema.map((_, i) => generarEscena(env, tema, historia, esquema, i + 1, ficha))
  );
  const escenas = res.filter((r) => r.status === "fulfilled").map((r) => r.value);
  escenas.forEach((e) => componerPrompts(e, ficha.estilo, ficha.aspectos));
  if (!escenas.length) {
    const primero = res.find((r) => r.status === "rejected");
    throw new Error(primero ? String(primero.reason.message || primero.reason) : "Sin respuesta");
  }
  const palabras = contarPalabras(escenas);
  return {
    titulo: historia.titulo || "Sin título",
    formato: FORMATO,
    resolucion: RESOLUCION,
    escenas,
    palabras,
    duracion_estimada: Math.round(palabras / PALABRAS_POR_SEG),
    corto: palabras < MIN_PALABRAS,
    escenas_fallidas: esquema.length - escenas.length,
  };
}

// ---------- Paso 3: imagen por escena y voz por diálogo ----------
function aBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function base64ABytes(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
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

// Devuelve { bytes, mime, modelo }. Prueba varias rutas y, si todas fallan, explica por qué.
async function generarImagen(env, prompt) {
  const estilo = ", vertical 9:16 composition, cinematic lighting, highly detailed, no text, no letters, no watermark";
  const largo = String(prompt).slice(0, 1700) + estilo;
  const corto = String(prompt).slice(0, 220) + estilo;
  const errores = [];

  const intentos = [
    ["SDXL vertical", () => env.AI.run(MODELO_IMAGEN_VERTICAL, {
      prompt: largo,
      negative_prompt: "text, letters, watermark, logo, deformed hands, blurry, low quality",
      width: 768, height: 1344, num_steps: 8,
    })],
    ["FLUX", () => env.AI.run(MODELO_IMAGEN_FLUX, { prompt: largo, steps: 4 })],
    ["FLUX corto", () => env.AI.run(MODELO_IMAGEN_FLUX, { prompt: corto, steps: 4 })],
  ];

  for (const [nombre, llamar] of intentos) {
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

      try {
        if (url.pathname === "/api/historias") {
          if (!tema) return json({ error: "Falta el tema. Ejemplo: ?tema=terror" }, 400);
          return json(await generarHistorias(env, tema));
        }
        if (url.pathname === "/api/guion") {
          if (!tema || !cuerpo.historia) return json({ error: "Falta el tema o la historia" }, 400);
          return json(await generarGuion(env, tema, cuerpo.historia));
        }
        if (url.pathname === "/api/imagen") {
          if (!cuerpo.prompt) return json({ error: "Falta el prompt de la imagen" }, 400);
          const img = await generarImagen(env, cuerpo.prompt);
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
