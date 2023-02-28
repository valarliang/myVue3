import { nodeOps } from './nodeOps'
import { patchProp } from "./patchProp";

const reanderOptions = Object.assign(nodeOps, { patchProp })

export * from '@vue/runtime-core'