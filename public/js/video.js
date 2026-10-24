// Generador de video 9:16 dentro del navegador (sin servidor de video).
// Flujo: imagen por escena (/api/imagen) + voz por diálogo (/api/voz)
//        -> se dibuja en un canvas con subtítulos -> MediaRecorder lo graba.
(function () {
  "use strict";

  const W = 720;          // 9:16 -> 720 x 1280
  const H = 1280;
  const FPS = 30;
  const PAUSA = 0.35;     // segundos entre diálogos
  const PALABRAS_POR_SEG = 2.5;

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  const iconos = () => { if (window.lucide) lucide.createIcons(); };
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  let enCurso = false;

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

  function cargarImagen(b64) {
    return new Promise((ok, mal) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = () => mal(new Error("Imagen inválida"));
      im.src = "data:image/jpeg;base64," + b64;
    });
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
  function panelProgreso(panel) {
    panel.innerHTML = `
      <div class="rounded-xl border border-purple-500/30 bg-[#140a24] p-4">
        <p class="flex items-center gap-2 text-purple-100">
          <i data-lucide="loader-circle" class="w-5 h-5 animate-spin text-purple-400 shrink-0"></i>
          <span id="vTexto">Preparando...</span></p>
        <div class="mt-3 h-3 rounded-full bg-purple-950 overflow-hidden">
          <div id="vBarra" class="h-full rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500 transition-all" style="width:0%"></div>
        </div>
        <p id="vDetalle" class="mt-2 text-xs text-purple-300"></p>
      </div>`;
    iconos();
    return {
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

  function panelListo(panel, url, mime, titulo, segundos) {
    const ext = mime.indexOf("mp4") >= 0 ? "mp4" : "webm";
    const nombre = (titulo || "video").toLowerCase().replace(/[^a-z0-9áéíóúñ]+/gi, "-").replace(/^-+|-+$/g, "") + "." + ext;
    panel.innerHTML = `
      <div class="grid gap-5 lg:grid-cols-[auto_1fr] items-start">
        <video src="${url}" controls playsinline class="mx-auto rounded-2xl border border-purple-500/40 bg-black brillo"
               style="aspect-ratio:9/16; max-height:75vh; width:auto; max-width:100%"></video>
        <div class="space-y-3">
          <p class="flex items-center gap-2 font-semibold text-lg"><i data-lucide="circle-check" class="w-5 h-5 text-purple-400"></i> ¡Tu video está listo!</p>
          <p class="text-sm text-purple-300">${W}×${H} (9:16) · ~${Math.round(segundos)} s · formato ${esc(ext.toUpperCase())}</p>
          <div class="flex flex-wrap gap-3">
            <a href="${url}" download="${esc(nombre)}" class="flex items-center gap-2 rounded-xl bg-purple-500 hover:bg-purple-400 px-5 py-2.5 font-semibold text-white brillo">
              <i data-lucide="download" class="w-4 h-4"></i> Descargar</a>
            <button id="vCompartir" class="flex items-center gap-2 rounded-xl border border-purple-400/50 px-5 py-2.5 text-purple-100 hover:bg-purple-500/20">
              <i data-lucide="share-2" class="w-4 h-4"></i> Compartir</button>
          </div>
          ${ext === "webm" ? '<p class="text-xs text-purple-300">Tu navegador grabó en WebM. YouTube y TikTok lo aceptan; si alguna red lo rechaza, habrá que convertirlo a MP4 en la fase de publicación.</p>' : ""}
        </div>
      </div>`;
    iconos();
    const btn = panel.querySelector("#vCompartir");
    btn.addEventListener("click", async () => {
      try {
        const blob = await (await fetch(url)).blob();
        const archivo = new File([blob], nombre, { type: mime });
        if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
          await navigator.share({ files: [archivo], title: titulo });
        } else {
          btn.textContent = "Tu navegador no permite compartir archivos; usa Descargar";
        }
      } catch (_) { /* el usuario canceló */ }
    });
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

  function dibujarFrame(ctx, estado, t) {
    const { escenas, imagenes, fondos, lineas, titulo, total } = estado;

    // escena activa
    let si = escenas.length - 1;
    for (let i = 0; i < escenas.length; i++) { if (t < escenas[i].fin) { si = i; break; } }
    const esc_ = escenas[si];
    const prog = Math.max(0, Math.min(1, (t - esc_.ini) / Math.max(0.1, esc_.fin - esc_.ini)));

    // fondo
    if (imagenes[si]) {
      ctx.drawImage(fondos[si], 0, 0, W, H);
      const zoom = 1 + 0.12 * prog;               // Ken Burns lento
      const lado = W * zoom;
      ctx.drawImage(imagenes[si], (W - lado) / 2, (H - lado) / 2 - 90, lado, lado);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#3b0a6b"); g.addColorStop(1, "#0b0613");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center"; ctx.font = "bold 140px sans-serif";
      textoConBorde(ctx, String(si + 1), W / 2, H / 2 - 40, "#c084fc");
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
  async function generar(g, panel) {
    if (enCurso) return;
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      panelError(panel, "Este navegador no puede grabar video. Prueba con Chrome o Brave actualizado.");
      return;
    }
    enCurso = true;

    // El AudioContext se crea de inmediato (dentro del toque del usuario) para que el navegador lo permita.
    const audio = new (window.AudioContext || window.webkitAudioContext)();
    const ui = panelProgreso(panel);
    let wake = null;
    try { if (navigator.wakeLock) wake = await navigator.wakeLock.request("screen"); } catch (_) {}

    try {
      const escenasG = g.escenas || [];
      const velo = velocidades(g.personajes);

      // lista de diálogos
      const items = [];
      escenasG.forEach((e, si) => (e.dialogos || []).forEach((d) =>
        items.push({ si, personaje: d.personaje, texto: String(d.texto || ""), buffer: null })));

      const imagenes = new Array(escenasG.length).fill(null);
      const fondos = new Array(escenasG.length).fill(null);
      const total = escenasG.length + items.length;
      let hechos = 0;
      let fallosImg = 0, fallosVoz = 0, ultimoErrorVoz = "";
      const avance = (texto) => { hechos++; ui.set(texto, (hechos / total) * 70, hechos + " de " + total + " elementos listos"); };

      ui.set("Creando imágenes y voces...", 0, "0 de " + total + " elementos listos");

      // imágenes (2 a la vez) y voces (3 a la vez)
      const tareasImg = escenasG.map((e, i) => async () => {
        try {
          const r = await post("/api/imagen", { prompt: e.prompt_imagen || e.escenografia || g.titulo });
          imagenes[i] = await cargarImagen(r.image);
          fondos[i] = fondoDesenfocado(imagenes[i]);
        } catch (_) { fallosImg++; }
        avance("Creando imágenes... (escena " + (i + 1) + ")");
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

      // línea de tiempo
      let t = 0.6;
      const escenas = [];
      const lineas = [];
      escenasG.forEach((e, si) => {
        const ini = si === 0 ? 0 : t;
        items.filter((it) => it.si === si).forEach((it) => {
          const rate = velo[it.personaje] || 1;
          const palabras = it.texto.trim().split(/\s+/).filter(Boolean).length;
          const dur = it.buffer ? it.buffer.duration / rate : Math.max(2, palabras / PALABRAS_POR_SEG);
          lineas.push({ ini: t, fin: t + dur, personaje: it.personaje, texto: it.texto, buffer: it.buffer, rate });
          t += dur + PAUSA;
        });
        if (t - ini < 2) t = ini + 2;
        escenas.push({ ini, fin: t });
      });
      const totalSeg = t + 0.8;
      escenas[escenas.length - 1].fin = totalSeg;

      // canvas + grabadora
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");
      const estado = { escenas, imagenes, fondos, lineas, titulo: g.titulo || "", total: totalSeg };

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
      panelListo(panel, url, tipo, g.titulo, totalSeg);

      const avisos = [];
      if (fallosImg) avisos.push(fallosImg + " imagen(es) no se pudieron crear y se usó un fondo morado");
      if (fallosVoz) avisos.push(fallosVoz + " voz/voces no se pudieron crear y esas líneas salen solo con subtítulo");
      if (avisos.length) {
        panel.insertAdjacentHTML("beforeend",
          `<p class="mt-3 text-xs text-yellow-200">Aviso: ${esc(avisos.join("; "))}. Puedes volver a generar el video.</p>`);
      }
    } catch (e) {
      panelError(panel, "No se pudo generar el video: " + e.message);
    }

    try { if (wake) await wake.release(); } catch (_) {}
    try { await audio.close(); } catch (_) {}
    enCurso = false;
  }

  window.GeneradorVideo = { generar };
})();
