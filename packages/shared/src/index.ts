export const isArray = Array.isArray
export function isObject(value) {
  return typeof value === 'object' && value !== null
}
export function isFunction(value) {
  return typeof value === 'function'
}
export function isString(value) {
  return typeof value === 'string'
}
export const toTypeString = (value: unknown): string =>
  Object.prototype.toString.call(value)

export const hasChanged = (value: any, oldValue: any): boolean =>
  !Object.is(value, oldValue)

export const isPlainObject = (val: unknown): val is object =>
  toTypeString(val) === '[object Object]'
export const isMap = (val: unknown): val is Map<any, any> =>
  toTypeString(val) === '[object Map]'
export const isSet = (val: unknown): val is Set<any> =>
  toTypeString(val) === '[object Set]'

export const invokeArrayFns = (fns: Function[], arg?: any) => {
  for (let i = 0; i < fns.length; i++) {
    fns[i](arg)
  }
}

// 通过 ShapeFlags[...] & component 校验组件类型
export const enum ShapeFlags {
  ELEMENT = 1, // 元素
  FUNCTIONAL_COMPONENT = 1 << 1, // 函数式组件 2
  STATEFUL_COMPONENT = 1 << 2, // 普通组件（包含响应数据的组件）4
  TEXT_CHILDREN = 1 << 3, // 孩子是文本 8
  ARRAY_CHILDREN = 1 << 4, // 孩子是数组 16
  SLOTS_CHILDREN = 1 << 5, // 组件插槽 32
  TELEPORT = 1 << 6, // teleport组件 64
  SUSPENSE = 1 << 7, // suspense组件 128
  COMPONENT_SHOULD_KEEP_ALIVE = 1 << 8, // 256
  COMPONENT_KEPT_ALIVE = 1 << 9, // 512
  COMPONENT = ShapeFlags.STATEFUL_COMPONENT | ShapeFlags.FUNCTIONAL_COMPONENT 	// 组件 6
}

export const hasOwn = (value,key) => Object.prototype.hasOwnProperty.call(value,key);

export function normalizeStyle(value) {
  if (isArray(value)) {
    const res = {}
    for (let i = 0; i < value.length; i++) {
      const item = value[i]
      const normalized = isString(item)
        ? parseStringStyle(item)
        : normalizeStyle(item)
      if (normalized) {
        for (const key in normalized) {
          res[key] = normalized[key]
        }
      }
    }
    return res
  } else if (isString(value) || isObject(value)) {
    return value
  }
}

const listDelimiterRE = /;(?![^(]*\))/g
const propertyDelimiterRE = /:([^]+)/
const styleCommentRE = /\/\*[^]*?\*\//g
export function parseStringStyle(cssText: string) {
  const ret = {}
  cssText
    .replace(styleCommentRE, '')
    .split(listDelimiterRE)
    .forEach(item => {
      if (item) {
        const tmp = item.split(propertyDelimiterRE)
        tmp.length > 1 && (ret[tmp[0].trim()] = tmp[1].trim())
      }
    })
  return ret
}

export function normalizeClass(value): string {
  let res = ''
  if (isString(value)) {
    res = value
  } else if (isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const normalized = normalizeClass(value[i])
      if (normalized) {
        res += normalized + ' '
      }
    }
  } else if (isObject(value)) {
    for (const name in value) {
      if (value[name]) {
        res += name + ' '
      }
    }
  }
  return res.trim()
}