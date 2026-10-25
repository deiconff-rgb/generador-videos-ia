// Generador de video dentro del navegador (sin servidor de video).
// Formatos: 9:16 (720x1280, máx. 1 min) y 16:9 (1280x720, 4 a 5 min).
// Flujo: una imagen por "toma" (según la acción del guion) + voz de narrador por frase
//        -> canvas con movimiento de cámara, subtítulos y música -> MediaRecorder lo graba.
(function () {
  "use strict";

  const CONF = {
    "9:16": { W: 720, H: 1280, bitrate: 2500000, maxSeg: 60 },
    "16:9": { W: 1280, H: 720, bitrate: 1800000, maxSeg: 300 },
  };
  let W = 720;            // se ajustan al formato elegido
  let H = 1280;
  const FPS = 30;
  const PAUSA = 0.3;      // segundos entre frases
  const FADE = 0.5;       // segundos de transición entre tomas
  const PALABRAS_POR_SEG = 2.5;

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  const iconos = () => { if (window.lucide) lucide.createIcons(); };
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const limitar = (x, a, b) => Math.max(a, Math.min(b, x));
  const contarPalabras = (t) => String(t || "").trim().split(/\s+/).filter(Boolean).length;

  let enCurso = false;

  // Movimientos de cámara (zoom y paneo). x e y van de -1 a 1.
  const MOVS = [
    { z0: 1.0,  z1: 1.30, x0: 0,    x1: 0,   y0: 0,    y1: 0 },    // acercar
    { z0: 1.25, z1: 1.25, x0: -1,   x1: 1,   y0: 0,    y1: 0 },    // paneo a la derecha
    { z0: 1.30, z1: 1.0,  x0: 0,    x1: 0,   y0: 0,    y1: 0 },    // alejar
    { z0: 1.25, z1: 1.25, x0: 1,    x1: -1,  y0: 0,    y1: 0 },    // paneo a la izquierda
    { z0: 1.25, z1: 1.25, x0: 0,    x1: 0,   y0: 1,    y1: -1 },   // inclinar hacia arriba
    { z0: 1.0,  z1: 1.30, x0: -0.6, x1: 0.6, y0: -0.6, y1: 0.6 },  // acercar en diagonal
  ];

  // Música de fondo generada en el navegador (acordes suaves según el tipo de historia).
  const ACORDES = {
    historia: [[146.83, 174.61, 220.0], [116.54, 146.83, 174.61], [174.61, 220.0, 261.63], [130.81, 164.81, 196.0]],
    terror:   [[110.0, 130.81, 155.56], [92.5, 110.0, 130.81], [82.41, 116.54, 146.83], [110.0, 130.81, 155.56]],
    misterio: [[110.0, 130.81, 164.81], [98.0, 116.54, 146.83], [87.31, 130.81, 155.56], [110.0, 130.81, 164.81]],
    anime:    [[130.81, 164.81, 196.0], [98.0, 123.47, 146.83], [110.0, 130.81, 164.81], [87.31, 110.0, 130.81]],
    comedia:  [[196.0, 246.94, 293.66], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66], [130.81, 164.81, 196.0]],
    scifi:    [[110.0, 164.81, 220.0], [87.31, 130.81, 174.61], [130.81, 196.0, 261.63], [98.0, 146.83, 196.0]],
    general:  [[110.0, 130.81, 164.81], [87.31, 110.0, 130.81], [130.81, 164.81, 196.0], [98.0, 123.47, 146.83]],
  };

  // ---------- red ----------
  async function post(ruta, cuerpo) {
    const r = await fetch(ruta, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    let data;
    try { data = await r.json(); }
    catch (_) { throw new Error("Respuesta inválida (" + r.status + ")"); }
    if (!r.ok || data.error) throw new Error(data.error || "Error desconocido");
    return data;
  }

  function b64ABuffer(b64) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8.buffer;
  }

  function cargarImagenBlob(blob) {
    return new Promise((ok, mal) => {
      const url = URL.createObjectURL(blob);
      const im = new Image();
      im.onload = () => { try { URL.revokeObjectURL(url); } catch (_) {} ok(im); };
      im.onerror = () => { try { URL.revokeObjectURL(url); } catch (_) {} mal(new Error("Imagen inválida")); };
      im.src = url;
    });
  }

  // La imagen llega como archivo (no como texto). Reintenta hasta 3 veces.
  async function pedirImagen(prompt, genero, formato) {
    let ultimo = null;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch("/api/imagen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, genero, formato }),
        });
        const tipo = r.headers.get("Content-Type") || "";
        if (!r.ok || tipo.indexOf("image/") !== 0) {
          let msg = "HTTP " + r.status;
          try { msg = (await r.json()).error || msg; } catch (_) {}
          throw new Error(msg);
        }
        return await cargarImagenBlob(await r.blob());
      } catch (e) {
        ultimo = e;
        if (i < 2) await esperar(1500 * (i + 1));
      }
    }
    throw ultimo;
  }

  async function enParalelo(tareas, limite) {
    let i = 0;
    async function trabajador() {
      while (i < tareas.length) {
        const k = i++;
        await tareas[k]();
      }
    }
    await Promise.all(Array.from({ length: Math.min(limite, tareas.length) }, trabajador));
  }

  // ---------- paneles ----------
  const PASOS = ["Guion", "Imágenes y voz", "Grabación", "Listo"];

  function panelProgreso(panel) {
    panel.innerHTML = `
      <div class="rounded-xl border border-purple-500/30 bg-[#140a24] p-4">
        <div id="vPasos" class="flex flex-wrap gap-2 mb-3"></div>
        <p class="flex items-center gap-2 text-purple-100">
          <i data-lucide="loader-circle" class="w-5 h-5 animate-spin text-purple-400 shrink-0"></i>
          <span id="vTexto">Preparando...</span></p>
        <div class="mt-3 h-3 rounded-full bg-purple-950 overflow-hidden">
          <div id="vBarra" class="h-full rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500 transition-all" style="width:0%"></div>
        </div>
        <p id="vDetalle" class="mt-2 text-xs text-purple-300"></p>
      </div>`;
    iconos();

    function pintarPasos(activo) {
      panel.querySelector("#vPasos").innerHTML = PASOS.map((p, i) => {
        const clase = i < activo ? "bg-purple-500/30 text-purple-100"
          : i === activo ? "bg-purple-500 text-white"
          : "border border-purple-500/30 text-purple-400";
        return `<span class="rounded-full px-3 py-1 text-xs font-medium ${clase}">${i < activo ? "✓ " : (i + 1) + ". "}${p}</span>`;
      }).join("");
    }
    pintarPasos(1);

    return {
      paso: pintarPasos,
      set(texto, pct, detalle) {
        const t = panel.querySelector("#vTexto");
        const b = panel.querySelector("#vBarra");
        const d = panel.querySelector("#vDetalle");
        if (t) t.textContent = texto;
        if (b) b.style.width = Math.max(0, Math.min(100, Math.round(pct))) + "%";
        if (d) d.textContent = detalle || "";
      },
    };
  }

  function panelError(panel, mensaje) {
    panel.innerHTML = `<div class="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-950/30 p-4 text-red-200">
      <i data-lucide="triangle-alert" class="w-5 h-5 mt-0.5 shrink-0"></i><span class="break-words">${esc(mensaje)}</span></div>`;
    iconos();
  }

  function panelListo(panel, url, mime, g, segundos, guardado, rehacer, blob, rep) {
    const horizontal = (g.formato || "9:16") === "16:9";
    const ext = mime.indexOf("mp4") >= 0 ? "mp4" : "webm";
    const nombre = (g.titulo || "video").toLowerCase().replace(/[^a-z0-9áéíóúñ]+/gi, "-").replace(/^-+|-+$/g, "") + "." + ext;
    const estiloVideo = horizontal
      ? "aspect-ratio:16/9; width:100%; max-height:70vh"
      : "aspect-ratio:9/16; max-height:75vh; width:auto; max-width:100%";
    panel.innerHTML = `
      <div class="grid gap-5 ${horizontal ? "" : "lg:grid-cols-[auto_1fr]"} items-start">
        <video src="${url}" controls playsinline class="mx-auto rounded-2xl border border-purple-500/40 bg-black brillo" style="${estiloVideo}"></video>
        <div class="space-y-3 min-w-0">
          <p class="flex items-center gap-2 font-semibold text-lg"><i data-lucide="circle-check" class="w-5 h-5 text-purple-400"></i> ¡Tu video está listo!</p>
          <p class="text-sm text-purple-300">${W}×${H} (${esc(g.formato || "9:16")}) · ${Math.floor(segundos / 60)}:${String(Math.round(segundos) % 60).padStart(2, "0")} min · formato ${esc(ext.toUpperCase())}</p>
          ${guardado ? '<p class="flex items-center gap-1.5 text-sm text-purple-200"><i data-lucide="circle-check" class="w-4 h-4 text-purple-400"></i> Guardado en Mis videos</p>' : ""}
          ${rep && rep.reparado ? '<p class="flex items-center gap-1.5 text-sm text-purple-200"><i data-lucide="shield-check" class="w-4 h-4 text-purple-400"></i> Archivo verificado: dura ' + Math.floor(rep.duracion / 60) + ":" + String(Math.round(rep.duracion) % 60).padStart(2, "0") + " en cualquier app</p>" : ""}
          ${rep && !rep.reparado && rep.motivo ? '<p class="text-xs text-yellow-200">No se pudo reparar el archivo (' + esc(rep.motivo) + "). Si otra app lo lee más corto, usa “Hacer otra versión”.</p>" : ""}
          <div class="flex flex-wrap gap-3">
            <a href="${url}" download="${esc(nombre)}" class="flex items-center gap-2 rounded-xl bg-purple-500 hover:bg-purple-400 px-5 py-2.5 font-semibold text-white brillo">
              <i data-lucide="download" class="w-4 h-4"></i> Descargar</a>
            <button id="vRehacer" class="flex items-center gap-2 rounded-xl border border-purple-400/50 px-5 py-2.5 text-purple-100 hover:bg-purple-500/20">
              <i data-lucide="refresh-cw" class="w-4 h-4"></i> Hacer otra versión</button>
          </div>
          <div id="vPublicar"></div>
          ${ext === "webm" ? '<p class="text-xs text-purple-300">Tu navegador grabó en WebM. Si alguna app no lo acepta, vuelve a generarlo desde Chrome o Brave actualizado para obtener MP4.</p>' : ""}
        </div>
      </div>`;
    iconos();
    const otra = panel.querySelector("#vRehacer");
    if (otra && rehacer) otra.addEventListener("click", rehacer);
    if (window.Publicar && blob) {
      window.Publicar.montar(panel.querySelector("#vPublicar"), {
        blob, mime, nombre, titulo: g.titulo, descripcion: g.sinopsis || "", tema: g.tema || "", formato: g.formato || "9:16",
      });
    }
  }

  // ---------- guion -> frases ----------
  function frasesDe(e) {
    if (e.frases && e.frases.length) return e.frases;
    if (e.narracion) return String(e.narracion).split(/(?<=[.!?…])\s+/).filter(Boolean);
    return (e.dialogos || []).map((d) => String(d.texto || ""));      // guiones antiguos con diálogos
  }

  // ---------- dibujo ----------
  // Si la imagen no tiene la misma proporción del video: fondo desenfocado de la misma imagen.
  function fondoDesenfocado(img) {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d");
    const k = Math.max(W / img.width, H / img.height);
    const w = img.width * k, h = img.height * k;
    try { x.filter = "blur(22px)"; } catch (_) {}
    x.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    x.filter = "none";
    x.fillStyle = "rgba(11,6,19,0.45)";
    x.fillRect(0, 0, W, H);
    return c;
  }

  function coincideProporcion(img) {
    return Math.abs(img.width / img.height / (W / H) - 1) < 0.18;
  }

  function envolver(ctx, texto, ancho) {
    const palabras = String(texto).split(/\s+/);
    const lineas = [];
    let actual = "";
    palabras.forEach((p) => {
      const prueba = actual ? actual + " " + p : p;
      if (ctx.measureText(prueba).width > ancho && actual) { lineas.push(actual); actual = p; }
      else actual = prueba;
    });
    if (actual) lineas.push(actual);
    return lineas;
  }

  function textoConBorde(ctx, texto, x, y, relleno) {
    ctx.lineWidth = 7;
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.lineJoin = "round";
    ctx.strokeText(texto, x, y);
    ctx.fillStyle = relleno;
    ctx.fillText(texto, x, y);
  }

  // Dibuja una toma con su movimiento de cámara. p va de 0 a 1.
  function dibujarToma(ctx, toma, p) {
    if (!toma.img) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#3b0a6b"); g.addColorStop(1, "#0b0613");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center"; ctx.font = "bold 140px sans-serif";
      textoConBorde(ctx, String(toma.si + 1), W / 2, H / 2 - 40, "#c084fc");
      return;
    }
    const img = toma.img;
    const mov = toma.mov;
    const e = p * p * (3 - 2 * p);                 // arranque y frenado suaves
    const coincide = coincideProporcion(img);

    let bw, bh;
    if (coincide) {
      const k = Math.max(W / img.width, H / img.height);
      bw = img.width * k; bh = img.height * k;     // cubre todo el cuadro
    } else {
      if (toma.fondo) ctx.drawImage(toma.fondo, 0, 0, W, H);
      const k = Math.min(W / img.width, H / img.height);
      bw = img.width * k; bh = img.height * k;
    }
    const z = mov.z0 + (mov.z1 - mov.z0) * e;
    const w = bw * z, h = bh * z;
    const px = mov.x0 + (mov.x1 - mov.x0) * e;
    const py = mov.y0 + (mov.y1 - mov.y0) * e;
    const left = (W - w) / 2 + (px * Math.max(0, w - W)) / 2;
    let top = (H - h) / 2 + (py * Math.max(0, h - H)) / 2;
    if (!coincide && W < H) top -= 90;
    ctx.drawImage(img, left, top, w, h);
  }

  function oscurecer(ctx, alfa) {
    ctx.fillStyle = "rgba(8,3,16," + alfa + ")";
    ctx.fillRect(0, 0, W, H);
  }

  function dibujarFrame(ctx, estado, t) {
    const { tomas, lineas, total, horizontal } = estado;

    // toma activa
    let k = tomas.length - 1;
    for (let i = 0; i < tomas.length; i++) { if (t < tomas[i].fin) { k = i; break; } }
    const tk = tomas[k];
    const p = limitar((t - tk.ini) / Math.max(0.1, tk.fin - tk.ini), 0, 1);

    ctx.fillStyle = "#0b0613";
    ctx.fillRect(0, 0, W, H);
    if (k > 0 && t - tk.ini < FADE) {              // transición suave entre tomas
      dibujarToma(ctx, tomas[k - 1], 1);
      ctx.globalAlpha = limitar((t - tk.ini) / FADE, 0, 1);
      dibujarToma(ctx, tk, p);
      ctx.globalAlpha = 1;
    } else {
      dibujarToma(ctx, tk, p);
    }

    // línea activa (la última que ya empezó)
    let lin = null;
    for (let i = 0; i < lineas.length; i++) { if (lineas[i].ini <= t) lin = lineas[i]; else break; }

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const anchoTexto = horizontal ? W - 300 : W - 110;

    if (lin && lin.tipo === "gancho" && t < lin.fin + 0.45) {
      const a = limitar((t - lin.ini) / 0.6, 0, 1);
      oscurecer(ctx, 0.58 * a);
      ctx.globalAlpha = a;
      const y0 = H * 0.40 + (1 - a) * 26;
      try { ctx.letterSpacing = "6px"; } catch (_) {}
      ctx.font = "bold 34px sans-serif";
      textoConBorde(ctx, "¿SABÍAS QUE…?", W / 2, y0, "#d8b4fe");
      try { ctx.letterSpacing = "0px"; } catch (_) {}
      ctx.font = "bold " + (horizontal ? 56 : 52) + "px sans-serif";
      envolver(ctx, lin.dato || lin.texto, anchoTexto).forEach((l, i) => textoConBorde(ctx, l, W / 2, y0 + 84 + i * 66, "#ffffff"));
      ctx.globalAlpha = 1;
    } else if (lin && lin.tipo === "titulo" && t < lin.fin + 0.6) {
      const a = limitar((t - lin.ini) / 0.6, 0, 1);
      oscurecer(ctx, 0.62 * a);
      ctx.globalAlpha = a;
      const ls = (() => { ctx.font = "bold " + (horizontal ? 70 : 60) + "px sans-serif"; return envolver(ctx, String(lin.titulo || lin.texto).toUpperCase(), anchoTexto); })();
      const alto = horizontal ? 80 : 72;
      const y0 = H / 2 - ((ls.length - 1) * alto) / 2 + (1 - a) * 22;
      ctx.fillStyle = "#a855f7";
      ctx.fillRect(W / 2 - 70, y0 - 90, 140, 7);
      ls.forEach((l, i) => textoConBorde(ctx, l, W / 2, y0 + i * alto, "#ffffff"));
      ctx.fillRect(W / 2 - 70, y0 + (ls.length - 1) * alto + 36, 140, 7);
      ctx.globalAlpha = 1;
    } else {
      // degradado inferior + subtítulo de la narración
      const deg = ctx.createLinearGradient(0, H * 0.55, 0, H);
      deg.addColorStop(0, "rgba(11,6,19,0)");
      deg.addColorStop(1, "rgba(11,6,19,0.88)");
      ctx.fillStyle = deg; ctx.fillRect(0, H * 0.55, W, H * 0.45);
      if (lin && lin.tipo === "narracion" && t < lin.fin + 0.3) {
        ctx.font = "bold " + (horizontal ? 42 : 38) + "px sans-serif";
        const ls = envolver(ctx, lin.texto, horizontal ? W - 220 : W - 90);
        const alto = horizontal ? 52 : 46;
        const base = H - (horizontal ? 70 : 190) - (ls.length - 1) * alto;
        ls.forEach((l, i) => textoConBorde(ctx, l, W / 2, base + i * alto, "#ffffff"));
      }
    }

    // barra de progreso
    ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(0, H - 8, W, 8);
    ctx.fillStyle = "#a855f7"; ctx.fillRect(0, H - 8, W * Math.min(1, t / total), 8);
  }

  // ---------- música de fondo ----------
  function musicaFondo(audio, destino, t0, dur, genero) {
    const acordes = ACORDES[genero] || ACORDES.general;
    const master = audio.createGain();
    master.gain.value = 0.6;
    const filtro = audio.createBiquadFilter();
    filtro.type = "lowpass";
    filtro.frequency.value = 1100;
    master.connect(filtro);
    filtro.connect(destino);
    master.gain.setValueAtTime(0.6, t0 + Math.max(0, dur - 2.5));
    master.gain.linearRampToValueAtTime(0.0001, t0 + dur);

    const paso = 8;
    const n = Math.ceil(dur / paso) + 1;
    for (let i = 0; i < n; i++) {
      const ini = Math.max(audio.currentTime, t0 + i * paso - 1);
      const fin = ini + paso + 2;
      acordes[i % acordes.length].forEach((f, k) => {
        const osc = audio.createOscillator();
        osc.type = k === 0 ? "sine" : "triangle";
        osc.frequency.value = f;
        const g = audio.createGain();
        g.gain.setValueAtTime(0.0001, ini);
        g.gain.linearRampToValueAtTime(0.05, ini + 2.5);
        g.gain.setValueAtTime(0.05, fin - 2.5);
        g.gain.linearRampToValueAtTime(0.0001, fin);
        osc.connect(g);
        g.connect(master);
        osc.start(ini);
        osc.stop(fin + 0.1);
      });
    }
  }

  // ---------- grabación ----------
  function elegirFormato() {
    const opciones = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    return opciones.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
  }

  // Línea de tiempo: cuándo suena cada frase y cuándo cambia cada toma. "factor" acelera la narración si hace falta.
  function construirTimeline(escenasG, items, tomas, factor) {
    let t = 0.5;
    const lineas = [];
    const inicioFrase = {};
    const inicioEscena = [];
    escenasG.forEach((_, si) => {
      inicioEscena[si] = si === 0 ? 0 : t;
      items.filter((it) => it.si === si).forEach((it) => {
        const dur = it.buffer
          ? it.buffer.duration / factor
          : Math.max(1.5, contarPalabras(it.texto) / PALABRAS_POR_SEG / factor);
        lineas.push({ ini: t, fin: t + dur, tipo: it.tipo, texto: it.texto, dato: it.dato, titulo: it.titulo, buffer: it.buffer, rate: factor });
        if (it.tipo === "narracion") inicioFrase[si + ":" + it.k] = t;
        t += dur + (it.tipo === "gancho" ? 0.5 : it.tipo === "titulo" ? 0.7 : PAUSA / factor);
      });
      if (t - inicioEscena[si] < 2) t = inicioEscena[si] + 2;
    });
    escenasG.forEach((e, si) => {
      const mias = tomas.filter((x) => x.si === si);
      const L = frasesDe(e).length;
      mias.forEach((x, j) => {
        let desde = x.desde != null ? x.desde : Math.floor((j * L) / mias.length);
        x.ini = j === 0 ? inicioEscena[si]
          : (inicioFrase[si + ":" + desde] != null ? inicioFrase[si + ":" + desde]
            : inicioEscena[si] + ((inicioEscena[si + 1] != null ? inicioEscena[si + 1] : t) - inicioEscena[si]) * (j / mias.length));
      });
    });
    const total = t + 0.8;
    tomas.forEach((x, i) => { x.fin = i + 1 < tomas.length ? Math.max(tomas[i + 1].ini, x.ini + 0.5) : total; });
    return { lineas, total };
  }

  // ---------- proceso principal ----------
  async function generar(g, panel, opts) {
    opts = opts || {};
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      panelError(panel, "Este navegador no puede grabar video. Prueba con Chrome o Brave actualizado.");
      return;
    }
    if (enCurso) return;
    enCurso = true;

    const formato = g.formato === "16:9" ? "16:9" : "9:16";
    const conf = CONF[formato];
    W = conf.W; H = conf.H;
    const horizontal = formato === "16:9";
    const genero = g.genero || "general";

    // El AudioContext se crea de inmediato (dentro del toque del usuario) para que el navegador lo permita.
    const audio = opts.audio || new (window.AudioContext || window.webkitAudioContext)();
    const ui = panelProgreso(panel);
    let wake = null;
    try { if (navigator.wakeLock) wake = await navigator.wakeLock.request("screen"); } catch (_) {}

    try {
      const escenasG = g.escenas || [];

      // frases que se leen en voz alta: primero el gancho y el título, luego la narración
      const items = [];
      if (g.intro && g.intro.hablado) {
        items.push({ tipo: "gancho", si: 0, texto: g.intro.hablado, dato: g.intro.dato, buffer: null });
        if (g.intro.titulo) items.push({ tipo: "titulo", si: 0, texto: g.intro.titulo, titulo: g.intro.titulo, buffer: null });
      }
      escenasG.forEach((e, si) => frasesDe(e).forEach((f, k) =>
        items.push({ tipo: "narracion", si, k, texto: String(f), buffer: null })));

      // tomas: cada una es una imagen que sigue la acción de esa parte de la escena
      const tomas = [];
      escenasG.forEach((e, si) => {
        const lista = e.tomas && e.tomas.length
          ? e.tomas
          : [{ prompt: e.prompt_imagen || e.escenografia || g.titulo }];
        lista.forEach((t) => tomas.push({
          si, prompt: t.prompt || t.imagen || e.escenografia || g.titulo, desde: t.desde,
          img: null, fondo: null, mov: null, ini: 0, fin: 0,
        }));
      });

      const total = tomas.length + items.length;
      let hechos = 0;
      let fallosVoz = 0, ultimoErrorVoz = "";
      const erroresImg = [];
      const avance = (texto) => { hechos++; ui.set(texto, (hechos / total) * 70, hechos + " de " + total + " elementos listos"); };

      ui.paso(1);
      ui.set("Creando imágenes y voz...", 0, "0 de " + total + " elementos listos");

      const tareasImg = tomas.map((tm, i) => async () => {
        try {
          tm.img = await pedirImagen(tm.prompt, genero, formato);
          if (!coincideProporcion(tm.img)) tm.fondo = fondoDesenfocado(tm.img);
        } catch (e) { erroresImg.push(e.message); }
        avance("Creando imágenes según la acción... (" + (i + 1) + " de " + tomas.length + ")");
      });
      const tareasVoz = items.map((it) => async () => {
        try {
          const r = await post("/api/voz", { texto: it.texto, lang: "es" });
          it.buffer = await audio.decodeAudioData(b64ABuffer(r.audio));
        } catch (e) { fallosVoz++; ultimoErrorVoz = e.message; }
        avance("Creando la voz del narrador...");
      });
      await Promise.all([enParalelo(tareasImg, 2), enParalelo(tareasVoz, 3)]);

      if (fallosVoz === items.length && items.length) {
        throw new Error("No se pudo crear ninguna voz. Último error: " + ultimoErrorVoz);
      }

      // Si una imagen falló, se reutiliza la toma más cercana (se mueve distinto) en vez de dejar fondo vacío.
      const fallidas = tomas.filter((x) => !x.img).length;
      tomas.forEach((x, i) => {
        if (x.img) return;
        for (let d = 1; d < tomas.length; d++) {
          const c = tomas[i - d] && tomas[i - d].img ? tomas[i - d] : (tomas[i + d] && tomas[i + d].img ? tomas[i + d] : null);
          if (c) { x.img = c.img; x.fondo = c.fondo; break; }
        }
      });
      tomas.forEach((x, i) => { x.mov = MOVS[i % MOVS.length]; });

      // línea de tiempo (si se pasa del límite del formato, se acelera un poco la voz)
      let tl = construirTimeline(escenasG, items, tomas, 1);
      let factor = 1;
      if (tl.total > conf.maxSeg) {
        factor = Math.min(1.2, tl.total / conf.maxSeg);
        tl = construirTimeline(escenasG, items, tomas, factor);
      }
      const totalSeg = tl.total;
      const lineas = tl.lineas;

      // canvas + grabadora
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");
      const estado = { tomas, lineas, total: totalSeg, horizontal };

      const destino = audio.createMediaStreamDestination();
      const flujo = canvas.captureStream(FPS);
      destino.stream.getAudioTracks().forEach((tr) => flujo.addTrack(tr));

      const mime = elegirFormato();
      const rec = new MediaRecorder(flujo, Object.assign(
        { videoBitsPerSecond: conf.bitrate, audioBitsPerSecond: 128000 },
        mime ? { mimeType: mime } : {}
      ));
      const trozos = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) trozos.push(e.data); };
      const terminado = new Promise((ok) => { rec.onstop = ok; });

      await audio.resume();
      const t0 = audio.currentTime + 0.3;
      try { musicaFondo(audio, destino, t0, totalSeg, genero); } catch (_) {}
      lineas.forEach((l) => {
        if (!l.buffer) return;
        const src = audio.createBufferSource();
        src.buffer = l.buffer;
        src.playbackRate.value = l.rate;
        src.connect(destino);
        src.start(t0 + l.ini);
      });

      ui.paso(2);
      dibujarFrame(ctx, estado, 0);
      rec.start(1000);

      await new Promise((fin) => {
        function paso() {
          const t_ = Math.max(0, audio.currentTime - t0);
          dibujarFrame(ctx, estado, Math.min(t_, totalSeg));
          ui.set("Grabando el video... no cierres ni apagues la pantalla",
                 70 + Math.min(1, t_ / totalSeg) * 30,
                 Math.min(Math.round(t_), Math.round(totalSeg)) + " s de " + Math.round(totalSeg) + " s");
          if (t_ >= totalSeg) fin(); else requestAnimationFrame(paso);
        }
        requestAnimationFrame(paso);
      });

      await esperar(300);
      rec.stop();
      await terminado;

      const tipoCrudo = rec.mimeType || mime || "video/webm";
      const crudo = new Blob(trozos, { type: tipoCrudo });
      // El archivo que graba el navegador no trae la duración en la cabecera (otras apps lo leen como 3 s): se repara.
      ui.set("Preparando el archivo para que dure completo en cualquier app...", 100, "");
      const rep = window.ArreglarVideo
        ? await window.ArreglarVideo.reparar(crudo, totalSeg)
        : { blob: crudo, reparado: false, duracion: totalSeg };
      const blob = rep.blob;
      const tipo = blob.type || tipoCrudo;
      const url = URL.createObjectURL(blob);
      let guardado = false;
      if (opts.id && window.Almacen) {
        try { await window.Almacen.guardarVideo(opts.id, blob, tipo, rep.reparado); guardado = true; } catch (_) {}
      }
      const rehacer = () => {
        const nuevoAudio = new (window.AudioContext || window.webkitAudioContext)();
        generar(g, panel, { audio: nuevoAudio, id: opts.id });
      };
      panelListo(panel, url, tipo, g, totalSeg, guardado, rehacer, blob, rep);

      const avisos = [];
      if (fallidas) {
        const detalle = erroresImg.length ? " Motivo: " + erroresImg[0] : "";
        avisos.push(fallidas + " de " + tomas.length + " imagen(es) no se pudieron crear y se reutilizó otra." + detalle);
      }
      if (fallosVoz) avisos.push(fallosVoz + " frase(s) no tuvieron voz y salen solo con subtítulo.");
      if (factor > 1) avisos.push("La narración se aceleró un " + Math.round((factor - 1) * 100) + "% para respetar el límite de " + Math.round(conf.maxSeg / 60) + " min.");
      if (tl.total > conf.maxSeg * 1.05) avisos.push("El video quedó de " + Math.round(totalSeg) + " s, por encima del límite de " + conf.maxSeg + " s.");
      if (avisos.length) {
        panel.insertAdjacentHTML("beforeend",
          `<p class="mt-3 text-xs text-yellow-200 break-words">Aviso: ${esc(avisos.join(" "))} Puedes volver a generar el video.</p>`);
      }
    } catch (e) {
      panelError(panel, "No se pudo generar el video: " + e.message);
    }

    try { if (wake) await wake.release(); } catch (_) {}
    try { await audio.close(); } catch (_) {}
    enCurso = false;
  }

  window.GeneradorVideo = { generar, ocupado: () => enCurso };
})();
