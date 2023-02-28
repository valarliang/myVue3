import { toReactive } from "./reactive";
import { activedEffect, trackEffects, triggerEffects } from "./effect";

class RefImp {
  public dep // 引用了当前ref的 effect
  private _value // ref的值
  public readonly __v_isRef = true // 处理 已经添加过响应的值 直接返回（原理：createRef中 value.__v_isRef 返回 true）
  
  constructor(private _rawValue, public readonly __v_isShallow) {
    this._value = __v_isShallow ? _rawValue : toReactive(_rawValue) // 如果是对象要转为reactive
  }
  get value() {
    if (activedEffect) { // 如果是在其他 effect中被读取，要收集那些 effect，以便将来响应更新
      trackEffects(this.dep || (this.dep = new Set()))
    }
    return this._value
  }
  set value(newVal) {
    const useDirectValue = this.__v_isShallow || newVal.__v_isShallow || newVal.__v_isReadonly
    if (newVal !== this._rawValue) {
      this._rawValue = newVal
      this._value = useDirectValue ? newVal : toReactive(newVal)
      triggerEffects(this.dep)
    }
  }
}

function createRef(value, shallow) {
  if (isRef(value)) {
    return value
  }
  return new RefImp(value, shallow)
}

export function ref(value) {
  return createRef(value, false)
}

export function shallowRef(value?: unknown) {
  return createRef(value, true)
}

export function unref(ref) {
  return isRef(ref) ? ref.value : ref
}

export function isRef(r) {
  return !!(r && r.__v_isRef === true)
}
