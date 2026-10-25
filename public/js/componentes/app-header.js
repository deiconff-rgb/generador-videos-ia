// HEADER: edita este archivo para cambiar el encabezado en TODAS las páginas.
// Uso en cada página:  <app-header></app-header>
class AppHeader extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
    <header class="sticky top-0 z-40 border-b border-purple-500/30 bg-[#0b0613]/90 backdrop-blur">
      <div class="w-full flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-10 2xl:px-16 py-3">
        <a href="/" class="flex items-center gap-3 min-w-0">
          <span class="p-2.5 rounded-xl bg-purple-500 brillo shrink-0">
            <i data-lucide="clapperboard" class="w-6 h-6 text-white"></i>
          </span>
          <span class="min-w-0">
            <span class="block font-bold text-lg leading-tight truncate">Generador de Videos IA</span>
            <span class="block text-xs sm:text-sm text-purple-300 truncate">Historias, narración y video con IA</span>
          </span>
        </a>
        <span class="hidden sm:flex items-center gap-1.5 rounded-full border border-purple-400/40 bg-purple-500/10 px-3 py-1.5 text-sm text-purple-200 shrink-0">
          <i data-lucide="smartphone" class="w-4 h-4"></i> 9:16 y 16:9 · Reels · Shorts · TikTok · YouTube
        </span>
      </div>
    </header>`;
    if (window.lucide) lucide.createIcons();
  }
}
customElements.define("app-header", AppHeader);
