import { isFunction } from "@vue/shared";
import { ReactiveEffect, activedEffect, trackEffects, triggerEffects } from "./effect";

class ComputedRefImpl {
  public dep // 引用了当前计算属性的 effect
  private _value // 计算属性的值
  public _dirty = true // 缓存控制开关
  // 计算属性要根据用到的响应属性自动更新，就要内置自己的 effect来让响应属性收集到依赖列表中（作为观察者订阅更新）
  public readonly effect
  public readonly __v_isRef = true

  constructor(getter, private readonly _setter) {
    // getter中的响应属性变更时，trigger()中如果“按部就班”执行 effect（即执行getter）并不会响应式地执行 this.dep中的依赖，
    // 所以要加入第二个参数 scheduler函数以手动执行收集的 effect
    this.effect = new ReactiveEffect(getter, () => {
      this._dirty = true
      triggerEffects(this.dep)
    })
  }
  // 类的属性访问器，底层为 defineProperty
  get value() { // 读取计算属性的value时会执行此函数，收集依赖、更新值 ⬇︎
    if (activedEffect) { // 计算属性如果是在其他 effect中被读取，要收集那些 effect，以便将来响应更新
      trackEffects(this.dep || (this.dep = new Set()))
    }
    if (this._dirty) {
      this._value = this.effect.run() // 触发 getter中的响应属性从而收集this.effect
      this._dirty = false // 缓存，避免多次取值时（getter中的响应属性不变的情况下）多次无意义地重新执行getter
    }
    return this._value
  }
  set value(newValue) {
    this._setter(newValue)
  }
}

export function computed(getterOrOptions) {
  let getter, setter
  const onlyGetter = isFunction(getterOrOptions)
  if (onlyGetter) {
    getter = getterOrOptions
    setter = () => {}
  } else {
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }
  return new ComputedRefImpl(getter, setter)
}