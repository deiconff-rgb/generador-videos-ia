// FOOTER (menú inferior): edita este archivo para cambiar el menú en TODAS las páginas.
// Uso en cada página:  <app-footer></app-footer>
// Para agregar una sección nueva, añade una línea a ITEMS.
const ITEMS = [
  { clave: "crear",  href: "/",       icono: "wand-sparkles", texto: "Crear" },
  { clave: "videos", href: "/videos", icono: "film",          texto: "Mis videos" },
  { clave: "redes",  href: "/redes",  icono: "share-2",       texto: "Redes" },
];

function claveActual() {
  const p = location.pathname.toLowerCase();
  if (p.includes("videos")) return "videos";
  if (p.includes("redes")) return "redes";
  return "crear";
}

class AppFooter extends HTMLElement {
  connectedCallback() {
    const activa = claveActual();
    const enlaces = ITEMS.map((it) => {
      const on = it.clave === activa;
      return `
        <a href="${it.href}" ${on ? 'aria-current="page"' : ""}
           class="flex-1 max-w-xs flex flex-col items-center justify-center gap-1 rounded-xl py-2 transition
                  ${on ? "text-white bg-purple-500/30" : "text-purple-300 hover:text-white hover:bg-purple-500/15"}">
          <i data-lucide="${it.icono}" class="w-6 h-6 ${on ? "text-purple-300" : ""}"></i>
          <span class="text-xs sm:text-sm font-medium">${it.texto}</span>
        </a>`;
    }).join("");

    this.innerHTML = `
    <footer class="fixed bottom-0 inset-x-0 z-40 border-t border-purple-500/30 bg-[#0b0613]/95 backdrop-blur"
            style="padding-bottom: env(safe-area-inset-bottom)">
      <nav class="w-full flex items-center justify-around gap-2 px-3 sm:px-6 lg:px-10 2xl:px-16" style="height: var(--alto-footer)">
        ${enlaces}
      </nav>
    </footer>`;
    if (window.lucide) lucide.createIcons();
  }
}
customElements.define("app-footer", AppFooter);
