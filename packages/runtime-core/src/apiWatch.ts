import { isRef, isReactive, ReactiveEffect } from "@vue/reactivity";
import { isFunction, isObject, hasChanged, isSet, isMap, isPlainObject } from "@vue/shared";
import { queueJob } from "./scheduler";

export function watch(source, cb, options) {
  return doWatch(source, cb, options)
}

function doWatch(source, cb, { immediate = false, deep = false } = {}) {
  let getter
  if (isRef(source)) {
    getter = () => source.value
  } else if (isReactive(source)) {
    getter = () => source
    deep = true
  } else if (Array.isArray(source)) {
    getter = () =>
      source.map(s => {
        if (isRef(s)) {
          return s.value
        } else if (isFunction(s)) {
          return s()
        } else {
          return s
        }
      })
  } else if (isFunction(source)) {
    getter = () => source()
  }

  if (cb && deep) {
    const baseGetter = getter
    getter = () => traverse(baseGetter()) // 利用 traverse 读取source触发依赖收集
  }

  let oldValue = {}
  const job = () => {
    if (cb) {
      const newValue = effect.run()
      if (deep || hasChanged(newValue, oldValue)) {
        cb(newValue, oldValue)
        oldValue = newValue
      }
    }
  }
  let scheduler = () => queueJob(job) // 用微任务执行
  const effect = new ReactiveEffect(getter, scheduler)

  // initial run
  if (cb) {
    if (immediate) {
      job()
    } else {
      oldValue = effect.run()
    }
  } else {
    effect.run()
  }

  return () => {
    effect.stop()
  }
}

// 遍历查看value，用于触发响应数据的 getter 从而收集依赖
export function traverse(value, seen?: Set<unknown>) {
  if (!isObject(value)) {
    return value
  }
  seen = seen || new Set()
  if (seen.has(value)) {
    return value
  }
  seen.add(value)
  if (isRef(value)) {
    traverse(value.value, seen)
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      traverse(value[i], seen)
    }
  } else if (isSet(value) || isMap(value)) {
    value.forEach((v: any) => {
      traverse(v, seen)
    })
  } else if (isPlainObject(value)) {
    for (const key in value) {
      traverse(value[key], seen)
    }
  }
  return value
}