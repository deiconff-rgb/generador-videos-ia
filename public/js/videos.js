// Lógica de "Mis videos": lista los guiones guardados en este dispositivo.
(function () {
  "use strict";

  const lista = document.getElementById("lista");
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  function leer() {
    try { return JSON.parse(localStorage.getItem("vi_guiones") || "[]"); }
    catch (_) { return []; }
  }
  function guardar(a) {
    try { localStorage.setItem("vi_guiones", JSON.stringify(a)); } catch (_) {}
  }
  function tiempo(seg) {
    return Math.floor(seg / 60) + ":" + String(seg % 60).padStart(2, "0");
  }

  function pintar() {
    const datos = leer();
    if (!datos.length) {
      lista.innerHTML = `<div class="col-span-full rounded-2xl border border-dashed border-purple-500/40 p-10 text-center text-purple-300">
        <i data-lucide="clapperboard" class="w-10 h-10 mx-auto mb-3 text-purple-400"></i>
        <p class="text-lg">Todavía no tienes guiones guardados</p>
        <a href="/" class="mt-4 inline-flex items-center gap-2 rounded-xl bg-purple-500 hover:bg-purple-400 px-5 py-2.5 font-semibold text-white brillo">
          <i data-lucide="wand-sparkles" class="w-4 h-4"></i> Crear mi primer video</a></div>`;
    } else {
      lista.innerHTML = datos.map((g) => {
        const fecha = new Date(g.fecha).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
        const escenas = (g.escenas || []).map((e, i) =>
          `<div class="mb-2"><p class="text-xs font-semibold text-purple-300">Escena ${esc(e.numero || i + 1)}</p>` +
          (e.dialogos || []).map((d) =>
            `<p class="text-sm"><span class="font-semibold text-purple-300">${esc(d.personaje)}:</span> ${esc(d.texto)}</p>`).join("") +
          `</div>`).join("");
        return `<article class="flex gap-3 rounded-2xl border border-purple-500/30 bg-purple-950/40 p-4">
          <div class="shrink-0 w-16 aspect-[9/16] rounded-lg bg-gradient-to-b from-purple-500 to-fuchsia-600 flex items-center justify-center brillo">
            <i data-lucide="play" class="w-6 h-6 text-white"></i></div>
          <div class="min-w-0 flex-1">
            <h3 class="font-bold leading-snug">${esc(g.titulo)}</h3>
            <p class="text-sm text-purple-300 truncate">${esc(g.tema)}</p>
            <div class="flex flex-wrap gap-2 mt-2 text-xs">
              <span class="rounded-full bg-purple-500/20 px-2.5 py-1">~${tiempo(g.duracion_estimada || 0)} min</span>
              <span class="rounded-full bg-purple-500/20 px-2.5 py-1">${esc(g.formato || "9:16")}</span>
              <span class="rounded-full bg-purple-500/20 px-2.5 py-1">${esc(fecha)}</span>
            </div>
            <p class="mt-2 text-sm text-purple-200 flex items-center gap-1.5"><i data-lucide="file-text" class="w-4 h-4"></i> Guion listo · falta voz y video</p>
            <details class="mt-2">
              <summary class="cursor-pointer text-sm text-purple-300 select-none">Ver guion</summary>
              <div class="mt-2 rounded-xl bg-[#140a24] p-3 max-h-80 overflow-y-auto">${escenas}</div>
            </details>
            <button data-id="${esc(g.id)}" class="borrar mt-3 flex items-center gap-1.5 text-sm text-red-300 hover:text-red-200">
              <i data-lucide="trash-2" class="w-4 h-4"></i> Eliminar</button>
          </div>
        </article>`;
      }).join("");
    }
    if (window.lucide) lucide.createIcons();
  }

  lista.addEventListener("click", (e) => {
    const b = e.target.closest(".borrar");
    if (!b) return;
    const id = b.getAttribute("data-id");
    guardar(leer().filter((g) => String(g.id) !== id));
    pintar();
  });

  pintar();
})();
