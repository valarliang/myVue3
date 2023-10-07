import { isFunction } from "@vue/shared";
import { ReactiveEffect, activedEffect, trackEffects, triggerEffects } from "./effect";

class ComputedRefImpl {
  public dep // 引用了当前计算属性的 effect
  private _value // 计算属性的值
  public _dirty = true // 缓存控制开关，默认没有缓存（未被同步的脏数据）
  public readonly effect // 计算属性要根据用到的响应属性自动更新，就要内置自己的 effect来让响应属性收集到依赖列表中（作为观察者订阅更新）
  public readonly __v_isRef = true

  constructor(getter, private readonly _setter) {
    // getter中的响应属性变更时，它的 trigger() 会执行之前收集到的计算属性的getter，但并不会响应式地执行此计算属性的依赖，
    // 所以要加入第二个参数 scheduler函数以手动执行收集的 effect
    this.effect = new ReactiveEffect(getter, () => {
      this._dirty = true
      triggerEffects(this.dep) // 主线3：计算属性的依赖属性更新后，用到了计算属性的依赖也要执行
    })
  }
  // 类的属性访问器，底层为 defineProperty
  get value() {
    if (activedEffect) { // 主线1：收集计算属性自己的依赖（计算属性如果是在其他 effect中被读取，要收集那些 effect，以便将来响应更新）
      trackEffects(this.dep || (this.dep = new Set()))
    }
    if (this._dirty) {
      this._value = this.effect.run() // 主线2：执行（用户传入的）getter得到结果，同时因为内部会读取某响应性属性，this.effect 将作为那个响应性属性的依赖被收集起来
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