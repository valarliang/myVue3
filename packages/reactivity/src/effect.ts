// effectStack作用（源码中通过 parent 属性实现）：
// 1.配合 activedEffect 解决 effect 内部嵌套 effect 时收集的依赖属性属于哪个effect的问题
// 2.记录当前effect实例，避免 fn 内赋值时触发 setter 重复执行 run()导致死循环
const effectStack = []

export let activedEffect // 保存当前执行的effect，以便收集依赖
export class ReactiveEffect {
  active = true // 当前 effect 实例有用（有依赖项）
  deps = [] // 记录当前 effect实例依赖的 响应属性 收集的 effect数组，用于取消当前effect的响应式调用
  constructor(public fn, public scheduler?) { // ts会将 public 编译为 this.fn = fn
    
  }
  run() {
    if (!this.active) return this.fn // 虽然当前effect失活了，但调用 run 时依然要执行 fn
    if (!effectStack.includes(this)) { // 避免 fn 内赋值时触发 setter 重复执行 run()导致死循环
      try {
        effectStack.push(activedEffect = this)
        return this.fn() // 主线：触发用到的响应属性的 getter，执行 track()收集当前effect实例
      } finally { // 解决 effect 内部嵌套 effect 时收集的依赖属性属于哪个effect的问题
        effectStack.pop()
        activedEffect = effectStack[effectStack.length - 1]
      }
    }
  }
  stop() {
    if (this.active) {
      for (const dep of this.deps) {
        dep.delete(this)
      }
      this.active = false
    }
  }
}

const targetMap = new WeakMap() // 响应属性收集的依赖集合：{ target1: { key1: [effect, ...], key2... }, target2... }
export function track(target, key) {
  if (!activedEffect) return // 没有 effect（不是响应性的操作）不收集
  let depsMap = targetMap.get(target)
  if (!depsMap) {
    targetMap.set(target, depsMap = new Map())
  }
  let dep = depsMap.get(key)
  if (!dep) {
    depsMap.set(key, dep = new Set()) // 源码中使用 createDep()，此处简化
  }
  trackEffects(dep)
}

export function trackEffects(dep) {
  if (!dep.has(activedEffect)) {
    dep.add(activedEffect) // 主线：收集当前 effect实例（dep为Set，也可写在判断外）
    activedEffect.deps.push(dep) // 互相记录，用于实现去除当前响应依赖的功能
  }
}

export function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return // 没有依赖（没有响应性的操作）
  if (key !== undefined) {
    const dep = depsMap.get(key)
    triggerEffects(dep)
  }
}

export function triggerEffects(dep) {
  for (const effect of dep) {
    // computed & watch主线：若当前effect来源于计算或侦听器，需触发侦听器回调执行和计算属性响应更新（执行计算属性中收集的 effect）
    if (effect.scheduler) {
      return effect.scheduler()
    } else {
      effect.run() // 主线：触发依赖执行更新
    }
  }
}

export interface ReactiveEffectOptions { lazy?: boolean, scheduler? }

export function effect(fn, options?: ReactiveEffectOptions) {
  const _effect = new ReactiveEffect(fn)
  if (options) {
    Object.assign(_effect, options)
  }
  if (!options || !options.lazy) {
    _effect.run()
  }
  // 处理 强制执行effect（runner()）和注销effect（runner.effect.stop()）的情况
  const runner = _effect.run.bind(_effect)
  runner.effect = _effect
  return runner
}