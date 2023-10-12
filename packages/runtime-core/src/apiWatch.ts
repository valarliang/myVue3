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
    getter = () => source // source若直接是一个响应式对象，getter没有读取动作，后面需借助 traverse实现触发响应属性的依赖收集
    deep = true
  } else if (Array.isArray(source)) {
    getter = () =>
      source.map(s => {
        if (isRef(s)) {
          return s.value
        } else if (isReactive(s)) {
          return traverse(s) // 同上，没有读取动作，需借助 traverse触发依赖收集
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
    getter = () => traverse(baseGetter()) // traverse 遍历读取 source（手动触发依赖收集）
  }

  let oldValue
  const job = () => {
    if (cb) {
      const newValue = effect.run()
      if (deep || hasChanged(newValue, oldValue)) {
        cb(newValue, oldValue) // 注意：effect在上面已执行结束，此时没有 activedEffect，所以 watch 回调内的响应属性不会被追踪
        oldValue = newValue
      }
    }
  }
  let scheduler = () => queueJob(job) // 用微任务执行
  const effect = new ReactiveEffect(getter, scheduler)

  // initial run 主线：执行 effect.run()触发getter，开始收集依赖
  if (cb) {
    if (immediate) {
      job()
    } else {
      oldValue = effect.run()
    }
  } else {
    effect.run()
  }

  return effect.stop
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