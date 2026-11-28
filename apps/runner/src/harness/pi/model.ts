import type { FetchFunction, Model, MutableModels, ProviderStreams } from "@earendil-works/pi-ai"
import { createModels, createProvider } from "@earendil-works/pi-ai/models"
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy"
import type { ModelRef } from "@earendil-works/pi-durable"

export interface ModelSource {
  models: MutableModels
  ref: (modelId: string) => ModelRef
}

export interface ModelEndpoint {
  baseUrl: string
  key: string
  contextWindow: number
  maxTokens: number
  fetch?: FetchFunction
}

function streamsThrough(fetch: FetchFunction | undefined): ProviderStreams {
  const api = openAICompletionsApi()
  if (!fetch) return api
  return {
    stream: (model, context, options) => api.stream(model, context, { ...options, fetch }),
    streamSimple: (model, context, options) => api.streamSimple(model, context, { ...options, fetch }),
  }
}

const providerId = "flockr-model"

export function endpointModels(endpoint: ModelEndpoint): ModelSource {
  const models = createModels({ identity: { attribution: null } })
  const known = new Set<string>()

  const model = (id: string): Model<"openai-completions"> => ({
    id,
    name: id,
    api: "openai-completions",
    provider: providerId,
    baseUrl: endpoint.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: endpoint.contextWindow,
    maxTokens: endpoint.maxTokens,
  })

  const install = () =>
    models.setProvider(
      createProvider({
        id: providerId,
        name: "Model endpoint",
        baseUrl: endpoint.baseUrl,
        auth: { apiKey: { name: "Model key", resolve: async () => ({ auth: { apiKey: endpoint.key }, source: "runner config" }) } },
        models: [...known].map(model),
        api: streamsThrough(endpoint.fetch),
      }),
    )

  return {
    models,
    ref(modelId) {
      if (!known.has(modelId)) {
        known.add(modelId)
        install()
      }
      return { provider: providerId, modelId }
    },
  }
}
