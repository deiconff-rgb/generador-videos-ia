// Guarda los videos terminados dentro del navegador (IndexedDB) para verlos luego en "Mis videos".
(function () {
  "use strict";
  const NOMBRE = "vi_db";
  const TABLA = "videos";

  function abrir() {
    return new Promise((ok, mal) => {
      const r = indexedDB.open(NOMBRE, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(TABLA, { keyPath: "id" });
      r.onsuccess = () => ok(r.result);
      r.onerror = () => mal(r.error);
    });
  }

  async function operar(modo, fn) {
    const db = await abrir();
    return new Promise((ok, mal) => {
      const t = db.transaction(TABLA, modo);
      const req = fn(t.objectStore(TABLA));
      t.oncomplete = () => { db.close(); ok(req ? req.result : undefined); };
      t.onerror = () => { db.close(); mal(t.error); };
      t.onabort = () => { db.close(); mal(t.error); };
    });
  }

  window.Almacen = {
    guardarVideo: (id, blob, mime, reparado) => operar("readwrite", (s) => s.put({ id: Number(id), blob, mime, reparado: !!reparado, fecha: Date.now() })),
    obtenerVideo: (id) => operar("readonly", (s) => s.get(Number(id))),
    borrarVideo: (id) => operar("readwrite", (s) => s.delete(Number(id))),
    idsConVideo: () => operar("readonly", (s) => s.getAllKeys()).then((a) => a || []),
  };
})();
