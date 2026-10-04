import { z } from "zod";
import type { ModelConfig } from "../shared/types.js";
export class ModelError extends Error {}
export function validateEndpoint(value: string) {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(url.protocol === "https:" || (local && url.protocol === "http:"))
  )
    throw new Error(
      "Use an HTTPS model endpoint, or an HTTP endpoint on localhost.",
    );
  return url.toString().replace(/\/$/, "");
}
export async function complete(
  model: ModelConfig,
  system: string,
  user: string,
  signal: AbortSignal,
): Promise<string> {
  const base = validateEndpoint(model.baseUrl);
  const native = model.kind === "ollama";
  const endpoint = native
    ? base.replace(/\/v1$/, "") + "/api/chat"
    : base + "/chat/completions";
  // Conservative budget estimate; the provider remains responsible for exact tokenization.
  if (
    Buffer.byteLength(system + user, "utf8") / 2 + model.outputTokens >
    model.contextTokens
  )
    throw new ModelError(
      "The goal and source excerpts exceed this model's context budget. Shorten the goal, attach fewer sources or increase the context budget.",
    );
  const timeout = AbortSignal.timeout(300000);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.any([signal, timeout]),
      headers: {
        "content-type": "application/json",
        ...(model.apiKey ? { authorization: "Bearer " + model.apiKey } : {}),
      },
      body: JSON.stringify({
        model: model.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        stream: false,
        ...(native
          ? {
              ...(system.includes("JSON")
                ? {
                    format: system.startsWith("Plan")
                      ? grammarShape(planSchema)
                      : system.startsWith("Write")
                        ? grammarShape(reportSchema)
                        : system.startsWith("Extract")
                          ? grammarShape(memorySchema)
                          : "json",
                  }
                : {}),
              options: {
                temperature: 0.2,
                num_ctx: model.contextTokens,
                num_predict: model.outputTokens,
              },
            }
          : { temperature: 0.2, max_tokens: model.outputTokens }),
      }),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    if (timeout.aborted)
      throw new ModelError(
        "The model did not finish within five minutes. Reduce the output limit or choose a faster model, then retry.",
      );
    throw new ModelError(
      "The model service could not be reached. Check the base URL and make sure the service is running.",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ModelError(
      `The model service returned HTTP ${response.status}. Check the endpoint, model and credentials.`,
    );
  }
  let data: {
    choices?: { message?: { content?: string } }[];
    message?: { content?: string };
  };
  try {
    data = await response.json();
  } catch {
    throw new ModelError(
      "The model service returned an invalid response. Check compatibility with the selected connection type.",
    );
  }
  const content = native
    ? data.message?.content
    : data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim())
    throw new ModelError(
      "The model did not return text. Choose a model that supports chat and structured JSON output.",
    );
  return content;
}
export function parseJson<T>(text: string, schema: z.ZodType<T>): T {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  try {
    return schema.parse(JSON.parse(cleaned));
  } catch {
    throw new ModelError(
      "The model returned an invalid structured result. Retry with a model that can follow JSON instructions.",
    );
  }
}
export const planSchema = z.object({
  steps: z.array(z.string().min(1).max(500)).min(1).max(8),
  requiredSourceIds: z.array(z.string()).max(50),
  requiredUrls: z.array(z.string()).max(10),
});
export const reportSchema = z.object({
  title: z.string().min(1).max(180),
  sections: z
    .array(
      z.object({
        heading: z.string().min(1).max(180),
        paragraphs: z.array(z.string().min(1).max(8000)).min(1).max(12),
        sourceIds: z.array(z.string()).max(50),
      }),
    )
    .min(1)
    .max(10),
  limitations: z.array(z.string().min(1).max(2000)).max(12),
});
export const memorySchema = z.object({
  memories: z
    .array(
      z.object({
        category: z.enum(["preference", "goal", "project"]),
        evidence: z.string().min(5).max(800),
      }),
    )
    .max(8),
});

// Keep Ollama's token grammar small; full size/array limits are enforced on the server after generation.
function grammarShape(schema: z.ZodType) {
  return JSON.parse(
    JSON.stringify(z.toJSONSchema(schema), (key, value) =>
      ["maxLength", "minLength", "maxItems", "minItems", "$schema"].includes(
        key,
      )
        ? undefined
        : value,
    ),
  );
}
