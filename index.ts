import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const deckSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "headline",
    "positioning",
    "story",
    "commercialObjective",
    "audience",
    "proofPoints",
    "brandFit",
    "deliverables",
    "benefits",
    "advantages",
    "cta",
  ],
  properties: {
    headline: { type: "string" },
    positioning: { type: "string" },
    story: { type: "string" },
    commercialObjective: { type: "string" },
    audience: { type: "string" },
    proofPoints: { type: "array", items: { type: "string" }, maxItems: 8 },
    brandFit: { type: "array", items: { type: "string" }, maxItems: 8 },
    deliverables: { type: "array", items: { type: "string" }, maxItems: 10 },
    benefits: {
      type: "array",
      minItems: 4,
      maxItems: 10,
      items: { type: "string" },
    },
    advantages: {
      type: "array",
      minItems: 4,
      maxItems: 10,
      items: { type: "string" },
    },
    cta: { type: "string" },
  },
};

function outputText(response: Record<string, unknown>) {
  if (typeof response.output_text === "string") return response.output_text;
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output as Array<Record<string, unknown>>) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content as Array<Record<string, unknown>>) {
      if (part.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  return "";
}

export default {
  fetch: withSupabase({ auth: "user" }, async (request) => {
    if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

    try {
      const apiKey = Deno.env.get("OPENAI_API_KEY");
      if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
      const payload = await request.json();
      const role = payload?.role === "founder" ? "creador" : "athlete";
      const model = Deno.env.get("OPENAI_MODEL") || "gpt-5.6-sol";
      const prompt = `Eres el estratega comercial de ROIS. Convierte los datos proporcionados en un Sponsor Deck en espanol para un ${role}. Debe ser ejecutivo, verificable, sobrio y util para que una empresa decida si solicita una evaluacion de patrocinio dentro de ROIS. El objetivo es preparar una propuesta de valor capaz de ocupar hasta 10 espacios de patrocinio mensual con el mismo ticket indicado en los datos. No crees niveles, paquetes ni precios alternativos. Genera dos listas distintas: entre 4 y 10 beneficios concretos que recibe el patrocinador y entre 4 y 10 ventajas competitivas que explican por que elegir este perfil. Evita repetir la misma idea entre ambas listas. Usa solamente los activos, entregables, audiencia, calendario, eventos y evidencia realmente proporcionados. No inventes seguidores, resultados, marcas, conversiones, logros ni afirmaciones no respaldadas. No incluyas correos, telefonos, redes sociales, mensajes directos ni instrucciones de contacto externo. ROIS gestiona exclusivamente la presentacion, negociacion, seguimiento y cierre. El campo cta debe indicar exactamente: Solicita una evaluacion de patrocinio mediante ROIS. Nuestro equipo valida el alcance, coordina la presentacion y gestiona la relacion comercial. Diferencia claramente hechos de objetivos. Devuelve solo el objeto solicitado.\n\nDATOS:\n${JSON.stringify(payload)}`;

      const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: prompt,
          reasoning: { effort: "low" },
          text: {
            verbosity: "low",
            format: {
              type: "json_schema",
              name: "rois_sponsor_deck",
              strict: true,
              schema: deckSchema,
            },
          },
        }),
      });

      if (!openAIResponse.ok) throw new Error(await openAIResponse.text());
      const response = await openAIResponse.json();
      const raw = outputText(response);
      if (!raw) throw new Error("OpenAI returned no structured output");
      return Response.json({ deck: JSON.parse(raw) });
    } catch (error) {
      console.error("[ROIS sponsor deck]", error);
      return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
    }
  }),
};
