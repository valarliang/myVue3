import { isObject } from "@vue/shared";
import { track, trigger } from "./effect";

export const enum ReactiveFlags {
  SKIP = '__v_skip',
  IS_REACTIVE = '__v_isReactive',
  IS_READONLY = '__v_isReadonly',
  IS_SHALLOW = '__v_isShallow',
  RAW = '__v_raw'
}

function createGetter(isReadonly = false, shallow = false) {
  return function get(target, key, receiver) {
    if (key === ReactiveFlags.IS_REACTIVE) {
      return !isReadonly
    } else if (key === ReactiveFlags.IS_READONLY) {
      return isReadonly
    } else if (key === ReactiveFlags.IS_SHALLOW) {
      return shallow
    } else if ( // 将被代理对象转为原始对象条件
      key === ReactiveFlags.RAW &&
      receiver ===
        (isReadonly
          ? shallow
            ? shallowReadonlyMap
            : readonlyMap
          : shallow
            ? shallowReactiveMap
            : reactiveMap
        ).get(target)
    ) {
      return target
    }
    const res = Reflect.get(target, key, receiver)

    if (!isReadonly) {
      track(target, key) // 依赖收集
    }
    if (shallow) {
      return res // shallow 不递归代理嵌套对象
    }
    if (isObject(res)) {
      // 读取嵌套对象时递归收集依赖：Convert returned value into a proxy as well. we do the isObject check
      // here to avoid invalid value warning. Also need to lazy access readonly
      // and reactive here to avoid circular dependency.
      return isReadonly ? readonly(res) : reactive(res)
    }
    return res
  }
}

function createSetter() {
  return function set(target, key, value, receiver) {
    const oldValue = target[key]
    const result = Reflect.set(target, key, value, receiver)
    if (oldValue !== value) trigger(target, key)
    return result
  }
}

const get = createGetter()
const shallowGet = createGetter(false, true)
const readonlyGet = createGetter(true)
const shallowReadonlyGet = createGetter(true, true)
const set = createSetter()

export const mutableHandlers = { get, set }
// in shallow mode, objects are set as-is regardless of reactive or not
export const shallowReactiveHandlers = Object.assign( {}, mutableHandlers, { get: shallowGet } )
export const readonlyHandlers = {
  get: readonlyGet,
  set(target, key) {
    return true
  },
  deleteProperty(target, key) {
    return true
  }
}
export const shallowReadonlyHandlers = Object.assign( {}, readonlyHandlers, { get: shallowReadonlyGet } )

const reactiveMap = new WeakMap()
const shallowReactiveMap = new WeakMap()
const readonlyMap = new WeakMap()
const shallowReadonlyMap = new WeakMap()

function createReactiveObject(target, isReadonly, baseHandlers, proxyMap) {
  if (!isObject(target)) return target
  // target is already a Proxy, return it.
  // exception: calling readonly() on a reactive object
  // 代理 已经被代理过的对象 直接返回（原理：被代理后 target[ReactiveFlags.RAW] 将返回原始对象，为 true）
  if (target[ReactiveFlags.RAW] && !(isReadonly && target[ReactiveFlags.IS_REACTIVE])) {
    return target
  }

  const existingProxy = proxyMap.get(target) // 解决重复代理同一对象问题（原理：使用 WeakMap 缓存）
  if (existingProxy) return existingProxy

  const proxy = new Proxy(target, baseHandlers)
  proxyMap.set(target, proxy)
  return proxy
}

export function reactive(target) {
  return createReactiveObject(target, false, mutableHandlers, reactiveMap)
}
export function shallowReactive(target) {
  return createReactiveObject(target, false, shallowReactiveHandlers, shallowReactiveMap)
}
export function readonly(target) {
  return createReactiveObject(target, true, readonlyHandlers, readonlyMap)
}
export function shallowReadonly(target) {
  return createReactiveObject(target, true, shallowReadonlyHandlers, shallowReadonlyMap)
}

// 获取被代理对象的原始对象
export function toRaw(observed) {
  const raw = observed && observed[ReactiveFlags.RAW]
  return raw ? toRaw(raw) : observed
}
export const toReactive = value =>
  isObject(value) ? reactive(value) : value
// 标记对象不可被代理
export function markRaw(value) {
  Object.defineProperty(value, ReactiveFlags.SKIP, {
    configurable: true,
    enumerable: false,
    value
  })
  return value
}
