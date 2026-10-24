// Lógica de la página "Crear": historias -> elegir -> guion completo 9:16.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  const iconos = () => { if (window.lucide) lucide.createIcons(); };

  const CATEGORIAS = [
    ["Historia de México", "landmark"],
    ["Terror", "ghost"],
    ["Anime", "swords"],
    ["Misterio", "search"],
    ["Comedia", "laugh"],
    ["Ciencia ficción", "rocket"],
  ];

  let historias = [];
  let elegida = -1;
  let temaActual = "";
  let ocupado = false;

  // ---------- utilidades ----------
  async function llamar(ruta, cuerpo) {
    const r = await fetch(ruta, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    let data;
    try { data = await r.json(); }
    catch (_) { throw new Error("Respuesta inválida del servidor (" + r.status + ")"); }
    if (!r.ok || data.error) throw new Error(data.error || "Error desconocido");
    return data;
  }

  function estado(tipo, texto) {
    const c = $("estado");
    if (tipo === "cargando") {
      c.className = "mb-4";
      c.innerHTML = `<div class="flex items-center gap-3 rounded-xl border border-purple-500/30 bg-purple-950/40 p-4 text-purple-200">
        <i data-lucide="loader-circle" class="w-5 h-5 animate-spin text-purple-400 shrink-0"></i><span>${esc(texto)}</span></div>`;
    } else if (tipo === "error") {
      c.className = "mb-4";
      c.innerHTML = `<div class="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-950/30 p-4 text-red-200">
        <i data-lucide="triangle-alert" class="w-5 h-5 mt-0.5 shrink-0"></i><span class="break-words">${esc(texto)}</span></div>`;
    } else {
      c.className = "hidden";
      c.innerHTML = "";
    }
    iconos();
  }

  function guardarGuion(g) {
    try {
      const lista = JSON.parse(localStorage.getItem("vi_guiones") || "[]");
      lista.unshift(Object.assign({ id: Date.now(), fecha: new Date().toISOString(), tema: temaActual }, g));
      localStorage.setItem("vi_guiones", JSON.stringify(lista.slice(0, 20)));
      return true;
    } catch (_) { return false; }
  }

  // ---------- chips ----------
  function pintarChips() {
    $("chips").innerHTML = CATEGORIAS.map((c) =>
      `<button type="button" data-tema="${esc(c[0])}" class="chip flex items-center gap-1.5 rounded-full border border-purple-500/40 bg-purple-900/40 hover:bg-purple-500/30 px-3 py-1.5 text-sm text-purple-100">
         <i data-lucide="${c[1]}" class="w-4 h-4 text-purple-300"></i>${esc(c[0])}</button>`
    ).join("");
  }

  // ---------- historias ----------
  function pintarVacio() {
    $("resultados").innerHTML = `<div class="col-span-full rounded-2xl border border-dashed border-purple-500/40 p-10 text-center text-purple-300">
      <i data-lucide="sparkles" class="w-10 h-10 mx-auto mb-3 text-purple-400"></i>
      <p class="text-lg">Tus 5 historias aparecerán aquí</p>
      <p class="text-sm mt-1">Escribe un tema y toca “Generar 5 historias”.</p></div>`;
    iconos();
  }

  function tarjeta(h, i) {
    const sel = i === elegida;
    const personajes = (h.personajes || []).map((p) =>
      `<li class="text-sm"><span class="font-semibold text-purple-200">${esc(p.nombre)}</span>
       <span class="text-purple-300/90">— ${esc(p.descripcion || "")}</span></li>`).join("");
    const muestra = (h.dialogo_muestra || h.dialogos || []).map((d) =>
      `<p class="text-sm"><span class="font-semibold text-purple-300">${esc(d.personaje)}:</span> ${esc(d.texto)}</p>`).join("");

    return `<article class="flex flex-col rounded-2xl border ${sel ? "border-purple-400 bg-purple-900/50 brillo" : "border-purple-500/30 bg-purple-950/40"} p-4 sm:p-5">
      <h3 class="font-bold text-xl leading-snug"><span class="text-purple-400">${i + 1}.</span> ${esc(h.titulo)}</h3>
      <p class="mt-2 text-purple-100/90">${esc(h.sinopsis || h.trama)}</p>

      <div class="mt-3 rounded-xl bg-[#140a24] p-3 space-y-1.5">
        <p class="flex items-center gap-2 text-sm font-semibold text-purple-300"><i data-lucide="map-pin" class="w-4 h-4"></i> Escenografía</p>
        <p class="text-sm text-purple-100/90">${esc(h.escenografia)}</p>
        <p class="flex items-center gap-2 text-sm text-purple-300 pt-1"><i data-lucide="palette" class="w-4 h-4"></i> ${esc(h.estilo_visual)}</p>
      </div>

      <ul class="mt-3 space-y-1">${personajes}</ul>

      <details class="mt-3">
        <summary class="cursor-pointer flex items-center gap-2 text-sm text-purple-300 select-none">
          <i data-lucide="message-square-text" class="w-4 h-4"></i> Ver diálogo de muestra</summary>
        <div class="mt-2 space-y-1.5 rounded-xl bg-[#140a24] p-3">${muestra}</div>
      </details>

      <div class="flex-1"></div>
      <button data-i="${i}" class="elegir mt-5 w-full flex items-center justify-center gap-2 rounded-xl py-2.5 font-medium
        ${sel ? "bg-purple-500 text-white" : "border border-purple-400/60 text-purple-100 hover:bg-purple-500/20"}">
        <i data-lucide="${sel ? "circle-check" : "mouse-pointer-click"}" class="w-4 h-4"></i>${sel ? "Elegida" : "Elegir esta historia"}</button>
    </article>`;
  }

  function pintarHistorias() {
    $("resultados").innerHTML = historias.map(tarjeta).join("");
    iconos();
  }

  function elegir(i) {
    elegida = i;
    pintarHistorias();
    $("tituloElegida").textContent = historias[i].titulo || "";
    $("barra").classList.remove("hidden");
  }

  async function generar() {
    if (ocupado) return;
    const tema = $("tema").value.trim();
    if (!tema) { estado("error", "Escribe primero de qué quieres el video."); return; }

    ocupado = true;
    temaActual = tema;
    elegida = -1;
    historias = [];
    $("btnGenerar").disabled = true;
    $("barra").classList.add("hidden");
    $("guion").classList.add("hidden");
    $("guion").innerHTML = "";
    $("resultados").classList.remove("hidden");
    $("resultados").innerHTML = "";
    estado("cargando", "La IA está escribiendo 5 historias con sinopsis y escenografía... puede tardar hasta 40 segundos.");

    try {
      const data = await llamar("/api/historias", { tema });
      historias = data.historias;
      estado();
      pintarHistorias();
    } catch (e) {
      estado("error", "No se pudieron generar las historias: " + e.message);
      pintarVacio();
    }
    ocupado = false;
    $("btnGenerar").disabled = false;
  }

  // ---------- guion completo ----------
  function tiempo(seg) {
    return Math.floor(seg / 60) + ":" + String(seg % 60).padStart(2, "0");
  }

  function pintarGuion(g, guardado) {
    const escenas = (g.escenas || []).map((e, idx) => {
      const dialogos = (e.dialogos || []).map((d) =>
        `<p class="text-sm"><span class="font-semibold text-purple-300">${esc(d.personaje)}:</span> ${esc(d.texto)}</p>`).join("");
      return `<article class="flex gap-3 rounded-2xl border border-purple-500/30 bg-purple-950/40 p-4">
        <div class="shrink-0 w-14 aspect-[9/16] rounded-lg bg-gradient-to-b from-purple-500 to-fuchsia-600 flex items-center justify-center font-bold text-lg brillo">${esc(e.numero || idx + 1)}</div>
        <div class="min-w-0 flex-1 space-y-2">
          <p class="flex items-start gap-2 text-sm text-purple-100/90"><i data-lucide="map-pin" class="w-4 h-4 mt-0.5 shrink-0 text-purple-300"></i><span>${esc(e.escenografia)}</span></p>
          <div class="space-y-1.5">${dialogos}</div>
          <details>
            <summary class="cursor-pointer flex items-center gap-2 text-xs text-purple-300 select-none"><i data-lucide="images" class="w-4 h-4"></i> Prompt de imagen 9:16</summary>
            <p class="mt-1 text-xs text-purple-200 break-words">${esc(e.prompt_imagen)}, vertical 9:16 composition</p>
          </details>
        </div>
      </article>`;
    }).join("");

    const aviso = g.corto
      ? `<div class="flex items-start gap-3 rounded-xl border border-yellow-500/40 bg-yellow-950/30 p-4 text-yellow-100 mb-4">
           <i data-lucide="triangle-alert" class="w-5 h-5 mt-0.5 shrink-0"></i>
           <span>El guion quedó más corto de 2 minutos. Toca “Regenerar guion” para intentar uno más largo.</span></div>`
      : "";

    $("guion").innerHTML = `
      <div class="flex flex-wrap items-center gap-3 mb-4">
        <button id="btnVolver" class="flex items-center gap-2 rounded-xl border border-purple-400/50 px-4 py-2 text-purple-100 hover:bg-purple-500/20">
          <i data-lucide="arrow-left" class="w-4 h-4"></i> Volver a las historias</button>
        <button id="btnRegenerar" class="flex items-center gap-2 rounded-xl border border-purple-400/50 px-4 py-2 text-purple-100 hover:bg-purple-500/20">
          <i data-lucide="refresh-cw" class="w-4 h-4"></i> Regenerar guion</button>
      </div>
      <h2 class="text-2xl font-bold">${esc(g.titulo)}</h2>
      <div class="flex flex-wrap gap-2 my-3">
        <span class="inline-flex items-center gap-1.5 rounded-full bg-purple-500/20 px-3 py-1 text-sm"><i data-lucide="smartphone" class="w-4 h-4"></i> ${esc(g.formato)} · ${esc(g.resolucion)}</span>
        <span class="inline-flex items-center gap-1.5 rounded-full bg-purple-500/20 px-3 py-1 text-sm"><i data-lucide="clock" class="w-4 h-4"></i> ~${tiempo(g.duracion_estimada)} min</span>
        <span class="inline-flex items-center gap-1.5 rounded-full bg-purple-500/20 px-3 py-1 text-sm"><i data-lucide="film" class="w-4 h-4"></i> ${(g.escenas || []).length} escenas</span>
        <span class="inline-flex items-center gap-1.5 rounded-full bg-purple-500/20 px-3 py-1 text-sm"><i data-lucide="message-square-text" class="w-4 h-4"></i> ${g.palabras} palabras</span>
        ${guardado ? '<span class="inline-flex items-center gap-1.5 rounded-full bg-purple-500/20 px-3 py-1 text-sm"><i data-lucide="circle-check" class="w-4 h-4"></i> Guardado en Mis videos</span>' : ""}
      </div>
      ${aviso}
      <div class="grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,24rem),1fr))]">${escenas}</div>
      <div class="mt-6 rounded-2xl border border-dashed border-purple-500/40 p-5 text-purple-200">
        <p class="flex items-center gap-2 font-semibold"><i data-lucide="video" class="w-5 h-5 text-purple-400"></i> Siguiente paso: voz, imágenes y video</p>
        <p class="text-sm mt-1 text-purple-300">Aquí se generarán las voces por personaje, una imagen vertical por escena y el montaje del MP4. Está en construcción.</p>
        <button disabled class="mt-3 flex items-center gap-2 rounded-xl bg-purple-500/40 px-5 py-2.5 text-white/80 cursor-not-allowed">
          <i data-lucide="lock" class="w-4 h-4"></i> Generar video (próximamente)</button>
      </div>`;
    iconos();
  }

  async function crearGuion() {
    if (elegida < 0 || ocupado) return;
    ocupado = true;
    $("btnVideo").disabled = true;
    estado("cargando", "Escribiendo el guion completo (8 escenas, mínimo 2 minutos)... puede tardar hasta un minuto.");
    try {
      const h = historias[elegida];
      const g = await llamar("/api/guion", { tema: temaActual, historia: h });
      g.personajes = h.personajes || [];
      g.estilo_visual = h.estilo_visual || "";
      const guardado = guardarGuion(g);
      estado();
      $("resultados").classList.add("hidden");
      $("barra").classList.add("hidden");
      $("guion").classList.remove("hidden");
      pintarGuion(g, guardado);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      estado("error", "No se pudo generar el guion: " + e.message);
    }
    ocupado = false;
    $("btnVideo").disabled = false;
  }

  function volver() {
    $("guion").classList.add("hidden");
    $("resultados").classList.remove("hidden");
    $("barra").classList.remove("hidden");
    estado();
  }

  // ---------- eventos ----------
  $("btnGenerar").addEventListener("click", generar);
  $("btnVideo").addEventListener("click", crearGuion);
  $("tema").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generar(); }
  });
  $("chips").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    $("tema").value = "Un video de " + b.getAttribute("data-tema").toLowerCase();
    $("tema").focus();
  });
  $("resultados").addEventListener("click", (e) => {
    const b = e.target.closest(".elegir");
    if (b) elegir(parseInt(b.getAttribute("data-i"), 10));
  });
  $("guion").addEventListener("click", (e) => {
    if (e.target.closest("#btnVolver")) volver();
    if (e.target.closest("#btnRegenerar")) crearGuion();
  });

  pintarChips();
  pintarVacio();
  iconos();
})();
