export function isObject(value) {
  return typeof value === 'object' && value !== null
}

export function isFunction(value) {
  return typeof value === 'function'
}

export function isString(value) {
  return typeof value === 'string'
}

// 通过 ShapeFlags[...] & component 校验组件类型
export const enum ShapeFlags {
  ELEMENT = 1, // 元素
  FUNCTIONAL_COMPONENT = 1 << 1, // 函数式组件
  STATEFUL_COMPONENT = 1 << 2, // 普通组件
  TEXT_CHILDREN = 1 << 3, // 孩子是文本
  ARRAY_CHILDREN = 1 << 4, // 孩子是数组
  SLOTS_CHILDREN = 1 << 5, // 组件插槽
  TELEPORT = 1 << 6, // teleport组件
  SUSPENSE = 1 << 7, // suspense组件
  COMPONENT = ShapeFlags.STATEFUL_COMPONENT | ShapeFlags.FUNCTIONAL_COMPONENT 	// 组件
}

export const hasOwn = (value,key) => Object.prototype.hasOwnProperty.call(value,key);