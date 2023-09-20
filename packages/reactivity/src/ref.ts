import { toReactive } from "./reactive";
import { activedEffect, trackEffects, triggerEffects } from "./effect";

class RefImp {
  public dep // 通过.value收集的 effect
  private _value // ref的值
  public readonly __v_isRef = true // 处理 已经添加过响应的值 直接返回（原理：createRef中 value.__v_isRef 返回 true）
  
  constructor(private _rawValue, public readonly __v_isShallow) {
    this._value = __v_isShallow ? _rawValue : toReactive(_rawValue) // 如果是对象要转为reactive，对象内部依赖收集是通过reactive实现的，而非“.value”的依赖收集
  }
  get value() {
    if (activedEffect) {
      trackEffects(this.dep || (this.dep = new Set())) // 主线：简单类型的依赖收集（只收集.value的响应）
    }
    return this._value
  }
  set value(newVal) {
    const useDirectValue = this.__v_isShallow || newVal.__v_isShallow || newVal.__v_isReadonly
    if (newVal !== this._rawValue) {
      this._rawValue = newVal
      this._value = useDirectValue ? newVal : toReactive(newVal) // 如果是对象要转为reactive，同上，对象内部响应触发是通过reactive实现的
      triggerEffects(this.dep) // 主线：简单类型的依赖触发（只触发.value的赋值）
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
