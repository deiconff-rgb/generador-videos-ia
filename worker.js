// Worker: API de IA (/api/*). Las páginas web viven en la carpeta /public.
// Modelos "-fast" porque los demás Llama 3.x fueron retirados el 30-05-2026.
// Si uno falla o se queda corto, el Worker prueba el siguiente de la lista.

const MODELOS = [
  "@cf/meta/llama-3.1-8b-instruct-fast",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
];
const MODELO_IMAGEN = "@cf/black-forest-labs/flux-1-schnell";
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
- dialogo_muestra: 4 líneas de diálogo del inicio de la historia.`;

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

async function generarEsquema(env, historia) {
  const pedido = `Divide esta historia en EXACTAMENTE ${NUM_ESCENAS} escenas para un video vertical de 2 a 3 minutos.
${fichaHistoria(historia)}
Formato exacto:
{"escenas":[{"numero":1,"resumen":""}]}
Reglas: cada resumen tiene 1 o 2 frases con lo que ocurre; la escena 1 es un gancho fuerte, la ${NUM_ESCENAS} es el cierre; la historia avanza con claridad de una escena a la siguiente.`;
  for (const modelo of MODELOS) {
    try {
      const obj = await pedirIA(env, modelo, SISTEMA, pedido, 1500);
      const res = (obj.escenas || []).map((e) => String(e.resumen || "").trim()).filter(Boolean);
      if (res.length >= 4) {
        while (res.length < NUM_ESCENAS) res.push(ESQUEMA_BASE[res.length]);
        return res.slice(0, NUM_ESCENAS);
      }
    } catch (_) {}
  }
  return ESQUEMA_BASE;
}

async function generarEscena(env, tema, historia, esquema, n) {
  const lista = esquema.map((b, i) => `${i + 1}) ${b}`).join("\n");
  const nombres =
    (historia.personajes || []).map((p) => p.nombre).filter(Boolean).join(", ") ||
    "los personajes de la historia";
  const pedido = `Tema general: ${tema}
${fichaHistoria(historia)}
Esquema de las ${NUM_ESCENAS} escenas:
${lista}

Escribe SOLO la escena ${n}: ${esquema[n - 1]}
Formato exacto:
{"escena":{"numero":${n},"escenografia":"","prompt_imagen":"","dialogos":[{"personaje":"","texto":""}]}}
Reglas:
- escenografia: 2 a 3 frases (lugar, luz, ambiente y qué se ve).
- prompt_imagen: en inglés, para generar una imagen vertical 9:16 de esta escena, con el estilo visual de la historia.
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

async function generarGuion(env, tema, historia) {
  const esquema = await generarEsquema(env, historia);
  const res = await Promise.allSettled(
    esquema.map((_, i) => generarEscena(env, tema, historia, esquema, i + 1))
  );
  const escenas = res.filter((r) => r.status === "fulfilled").map((r) => r.value);
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

async function generarImagen(env, prompt) {
  const p = String(prompt).slice(0, 1500) +
    ", vertical cinematic composition, highly detailed, no text, no watermark";
  let ultimo = new Error("Sin imagen");
  for (let intento = 0; intento < 2; intento++) {
    try {
      const r = await env.AI.run(MODELO_IMAGEN, {
        prompt: p,
        steps: 4,
        seed: Math.floor(Math.random() * 1000000),
      });
      const img = r && (r.image || (typeof r === "string" ? r : null));
      if (!img) throw new Error("La IA no devolvió imagen");
      return img;
    } catch (e) {
      ultimo = e;
    }
  }
  throw ultimo;
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
          return json({ image: await generarImagen(env, cuerpo.prompt) });
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
