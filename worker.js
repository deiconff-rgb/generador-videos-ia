// Worker: genera 5 historias con diálogos a partir de un tema.
// Uso: GET  /?tema=terror
//      POST /  con JSON {"tema":"anime"}

const MODELO = "@cf/meta/llama-3.1-8b-instruct";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

function extraerJSON(texto) {
  const ini = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (ini === -1 || fin === -1) throw new Error("La IA no devolvió JSON");
  return JSON.parse(texto.slice(ini, fin + 1));
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    let tema = url.searchParams.get("tema");
    if (!tema && request.method === "POST") {
      try {
        tema = (await request.json()).tema;
      } catch (_) {}
    }
    if (!tema) return json({ error: "Falta el tema. Ejemplo: ?tema=terror" }, 400);
    tema = String(tema).slice(0, 200);

    const sistema =
      "Eres guionista de videos cortos. Respondes SOLO con JSON válido, sin texto extra, en español.";
    const pedido = `Crea 5 historias distintas de ${tema}. Cada historia debe ser breve (video de 1 a 2 minutos).
Formato exacto:
{"historias":[{"titulo":"","trama":"","personajes":[{"nombre":"","genero":"hombre|mujer"}],"dialogos":[{"personaje":"","texto":""}]}]}
Cada historia con 2 o 3 personajes y entre 6 y 8 diálogos.`;

    try {
      const r = await env.AI.run(MODELO, {
        messages: [
          { role: "system", content: sistema },
          { role: "user", content: pedido },
        ],
        max_tokens: 3000,
      });
      const bruto = typeof r.response === "string" ? r.response : JSON.stringify(r.response);
      return json(extraerJSON(bruto));
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }
  },
};
