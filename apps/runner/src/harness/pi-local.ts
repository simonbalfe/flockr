import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node"
import { memberClient } from "@flockr/client"
import { agentStateFile, builtInModel } from "../config"
import { createPiHarness } from "./pi-durable"
import { fencedPiBoard } from "./pi/board"
import { fileStore } from "./pi/file-store"
import { endpointModels } from "./pi/model"

export const piDurable = createPiHarness({
  model: () => builtInModel(),
  source: () => {
    const model = builtInModel()
    return endpointModels({ baseUrl: model.baseUrl, key: model.key ?? "", contextWindow: model.contextWindow, maxTokens: model.maxTokens })
  },
  store: fileStore(agentStateFile),
  boardFor: ({ url, member, key }) => fencedPiBoard({ member, clientFor: (channels) => memberClient({ baseUrl: url, member, key, channels }) }),
  workspace: { kind: "folder", env: (cwd) => new NodeExecutionEnv({ cwd }) },
  log: (line) => console.log(line),
})
