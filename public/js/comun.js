// Se carga al final de cada página.
// 1) Dibuja los iconos Lucide.
// 2) Calcula el espacio inferior real (menú + barra "Elegida") para que NUNCA tape el contenido.
(function () {
  "use strict";
  if (window.lucide) lucide.createIcons();

  function ajustar() {
    const main = document.querySelector("main");
    if (!main) return;
    const footer = document.querySelector("app-footer footer");
    const barra = document.getElementById("barra");
    let alto = footer ? footer.getBoundingClientRect().height : 0;
    if (barra && !barra.classList.contains("hidden")) alto += barra.getBoundingClientRect().height;
    main.style.setProperty("padding-bottom", Math.ceil(alto + 24) + "px", "important");
  }

  window.addEventListener("resize", ajustar);
  window.addEventListener("load", ajustar);
  window.addEventListener("orientationchange", ajustar);
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(ajustar);
    const f = document.querySelector("app-footer footer");
    const b = document.getElementById("barra");
    if (f) ro.observe(f);
    if (b) ro.observe(b);
  }
  window.ajustarEspacio = ajustar;
  ajustar();
})();
