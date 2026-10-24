// Worker: sirve la página web (/) y genera 5 historias con IA (/api/historias).
// Modelos "-fast" porque los demás Llama 3.x fueron retirados el 30-05-2026.
// Si alguno falla, el Worker prueba el siguiente de la lista.

const MODELOS = [
  "@cf/meta/llama-3.1-8b-instruct-fast",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

function extraerJSON(texto) {
  const ini = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (ini === -1 || fin === -1) throw new Error("La IA no devolvió JSON");
  const obj = JSON.parse(texto.slice(ini, fin + 1));
  if (!obj.historias || !obj.historias.length) throw new Error("JSON sin historias");
  return obj;
}

function textoDeRespuesta(r) {
  if (!r) return "";
  if (typeof r.response === "string") return r.response;
  if (r.response && typeof r.response === "object") return JSON.stringify(r.response);
  const c = r.choices && r.choices[0] && r.choices[0].message;
  if (c && typeof c.content === "string") return c.content;
  return JSON.stringify(r);
}

async function generarHistorias(env, tema) {
  const sistema =
    "Eres guionista de videos cortos. Respondes SOLO con JSON válido, sin texto extra, en español.";
  const pedido = `Crea 5 historias distintas sobre: ${tema}. Cada una debe ser breve (video de 1 a 2 minutos).
Formato exacto:
{"historias":[{"titulo":"","trama":"","personajes":[{"nombre":"","genero":"hombre|mujer"}],"dialogos":[{"personaje":"","texto":""}]}]}
Cada historia con 2 o 3 personajes y entre 6 y 8 diálogos.`;

  let ultimoError = "Sin respuesta";
  for (const modelo of MODELOS) {
    try {
      const r = await env.AI.run(modelo, {
        messages: [
          { role: "system", content: sistema },
          { role: "user", content: pedido },
        ],
        max_tokens: 3500,
      });
      return extraerJSON(textoDeRespuesta(r));
    } catch (e) {
      ultimoError = modelo + ": " + String(e.message || e);
    }
  }
  throw new Error(ultimoError);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);

    if (url.pathname === "/api/historias") {
      let tema = url.searchParams.get("tema");
      if (!tema && request.method === "POST") {
        try {
          tema = (await request.json()).tema;
        } catch (_) {}
      }
      if (!tema) return json({ error: "Falta el tema. Ejemplo: ?tema=terror" }, 400);
      tema = String(tema).slice(0, 200);
      try {
        return json(await generarHistorias(env, tema));
      } catch (e) {
        return json({ error: String(e.message || e) }, 500);
      }
    }

    return new Response(PAGINA, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
};

// ------------------------------------------------------------------
// Página web (Tailwind + Lucide, morado brillante).
// Dentro del script de la página NO se usan comillas invertidas ni ${}
// ------------------------------------------------------------------
const PAGINA = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0b0613">
<title>Generador de Videos IA</title>
<script src="https://cdn.tailwindcss.com/3.4.17"></script>
<script src="https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js"></script>
<style>
  body { background: radial-gradient(1200px 600px at 50% -10%, #3b0a6b55, transparent), #0b0613; }
  .brillo { box-shadow: 0 0 24px #a855f766; }
</style>
</head>
<body class="min-h-screen text-purple-50 antialiased">
<div class="max-w-3xl mx-auto px-4 pt-6 pb-40">

  <header class="flex items-center gap-3 mb-6">
    <div class="p-2.5 rounded-xl bg-purple-500 brillo"><i data-lucide="clapperboard" class="w-6 h-6 text-white"></i></div>
    <div>
      <h1 class="text-xl font-bold leading-tight">Generador de Videos IA</h1>
      <p class="text-sm text-purple-300">Escribe un tema, elige una historia y crea tu video</p>
    </div>
  </header>

  <section class="rounded-2xl border border-purple-500/30 bg-purple-950/40 p-4 mb-6">
    <label for="tema" class="flex items-center gap-2 text-sm font-semibold text-purple-200 mb-2">
      <i data-lucide="wand-sparkles" class="w-4 h-4 text-purple-400"></i> ¿Sobre qué quieres el video?
    </label>
    <textarea id="tema" rows="2" maxlength="200"
      placeholder="Ej: crea un video de historia de México, de terror, de anime..."
      class="w-full rounded-xl bg-[#140a24] border border-purple-500/40 focus:border-purple-400 focus:ring-2 focus:ring-purple-500/50 outline-none p-3 text-purple-50 placeholder-purple-400/60 resize-none"></textarea>

    <div class="flex flex-wrap gap-2 mt-3" id="chips"></div>

    <button id="btnGenerar"
      class="mt-4 w-full flex items-center justify-center gap-2 rounded-xl bg-purple-500 hover:bg-purple-400 active:scale-[.99] transition font-semibold py-3 text-white brillo disabled:opacity-60">
      <i data-lucide="sparkles" class="w-5 h-5"></i> Generar 5 historias
    </button>
  </section>

  <div id="estado" class="hidden"></div>
  <section id="resultados" class="space-y-4"></section>
</div>

<div id="barra" class="hidden fixed bottom-0 inset-x-0 border-t border-purple-500/40 bg-[#0b0613]/95 backdrop-blur p-4">
  <div class="max-w-3xl mx-auto">
    <p class="text-xs text-purple-300 mb-2 flex items-center gap-1.5">
      <i data-lucide="circle-check" class="w-4 h-4 text-purple-400"></i>
      Elegida: <span id="tituloElegida" class="font-semibold text-purple-100"></span>
    </p>
    <button id="btnVideo"
      class="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-fuchsia-500 hover:from-purple-400 hover:to-fuchsia-400 font-semibold py-3 text-white brillo">
      <i data-lucide="video" class="w-5 h-5"></i> Crear video con esta historia
    </button>
  </div>
</div>

<script>
  var $ = function (id) { return document.getElementById(id); };
  var historias = [];
  var elegida = -1;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var categorias = [
    ["Historia de México", "landmark"],
    ["Terror", "ghost"],
    ["Anime", "swords"],
    ["Misterio", "search"],
    ["Comedia", "laugh"],
    ["Ciencia ficción", "rocket"]
  ];

  function pintarChips() {
    var html = "";
    categorias.forEach(function (c) {
      html += '<button type="button" data-tema="' + esc(c[0]) + '" class="chip flex items-center gap-1.5 rounded-full border border-purple-500/40 bg-purple-900/40 hover:bg-purple-500/30 px-3 py-1.5 text-sm text-purple-100">' +
        '<i data-lucide="' + c[1] + '" class="w-4 h-4 text-purple-300"></i>' + esc(c[0]) + "</button>";
    });
    $("chips").innerHTML = html;
    document.querySelectorAll(".chip").forEach(function (b) {
      b.addEventListener("click", function () {
        $("tema").value = "Un video de " + b.getAttribute("data-tema").toLowerCase();
        $("tema").focus();
      });
    });
  }

  function mostrarEstado(tipo, texto) {
    var cont = $("estado");
    cont.className = "mb-4";
    if (tipo === "cargando") {
      cont.innerHTML = '<div class="flex items-center gap-3 rounded-xl border border-purple-500/30 bg-purple-950/40 p-4 text-purple-200">' +
        '<i data-lucide="loader-circle" class="w-5 h-5 animate-spin text-purple-400"></i>' + esc(texto) + "</div>";
    } else if (tipo === "error") {
      cont.innerHTML = '<div class="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-950/30 p-4 text-red-200">' +
        '<i data-lucide="triangle-alert" class="w-5 h-5 mt-0.5 shrink-0"></i><span class="break-words">' + esc(texto) + "</span></div>";
    } else {
      cont.className = "hidden";
      cont.innerHTML = "";
    }
    lucide.createIcons();
  }

  function pintarHistorias() {
    var html = "";
    historias.forEach(function (h, i) {
      var sel = i === elegida;
      var personajes = (h.personajes || []).map(function (p) {
        return '<span class="inline-flex items-center gap-1 rounded-full bg-purple-500/20 px-2.5 py-1 text-xs text-purple-200">' +
          '<i data-lucide="user" class="w-3 h-3"></i>' + esc(p.nombre) + "</span>";
      }).join(" ");
      var dialogos = (h.dialogos || []).map(function (d) {
        return '<p class="text-sm"><span class="font-semibold text-purple-300">' + esc(d.personaje) + ":</span> " + esc(d.texto) + "</p>";
      }).join("");

      html += '<article class="rounded-2xl border ' + (sel ? "border-purple-400 bg-purple-900/50 brillo" : "border-purple-500/30 bg-purple-950/40") + ' p-4">' +
        '<div class="flex items-start justify-between gap-3">' +
          '<h3 class="font-bold text-lg leading-snug"><span class="text-purple-400">' + (i + 1) + ".</span> " + esc(h.titulo) + "</h3>" +
        "</div>" +
        '<p class="text-sm text-purple-200 mt-2">' + esc(h.trama) + "</p>" +
        '<div class="flex flex-wrap gap-2 mt-3">' + personajes + "</div>" +
        '<details class="mt-3 group"><summary class="cursor-pointer flex items-center gap-2 text-sm text-purple-300 select-none">' +
          '<i data-lucide="message-square-text" class="w-4 h-4"></i> Ver diálogos</summary>' +
          '<div class="mt-2 space-y-1.5 rounded-xl bg-[#140a24] p-3">' + dialogos + "</div></details>" +
        '<button data-i="' + i + '" class="elegir mt-4 w-full flex items-center justify-center gap-2 rounded-xl ' +
          (sel ? "bg-purple-500 text-white" : "border border-purple-400/60 text-purple-100 hover:bg-purple-500/20") + ' py-2.5 font-medium">' +
          '<i data-lucide="' + (sel ? "circle-check" : "mouse-pointer-click") + '" class="w-4 h-4"></i>' + (sel ? "Elegida" : "Elegir esta historia") + "</button>" +
      "</article>";
    });
    $("resultados").innerHTML = html;
    document.querySelectorAll(".elegir").forEach(function (b) {
      b.addEventListener("click", function () {
        elegida = parseInt(b.getAttribute("data-i"), 10);
        pintarHistorias();
        $("tituloElegida").textContent = historias[elegida].titulo || "";
        $("barra").classList.remove("hidden");
      });
    });
    lucide.createIcons();
  }

  async function generar() {
    var tema = $("tema").value.trim();
    if (!tema) { mostrarEstado("error", "Escribe primero de qué quieres el video."); return; }
    $("btnGenerar").disabled = true;
    $("barra").classList.add("hidden");
    elegida = -1;
    historias = [];
    $("resultados").innerHTML = "";
    mostrarEstado("cargando", "La IA está escribiendo las historias... puede tardar hasta 30 segundos.");
    try {
      var r = await fetch("/api/historias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tema: tema })
      });
      var data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error || "Error desconocido");
      historias = data.historias;
      mostrarEstado("ok");
      pintarHistorias();
    } catch (e) {
      mostrarEstado("error", "No se pudieron generar las historias: " + e.message);
    }
    $("btnGenerar").disabled = false;
  }

  function crearVideo() {
    if (elegida < 0) return;
    mostrarEstado("cargando", "Siguiente paso en construcción: voz, imágenes y montaje del video de «" + historias[elegida].titulo + "».");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $("btnGenerar").addEventListener("click", generar);
  $("btnVideo").addEventListener("click", crearVideo);
  $("tema").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generar(); }
  });

  pintarChips();
  lucide.createIcons();
</script>
</body>
</html>`;
