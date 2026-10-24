// Generador de video 9:16 dentro del navegador (sin servidor de video).
// Flujo: una imagen por "toma" (según la acción del guion) + voz por diálogo
//        -> se dibuja en un canvas con movimiento de cámara y subtítulos -> MediaRecorder lo graba.
(function () {
  "use strict";

  const W = 720;          // 9:16 -> 720 x 1280
  const H = 1280;
  const FPS = 30;
  const PAUSA = 0.35;     // segundos entre diálogos
  const FADE = 0.5;       // segundos de transición entre tomas
  const PALABRAS_POR_SEG = 2.5;

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  const iconos = () => { if (window.lucide) lucide.createIcons(); };
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

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
  async function pedirImagen(prompt) {
    let ultimo = null;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch("/api/imagen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
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

  // ---------- panel de progreso ----------
  const PASOS = ["Guion", "Imágenes y voces", "Grabación", "Listo"];

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

  function panelListo(panel, url, mime, titulo, segundos, guardado, rehacer, extra) {
    const ext = mime.indexOf("mp4") >= 0 ? "mp4" : "webm";
    const nombre = (titulo || "video").toLowerCase().replace(/[^a-z0-9áéíóúñ]+/gi, "-").replace(/^-+|-+$/g, "") + "." + ext;
    panel.innerHTML = `
      <div class="grid gap-5 lg:grid-cols-[auto_1fr] items-start">
        <video src="${url}" controls playsinline class="mx-auto rounded-2xl border border-purple-500/40 bg-black brillo"
               style="aspect-ratio:9/16; max-height:75vh; width:auto; max-width:100%"></video>
        <div class="space-y-3 min-w-0">
          <p class="flex items-center gap-2 font-semibold text-lg"><i data-lucide="circle-check" class="w-5 h-5 text-purple-400"></i> ¡Tu video está listo!</p>
          <p class="text-sm text-purple-300">${W}×${H} (9:16) · ~${Math.round(segundos)} s · formato ${esc(ext.toUpperCase())}</p>
          ${guardado ? '<p class="flex items-center gap-1.5 text-sm text-purple-200"><i data-lucide="circle-check" class="w-4 h-4 text-purple-400"></i> Guardado en Mis videos</p>' : ""}
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
    if (window.Publicar && extra && extra.blob) {
      window.Publicar.montar(panel.querySelector("#vPublicar"), {
        blob: extra.blob, mime, nombre, titulo, descripcion: extra.descripcion, tema: extra.tema,
      });
    }
  }

  // ---------- voces: velocidad distinta por personaje ----------
  // MeloTTS tiene una sola voz; para diferenciar personajes se cambia un poco la velocidad/tono.
  function velocidades(personajes) {
    const mapa = {};
    let h = 0, m = 0;
    (personajes || []).forEach((p) => {
      const mujer = String(p.genero || "").toLowerCase().startsWith("muj");
      if (mujer) { mapa[p.nombre] = 1.10 - 0.05 * m; m++; }
      else { mapa[p.nombre] = 0.92 + 0.05 * h; h++; }
    });
    return mapa;
  }

  // ---------- dibujo ----------
  // Para imágenes cuadradas (respaldo FLUX): fondo desenfocado de la misma imagen.
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

  function esVertical(img) { return img.width / img.height < 0.8; }

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
    const vertical = esVertical(img);

    let bw, bh;
    if (vertical) {
      const k = Math.max(W / img.width, H / img.height);
      bw = img.width * k; bh = img.height * k;     // cubre todo el cuadro
    } else {
      if (toma.fondo) ctx.drawImage(toma.fondo, 0, 0, W, H);
      bw = W; bh = (W * img.height) / img.width;
    }
    const z = mov.z0 + (mov.z1 - mov.z0) * e;
    const w = bw * z, h = bh * z;
    const px = mov.x0 + (mov.x1 - mov.x0) * e;
    const py = mov.y0 + (mov.y1 - mov.y0) * e;
    const left = (W - w) / 2 + (px * Math.max(0, w - W)) / 2;
    const top = vertical ? (H - h) / 2 + (py * Math.max(0, h - H)) / 2 : (H - h) / 2 - 90;
    ctx.drawImage(img, left, top, w, h);
  }

  function dibujarFrame(ctx, estado, t) {
    const { tomas, lineas, titulo, total } = estado;

    // toma activa
    let k = tomas.length - 1;
    for (let i = 0; i < tomas.length; i++) { if (t < tomas[i].fin) { k = i; break; } }
    const tk = tomas[k];
    const p = Math.max(0, Math.min(1, (t - tk.ini) / Math.max(0.1, tk.fin - tk.ini)));

    ctx.fillStyle = "#0b0613";
    ctx.fillRect(0, 0, W, H);
    if (k > 0 && t - tk.ini < FADE) {              // transición suave entre tomas
      dibujarToma(ctx, tomas[k - 1], 1);
      ctx.globalAlpha = Math.max(0, Math.min(1, (t - tk.ini) / FADE));
      dibujarToma(ctx, tk, p);
      ctx.globalAlpha = 1;
    } else {
      dibujarToma(ctx, tk, p);
    }

    // degradado inferior para los subtítulos
    const deg = ctx.createLinearGradient(0, H * 0.55, 0, H);
    deg.addColorStop(0, "rgba(11,6,19,0)");
    deg.addColorStop(1, "rgba(11,6,19,0.88)");
    ctx.fillStyle = deg; ctx.fillRect(0, H * 0.55, W, H * 0.45);

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    // título al inicio
    if (t < 3.2) {
      ctx.globalAlpha = t < 2.6 ? 1 : Math.max(0, (3.2 - t) / 0.6);
      ctx.font = "bold 46px sans-serif";
      const ls = envolver(ctx, titulo, W - 100);
      ls.forEach((l, i) => textoConBorde(ctx, l, W / 2, 130 + i * 56, "#ffffff"));
      ctx.globalAlpha = 1;
    }

    // subtítulo activo
    const lin = lineas.find((l) => t >= l.ini && t < l.fin + PAUSA);
    if (lin) {
      ctx.font = "bold 38px sans-serif";
      const ls = envolver(ctx, lin.texto, W - 90);
      const alto = 46;
      const base = H - 190 - (ls.length - 1) * alto;
      ctx.font = "bold 30px sans-serif";
      textoConBorde(ctx, String(lin.personaje || "").toUpperCase(), W / 2, base - 52, "#d8b4fe");
      ctx.font = "bold 38px sans-serif";
      ls.forEach((l, i) => textoConBorde(ctx, l, W / 2, base + i * alto, "#ffffff"));
    }

    // barra de progreso
    ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(0, H - 8, W, 8);
    ctx.fillStyle = "#a855f7"; ctx.fillRect(0, H - 8, W * Math.min(1, t / total), 8);
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

  // ---------- proceso principal ----------
  async function generar(g, panel, opts) {
    opts = opts || {};
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      panelError(panel, "Este navegador no puede grabar video. Prueba con Chrome o Brave actualizado.");
      return;
    }
    if (enCurso) return;
    enCurso = true;

    // El AudioContext se crea de inmediato (dentro del toque del usuario) para que el navegador lo permita.
    const audio = opts.audio || new (window.AudioContext || window.webkitAudioContext)();
    const ui = panelProgreso(panel);
    let wake = null;
    try { if (navigator.wakeLock) wake = await navigator.wakeLock.request("screen"); } catch (_) {}

    try {
      const escenasG = g.escenas || [];
      const velo = velocidades(g.personajes);

      // diálogos
      const items = [];
      escenasG.forEach((e, si) => (e.dialogos || []).forEach((d) =>
        items.push({ si, personaje: d.personaje, texto: String(d.texto || ""), buffer: null })));

      // tomas: cada una es una imagen que sigue la acción de esa parte de la escena
      const tomas = [];
      escenasG.forEach((e, si) => {
        const lista = e.tomas && e.tomas.length
          ? e.tomas
          : [{ prompt: e.prompt_imagen || e.escenografia || g.titulo }];
        lista.forEach((t) => tomas.push({
          si, prompt: t.prompt || t.imagen || e.escenografia || g.titulo,
          img: null, fondo: null, mov: null, ini: 0, fin: 0,
        }));
      });

      const total = tomas.length + items.length;
      let hechos = 0;
      let fallosVoz = 0, ultimoErrorVoz = "";
      const erroresImg = [];
      const avance = (texto) => { hechos++; ui.set(texto, (hechos / total) * 70, hechos + " de " + total + " elementos listos"); };

      ui.paso(1);
      ui.set("Creando imágenes y voces...", 0, "0 de " + total + " elementos listos");

      const tareasImg = tomas.map((tm, i) => async () => {
        try {
          tm.img = await pedirImagen(tm.prompt);
          if (!esVertical(tm.img)) tm.fondo = fondoDesenfocado(tm.img);
        } catch (e) { erroresImg.push(e.message); }
        avance("Creando imágenes según la acción... (" + (i + 1) + " de " + tomas.length + ")");
      });
      const tareasVoz = items.map((it) => async () => {
        try {
          const r = await post("/api/voz", { texto: it.texto, lang: "es" });
          it.buffer = await audio.decodeAudioData(b64ABuffer(r.audio));
        } catch (e) { fallosVoz++; ultimoErrorVoz = e.message; }
        avance("Creando voces...");
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

      // línea de tiempo
      let t = 0.6;
      const lineas = [];
      escenasG.forEach((e, si) => {
        const iniEscena = si === 0 ? 0 : t;
        const its = items.filter((it) => it.si === si);
        const inicios = [];
        its.forEach((it) => {
          const rate = velo[it.personaje] || 1;
          const palabras = it.texto.trim().split(/\s+/).filter(Boolean).length;
          const dur = it.buffer ? it.buffer.duration / rate : Math.max(2, palabras / PALABRAS_POR_SEG);
          inicios.push(t);
          lineas.push({ ini: t, fin: t + dur, personaje: it.personaje, texto: it.texto, buffer: it.buffer, rate });
          t += dur + PAUSA;
        });
        if (t - iniEscena < 2) t = iniEscena + 2;
        const mias = tomas.filter((x) => x.si === si);
        mias.forEach((x, j) => {
          const k = its.length ? Math.floor((j * its.length) / mias.length) : 0;
          x.ini = j === 0 ? iniEscena : (its.length ? inicios[k] : iniEscena + ((t - iniEscena) * j) / mias.length);
        });
      });
      const totalSeg = t + 0.8;
      tomas.forEach((x, i) => { x.fin = i + 1 < tomas.length ? tomas[i + 1].ini : totalSeg; });

      // canvas + grabadora
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");
      const estado = { tomas, lineas, titulo: g.titulo || "", total: totalSeg };

      const destino = audio.createMediaStreamDestination();
      const flujo = canvas.captureStream(FPS);
      destino.stream.getAudioTracks().forEach((tr) => flujo.addTrack(tr));

      const mime = elegirFormato();
      const rec = new MediaRecorder(flujo, Object.assign(
        { videoBitsPerSecond: 2500000, audioBitsPerSecond: 128000 },
        mime ? { mimeType: mime } : {}
      ));
      const trozos = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) trozos.push(e.data); };
      const terminado = new Promise((ok) => { rec.onstop = ok; });

      await audio.resume();
      const t0 = audio.currentTime + 0.3;
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

      const tipo = rec.mimeType || mime || "video/webm";
      const blob = new Blob(trozos, { type: tipo });
      const url = URL.createObjectURL(blob);
      let guardado = false;
      if (opts.id && window.Almacen) {
        try { await window.Almacen.guardarVideo(opts.id, blob, tipo); guardado = true; } catch (_) {}
      }
      const rehacer = () => {
        const nuevoAudio = new (window.AudioContext || window.webkitAudioContext)();
        generar(g, panel, { audio: nuevoAudio, id: opts.id });
      };
      panelListo(panel, url, tipo, g.titulo, totalSeg, guardado, rehacer,
        { blob, descripcion: g.sinopsis || "", tema: g.tema || opts.tema || "" });

      const avisos = [];
      if (fallidas) {
        const detalle = erroresImg.length ? " Motivo: " + erroresImg[0] : "";
        avisos.push(fallidas + " de " + tomas.length + " imagen(es) no se pudieron crear y se reutilizó otra." + detalle);
      }
      if (fallosVoz) avisos.push(fallosVoz + " voz/voces no se pudieron crear y esas líneas salen solo con subtítulo");
      if (avisos.length) {
        panel.insertAdjacentHTML("beforeend",
          `<p class="mt-3 text-xs text-yellow-200 break-words">Aviso: ${esc(avisos.join("; "))} Puedes volver a generar el video.</p>`);
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
