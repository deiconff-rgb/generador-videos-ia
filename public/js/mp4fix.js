// Repara el archivo que graba el navegador (MediaRecorder).
// Problema: el MP4 sale "fragmentado" y sin duración en la cabecera, por eso YouTube, la galería
// y otras apps lo leen como un video de 3 segundos aunque dentro de la página dure más.
// Solución: se reescribe como un MP4 normal (con índice y duración) sin volver a codificar nada.
(function (raiz) {
  "use strict";

  const TXT = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

  // ---------- lectura de cajas ----------
  function cajas(dv, ini, fin) {
    const out = [];
    let o = ini;
    while (o + 8 <= fin) {
      let tam = dv.getUint32(o);
      const tipo = TXT(dv, o + 4);
      let cab = 8;
      if (tam === 1) { tam = Number(dv.getBigUint64(o + 8)); cab = 16; }
      else if (tam === 0) tam = fin - o;
      if (tam < cab || o + tam > fin) break;
      out.push({ tipo, ini: o, tam, datos: o + cab, fin: o + tam });
      o += tam;
    }
    return out;
  }
  const hijos = (dv, c, tipo) => cajas(dv, c.datos, c.fin).filter((x) => !tipo || x.tipo === tipo);
  const hijo = (dv, c, tipo) => hijos(dv, c, tipo)[0];

  // ---------- escritura de cajas ----------
  function caja(tipo, ...partes) {
    let largo = 8;
    partes.forEach((p) => { largo += p.length; });
    const out = new Uint8Array(largo);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, largo);
    for (let i = 0; i < 4; i++) out[4 + i] = tipo.charCodeAt(i);
    let o = 8;
    partes.forEach((p) => { out.set(p, o); o += p.length; });
    return out;
  }
  function u32(...vals) {
    const a = new Uint8Array(vals.length * 4);
    const d = new DataView(a.buffer);
    vals.forEach((v, i) => d.setUint32(i * 4, v >>> 0));
    return a;
  }
  const copia = (b, c) => b.slice(c.ini, c.fin);

  // ---------- MP4 fragmentado -> MP4 normal ----------
  function aplanarMp4(buf) {
    const b = new Uint8Array(buf);
    const dv = new DataView(buf);
    const top = cajas(dv, 0, b.length);
    const ftyp = top.find((c) => c.tipo === "ftyp");
    const moov = top.find((c) => c.tipo === "moov");
    const moofs = top.filter((c) => c.tipo === "moof");
    if (!ftyp || !moov) throw new Error("No es un MP4 válido");
    if (!moofs.length) return null;                       // ya es un MP4 normal: no hace falta tocarlo

    // pistas del moov
    const pistas = hijos(dv, moov, "trak").map((trak) => {
      const tkhd = hijo(dv, trak, "tkhd");
      const mdia = hijo(dv, trak, "mdia");
      const mdhd = hijo(dv, mdia, "mdhd");
      const hdlr = hijo(dv, mdia, "hdlr");
      const minf = hijo(dv, mdia, "minf");
      const stbl = hijo(dv, minf, "stbl");
      const stsd = hijo(dv, stbl, "stsd");
      const vt = dv.getUint8(tkhd.datos);
      const vm = dv.getUint8(mdhd.datos);
      return {
        id: dv.getUint32(tkhd.datos + (vt === 1 ? 20 : 12)),
        escala: dv.getUint32(mdhd.datos + (vm === 1 ? 20 : 12)),
        tipo: TXT(dv, hdlr.datos + 8),
        trak, tkhd, mdia, mdhd, hdlr, minf, stbl, stsd,
        muestras: [], ultimoDts: 0,
      };
    });
    if (!pistas.length) throw new Error("El video no tiene pistas");

    // valores por defecto de los fragmentos
    const trex = {};
    const mvex = hijo(dv, moov, "mvex");
    if (mvex) {
      hijos(dv, mvex, "trex").forEach((t) => {
        trex[dv.getUint32(t.datos + 4)] = {
          dur: dv.getUint32(t.datos + 12), size: dv.getUint32(t.datos + 16), flags: dv.getUint32(t.datos + 20),
        };
      });
    }

    // muestras de cada fragmento
    moofs.forEach((moof) => {
      let finAnterior = null;
      hijos(dv, moof, "traf").forEach((traf) => {
        const tfhd = hijo(dv, traf, "tfhd");
        const fl = dv.getUint32(tfhd.datos) & 0xffffff;
        const id = dv.getUint32(tfhd.datos + 4);
        let p = tfhd.datos + 8;
        let baseOff = null, dDur, dSize, dFlags;
        if (fl & 0x1) { baseOff = Number(dv.getBigUint64(p)); p += 8; }
        if (fl & 0x2) p += 4;
        if (fl & 0x8) { dDur = dv.getUint32(p); p += 4; }
        if (fl & 0x10) { dSize = dv.getUint32(p); p += 4; }
        if (fl & 0x20) { dFlags = dv.getUint32(p); p += 4; }
        const pista = pistas.find((x) => x.id === id);
        if (!pista) return;
        const tx = trex[id] || {};
        if (dDur == null) dDur = tx.dur || 0;
        if (dSize == null) dSize = tx.size || 0;
        if (dFlags == null) dFlags = tx.flags || 0;

        const tfdt = hijo(dv, traf, "tfdt");
        let dts = pista.ultimoDts;
        if (tfdt) {
          dts = dv.getUint8(tfdt.datos) === 1 ? Number(dv.getBigUint64(tfdt.datos + 4)) : dv.getUint32(tfdt.datos + 4);
        }
        const base = baseOff != null ? baseOff : ((fl & 0x20000) || finAnterior == null ? moof.ini : finAnterior);
        let cursor = base;

        hijos(dv, traf, "trun").forEach((trun) => {
          const ver = dv.getUint8(trun.datos);
          const f = dv.getUint32(trun.datos) & 0xffffff;
          const n = dv.getUint32(trun.datos + 4);
          let q = trun.datos + 8;
          let dataOff = null, primerFlags = null;
          if (f & 0x1) { dataOff = dv.getInt32(q); q += 4; }
          if (f & 0x4) { primerFlags = dv.getUint32(q); q += 4; }
          let pos = dataOff != null ? base + dataOff : cursor;
          for (let i = 0; i < n; i++) {
            let dur = dDur, size = dSize, sf = dFlags, cto = 0;
            if (f & 0x100) { dur = dv.getUint32(q); q += 4; }
            if (f & 0x200) { size = dv.getUint32(q); q += 4; }
            if (f & 0x400) { sf = dv.getUint32(q); q += 4; }
            else if (i === 0 && primerFlags != null) sf = primerFlags;
            if (f & 0x800) { cto = ver === 0 ? dv.getUint32(q) : dv.getInt32(q); q += 4; }
            pista.muestras.push({ off: pos, size, dur, sync: !(sf & 0x10000), cto, dts });
            dts += dur;
            pos += size;
          }
          cursor = pos;
        });
        pista.ultimoDts = dts;
        finAnterior = cursor;
      });
    });

    // duraciones reales a partir de las marcas de tiempo
    pistas.forEach((pi) => {
      const m = pi.muestras;
      for (let i = 0; i < m.length - 1; i++) {
        const d = m[i + 1].dts - m[i].dts;
        if (d > 0) m[i].dur = d;
      }
    });
    const activas = pistas.filter((pi) => pi.muestras.length);
    if (!activas.length) throw new Error("El video no tiene datos");

    // fragmentos de ~1 segundo, intercalados entre pistas
    const trozos = [];
    activas.forEach((pi, idx) => {
      pi.inicio = pi.muestras[0].dts;
      pi.total = pi.muestras.reduce((a, m) => a + m.dur, 0);
      let desde = 0, acum = 0;
      for (let i = 0; i < pi.muestras.length; i++) {
        acum += pi.muestras[i].dur;
        if (acum >= pi.escala || i === pi.muestras.length - 1) {
          trozos.push({ pi, desde, hasta: i + 1, t: (pi.muestras[desde].dts) / pi.escala, orden: idx });
          desde = i + 1; acum = 0;
        }
      }
    });
    trozos.sort((x, y) => x.t - y.t || x.orden - y.orden);

    // datos de las muestras en el nuevo orden
    let tamData = 0;
    trozos.forEach((t) => {
      t.rel = tamData;
      for (let i = t.desde; i < t.hasta; i++) tamData += t.pi.muestras[i].size;
    });
    const datos = new Uint8Array(tamData);
    let o = 0;
    trozos.forEach((t) => {
      for (let i = t.desde; i < t.hasta; i++) {
        const m = t.pi.muestras[i];
        datos.set(b.subarray(m.off, m.off + m.size), o);
        o += m.size;
      }
    });

    const ESC_MOVIE = 1000;
    const aMs = (valor, escala) => Math.round((valor * ESC_MOVIE) / escala);

    function construirMoov(inicioDatos) {
      const traks = activas.map((pi) => {
        const m = pi.muestras;
        const mias = trozos.filter((t) => t.pi === pi);
        // tablas
        const stts = [];
        m.forEach((x) => { const u = stts[stts.length - 1]; if (u && u[1] === x.dur) u[0]++; else stts.push([1, x.dur]); });
        const hayCtts = m.some((x) => x.cto !== 0);
        const cttsNeg = m.some((x) => x.cto < 0);
        const ctts = [];
        if (hayCtts) m.forEach((x) => { const u = ctts[ctts.length - 1]; if (u && u[1] === x.cto) u[0]++; else ctts.push([1, x.cto]); });
        const sincro = [];
        m.forEach((x, i) => { if (x.sync) sincro.push(i + 1); });
        const todasSincro = sincro.length === m.length;
        const stsc = [];
        mias.forEach((t, i) => {
          const n = t.hasta - t.desde;
          const u = stsc[stsc.length - 1];
          if (!u || u[1] !== n) stsc.push([i + 1, n, 1]);
        });

        const tStts = caja("stts", u32(0, stts.length), ...stts.map((e) => u32(e[0], e[1])));
        const tCtts = hayCtts ? caja("ctts", u32(cttsNeg ? 0x01000000 : 0, ctts.length), ...ctts.map((e) => u32(e[0], e[1]))) : null;
        const tStss = !todasSincro && sincro.length ? caja("stss", u32(0, sincro.length), u32(...sincro)) : null;
        const tStsc = caja("stsc", u32(0, stsc.length), ...stsc.map((e) => u32(e[0], e[1], e[2])));
        const tStsz = caja("stsz", u32(0, 0, m.length), u32(...m.map((x) => x.size)));
        const tStco = caja("stco", u32(0, mias.length), u32(...mias.map((t) => inicioDatos + t.rel)));
        const stblNuevo = caja("stbl", copia(b, pi.stsd), tStts, ...(tStss ? [tStss] : []), ...(tCtts ? [tCtts] : []), tStsc, tStsz, tStco);

        // minf: se conserva vmhd/smhd/dinf y se cambia stbl
        const otros = hijos(dv, pi.minf).filter((c) => c.tipo !== "stbl").map((c) => copia(b, c));
        const minfNuevo = caja("minf", ...otros, stblNuevo);

        // mdhd con la duración correcta
        const mdhd = copia(b, pi.mdhd);
        const dm = new DataView(mdhd.buffer);
        const vm = mdhd[8];
        if (vm === 1) dm.setBigUint64(8 + 24, BigInt(pi.total)); else dm.setUint32(8 + 16, pi.total);
        const mdiaNuevo = caja("mdia", mdhd, copia(b, pi.hdlr), minfNuevo);

        // edición: retraso inicial de la pista (para mantener audio y video sincronizados)
        const retrasoMs = aMs(pi.inicio, pi.escala);
        // con cuadros B la imagen se muestra un poco después de decodificarse: se calcula la ventana real
        const dts0 = m[0].dts;
        let minCts = Infinity, finPres = 0;
        m.forEach((x) => {
          const c = x.dts - dts0 + x.cto;
          if (c < minCts) minCts = c;
          if (c + x.dur > finPres) finPres = c + x.dur;
        });
        const mediaTime = Math.max(0, minCts);
        const durMs = aMs(finPres - mediaTime, pi.escala);
        const entradas = [];
        if (retrasoMs > 0) entradas.push([retrasoMs, 0xffffffff, 0x00010000]);
        entradas.push([durMs, mediaTime, 0x00010000]);
        const elst = caja("elst", u32(0, entradas.length), ...entradas.map((e) => u32(e[0], e[1], e[2])));
        const edts = caja("edts", elst);

        // tkhd con la duración correcta (en milisegundos)
        const tkhd = copia(b, pi.tkhd);
        const dt = new DataView(tkhd.buffer);
        const durTotalMs = retrasoMs + durMs;
        if (tkhd[8] === 1) dt.setBigUint64(8 + 28, BigInt(durTotalMs)); else dt.setUint32(8 + 20, durTotalMs);
        pi.durTotalMs = durTotalMs;

        return caja("trak", tkhd, edts, mdiaNuevo);
      });

      // mvhd (se copia y se ajustan escala y duración)
      const mvhdOrig = hijo(dv, moov, "mvhd");
      const mvhd = copia(b, mvhdOrig);
      const dm = new DataView(mvhd.buffer);
      const durPelicula = Math.max(...activas.map((pi) => pi.durTotalMs));
      if (mvhd[8] === 1) { dm.setUint32(8 + 20, ESC_MOVIE); dm.setBigUint64(8 + 24, BigInt(durPelicula)); }
      else { dm.setUint32(8 + 12, ESC_MOVIE); dm.setUint32(8 + 16, durPelicula); }
      return { moov: caja("moov", mvhd, ...traks), duracionMs: durPelicula };
    }

    const ftypBytes = copia(b, ftyp);
    let r = construirMoov(0);                              // 1.ª pasada: para conocer el tamaño
    const inicioDatos = ftypBytes.length + r.moov.length + 8;
    r = construirMoov(inicioDatos);                         // 2.ª pasada: con las posiciones reales
    const cabMdat = new Uint8Array(8);
    new DataView(cabMdat.buffer).setUint32(0, 8 + datos.length);
    cabMdat.set([0x6d, 0x64, 0x61, 0x74], 4);

    const salida = new Uint8Array(ftypBytes.length + r.moov.length + 8 + datos.length);
    salida.set(ftypBytes, 0);
    salida.set(r.moov, ftypBytes.length);
    salida.set(cabMdat, ftypBytes.length + r.moov.length);
    salida.set(datos, inicioDatos);
    return { bytes: salida, duracion: r.duracionMs / 1000 };
  }

  // ---------- WebM: agregar la duración que falta ----------
  function leerVint(b, o, quitarMarca) {
    const primero = b[o];
    let largo = 1;
    while (largo <= 8 && !(primero & (0x80 >> (largo - 1)))) largo++;
    if (largo > 8) return null;
    let v = quitarMarca ? primero & (0xff >> largo) : primero;
    let todosUnos = (primero & (0xff >> largo)) === (0xff >> largo);
    for (let i = 1; i < largo; i++) { v = v * 256 + b[o + i]; if (b[o + i] !== 0xff) todosUnos = false; }
    return { v, largo, desconocido: quitarMarca && todosUnos };
  }
  function escribirVint(valor, largoMin) {
    let largo = Math.max(1, largoMin || 1);
    while (valor >= Math.pow(2, 7 * largo) - 1 && largo < 8) largo++;
    const out = new Uint8Array(largo);
    let v = valor;
    for (let i = largo - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
    out[0] |= 0x80 >> (largo - 1);
    return out;
  }

  function arreglarWebm(buf, segundos) {
    const b = new Uint8Array(buf);
    // EBML header
    let o = 0;
    const id1 = leerVint(b, o, false); const tam1 = leerVint(b, o + id1.largo, true);
    o += id1.largo + tam1.largo + tam1.v;
    // Segment
    const idSeg = leerVint(b, o, false);
    const tamSeg = leerVint(b, o + idSeg.largo, true);
    const iniSeg = o + idSeg.largo + tamSeg.largo;
    // buscar Info dentro del Segment
    let p = iniSeg;
    let seekHead = null;
    while (p < b.length) {
      const id = leerVint(b, p, false); const tam = leerVint(b, p + id.largo, true);
      if (!id || !tam) return null;
      const datosIni = p + id.largo + tam.largo;
      const idNum = Array.from(b.subarray(p, p + id.largo)).reduce((a, x) => a * 256 + x, 0);
      if (idNum === 0x114d9b74) seekHead = { p, idLargo: id.largo, tamLargo: tam.largo, tam: tam.v };
      if (idNum === 0x1549a966) {                        // Info
        const datosFin = datosIni + tam.v;
        // ¿ya tiene Duration? ¿qué escala de tiempo usa?
        let q = datosIni, escala = 1000000, tiene = false;
        while (q < datosFin) {
          const ci = leerVint(b, q, false); const ct = leerVint(b, q + ci.largo, true);
          const cid = Array.from(b.subarray(q, q + ci.largo)).reduce((a, x) => a * 256 + x, 0);
          const cdIni = q + ci.largo + ct.largo;
          if (cid === 0x4489) tiene = true;
          if (cid === 0x2ad7b1) escala = Array.from(b.subarray(cdIni, cdIni + ct.v)).reduce((a, x) => a * 256 + x, 0);
          q = cdIni + ct.v;
        }
        if (tiene) return null;
        const dur = new Uint8Array(11);                  // ID(2) + tamaño(1) + float64(8)
        dur.set([0x44, 0x89, 0x88]);
        new DataView(dur.buffer).setFloat64(3, (segundos * 1e9) / escala);
        const nuevoTam = escribirVint(tam.v + dur.length, tam.largo);
        const partes = [b.subarray(0, p + id.largo), nuevoTam, b.subarray(datosIni, datosFin), dur, b.subarray(datosFin)];
        let largoTotal = 0; partes.forEach((x) => { largoTotal += x.length; });
        const out = new Uint8Array(largoTotal);
        let w = 0; partes.forEach((x) => { out.set(x, w); w += x.length; });
        // El índice SeekHead apuntaba a posiciones que se corrieron: se convierte en un bloque "Void" (el índice es opcional)
        if (seekHead) {
          const nuevoVoid = escribirVint(seekHead.tam + seekHead.idLargo - 1, seekHead.tamLargo);
          if (nuevoVoid.length === seekHead.tamLargo) {
            out[seekHead.p] = 0xec;
            out.set(nuevoVoid, seekHead.p + 1);
          }
        }
        // si el Segment tiene tamaño conocido, se actualiza
        if (!tamSeg.desconocido) {
          const delta = out.length - b.length;
          const segTam = escribirVint(tamSeg.v + delta, tamSeg.largo);
          if (segTam.length === tamSeg.largo) out.set(segTam, o + idSeg.largo);
        }
        return { bytes: out, duracion: segundos };
      }
      if (tam.desconocido) return null;
      p = datosIni + tam.v;
    }
    return null;
  }

  // ---------- comprobación en el navegador ----------
  function medirDuracion(blob) {
    return new Promise((ok) => {
      const v = document.createElement("video");
      const url = URL.createObjectURL(blob);
      let listo = false;
      const fin = (d) => { if (listo) return; listo = true; try { URL.revokeObjectURL(url); } catch (_) {} ok(d); };
      v.preload = "metadata";
      v.muted = true;
      v.onloadedmetadata = () => fin(isFinite(v.duration) ? v.duration : null);
      v.onerror = () => fin(-1);
      setTimeout(() => fin(null), 8000);
      v.src = url;
    });
  }

  // Devuelve { blob, duracion, reparado }. Si algo sale mal, devuelve el archivo original.
  async function reparar(blob, segundosEsperados) {
    const tipoSimple = String(blob.type || "").split(";")[0] || "video/mp4";
    try {
      if (!segundosEsperados) {                         // video guardado antes: se mide la duración tal como está
        const d0 = await medirDuracion(blob);
        if (d0 && d0 > 0) segundosEsperados = d0;
      }
      const buf = await blob.arrayBuffer();
      let r = null;
      const esMp4 = String.fromCharCode(...new Uint8Array(buf, 4, 4)) === "ftyp";
      const b0 = new Uint8Array(buf, 0, 4);
      const esWebm = b0[0] === 0x1a && b0[1] === 0x45 && b0[2] === 0xdf && b0[3] === 0xa3;
      if (esMp4) r = aplanarMp4(buf);
      else if (esWebm && segundosEsperados) r = arreglarWebm(buf, segundosEsperados);
      if (!r) return { blob: new Blob([buf], { type: tipoSimple }), duracion: segundosEsperados, reparado: false };

      const nuevo = new Blob([r.bytes], { type: esMp4 ? "video/mp4" : "video/webm" });
      // se comprueba que el navegador lo lee bien y con la duración esperada
      const d = await medirDuracion(nuevo);
      const coincide = !segundosEsperados || d === null || Math.abs(d - segundosEsperados) < Math.max(3, segundosEsperados * 0.08);
      if (d !== -1 && coincide) {
        return { blob: nuevo, duracion: d || r.duracion, reparado: true };
      }
      return { blob: new Blob([buf], { type: tipoSimple }), duracion: segundosEsperados, reparado: false, motivo: "La reparación no pasó la comprobación" };
    } catch (e) {
      return { blob: new Blob([blob], { type: tipoSimple }), duracion: segundosEsperados, reparado: false, motivo: String((e && e.message) || e) };
    }
  }

  const API = { reparar, aplanarMp4, arreglarWebm };
  raiz.ArreglarVideo = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
