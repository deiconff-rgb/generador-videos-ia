// Publicar: envía el video a YouTube, TikTok o Facebook usando el menú de compartir del celular
// (la app oficial publica con tu cuenta, así el video queda público sin pedir permisos de desarrollador).
(function () {
  "use strict";

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  function etiqueta(texto) {
    return String(texto || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9 ]+/g, " ").trim().split(/\s+/)
      .filter((w) => w.length > 2).slice(0, 3)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  }

  function leyenda(d) {
    const sin = String(d.descripcion || "").trim();
    const corta = sin.length > 180 ? sin.slice(0, 177).replace(/\s+\S*$/, "") + "..." : sin;
    const tags = ["#Shorts", "#Reels", "#TikTok", "#Historias"];
    const t = etiqueta(d.tema);
    if (t) tags.push("#" + t);
    return [d.titulo, corta, tags.join(" ")].filter(Boolean).join("\n\n");
  }

  function montar(cont, datos) {
    if (!cont) return;
    cont.innerHTML = `
      <div class="rounded-xl border border-purple-500/30 bg-[#140a24] p-4 space-y-3">
        <p class="flex items-center gap-2 font-semibold"><i data-lucide="share-2" class="w-5 h-5 text-purple-400"></i> Publicar en tus redes</p>
        <p class="text-sm text-purple-300">Toca “Enviar a mis apps” y elige YouTube, TikTok o Facebook en el menú del celular. La app oficial publica el video con tu cuenta.</p>
        <textarea id="pLeyenda" rows="5" class="w-full rounded-xl bg-[#0b0613] border border-purple-500/40 focus:border-purple-400 outline-none p-3 text-sm text-purple-50">${esc(leyenda(datos))}</textarea>
        <div class="flex flex-wrap gap-2">
          <button id="pEnviar" class="flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-fuchsia-500 px-5 py-2.5 font-semibold text-white brillo">
            <i data-lucide="send" class="w-4 h-4"></i> Enviar a mis apps</button>
          <button id="pCopiar" class="flex items-center gap-2 rounded-xl border border-purple-400/50 px-5 py-2.5 text-purple-100 hover:bg-purple-500/20">
            <i data-lucide="copy" class="w-4 h-4"></i> Copiar texto</button>
        </div>
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <a class="text-purple-300 underline" href="https://studio.youtube.com" target="_blank" rel="noopener">Abrir YouTube Studio</a>
          <a class="text-purple-300 underline" href="https://www.tiktok.com/upload" target="_blank" rel="noopener">Abrir TikTok</a>
          <a class="text-purple-300 underline" href="https://www.facebook.com/reels/create" target="_blank" rel="noopener">Abrir Facebook</a>
        </div>
        <p id="pMensaje" class="text-xs text-purple-300"></p>
      </div>`;
    if (window.lucide) lucide.createIcons();

    const msg = cont.querySelector("#pMensaje");
    const caja = cont.querySelector("#pLeyenda");

    cont.querySelector("#pEnviar").addEventListener("click", async () => {
      try {
        const archivo = new File([datos.blob], datos.nombre || "video.mp4", { type: datos.mime });
        if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
          await navigator.share({ files: [archivo], title: datos.titulo, text: caja.value });
          msg.textContent = "Listo. Si la app no trae el texto, toca “Copiar texto” y pégalo en la descripción.";
        } else {
          msg.textContent = "Este navegador no permite enviar archivos desde aquí. Descarga el video y súbelo con los enlaces de abajo.";
        }
      } catch (e) {
        if (!e || e.name !== "AbortError") msg.textContent = "No se pudo abrir el menú de compartir: " + (e && e.message ? e.message : e);
      }
    });

    cont.querySelector("#pCopiar").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(caja.value);
        msg.textContent = "Texto copiado.";
      } catch (_) {
        caja.select();
        msg.textContent = "Selecciona el texto y cópialo manualmente.";
      }
    });
  }

  window.Publicar = { montar };
})();
