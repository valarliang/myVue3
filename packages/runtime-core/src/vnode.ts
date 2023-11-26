import {
  isObject,
  isString,
  isFunction,
  ShapeFlags,
  normalizeStyle,
  normalizeClass,
} from "@vue/shared";
// vnode非标签DOM类型
export const Fragment = Symbol.for('v-fgt')
export const Text = Symbol.for('v-txt')
export const Comment = Symbol.for('v-cmt')
export const Static = Symbol.for('v-stc')

export function createVNode(type, props, children = null) { // h('div',{},['hellozf','hellozf'])
  // class & style normalization.
  if (props) {
    let { class: klass, style } = props
    if (klass && !isString(klass)) {
      props.class = normalizeClass(klass)
    }
    if (isObject(style)) {
      props.style = normalizeStyle(style)
    }
  }
  // encode the vnode type information into a bitmap
  const shapeFlag = isString(type)
    ? ShapeFlags.ELEMENT
    : isObject(type)
    ? ShapeFlags.STATEFUL_COMPONENT
    : isFunction(type)
    ? ShapeFlags.FUNCTIONAL_COMPONENT
    : 0
  // 虚拟节点就是 用一个对象来描述信息的
  const vnode = { // 跨平台
    __v_isVNode: true,
    type,
    shapeFlag,
    props,
    children,
    key: props && props.key, // key值
    component: null, // 如果是组件的虚拟节点要保存组件的实例
    el: null, // 虚拟节点对应的真实节点
  }
  // 告诉此节点有什么样的儿子 精确化 shapeFlag
  normalizeChildren(vnode, children)
  // vnode 就可以描述出来 当前他是一个什么样的节点 儿子是什么样的
  return vnode; // createApp(App)
}
export function normalizeChildren(vnode, children) {
  let type = 0
  const { shapeFlag } = vnode
  if (children == null) {
    children = null
  } else if (Array.isArray(children)) {
    type = ShapeFlags.ARRAY_CHILDREN
  } else if (isFunction(children)) {
    children = { default: children, _ctx: {} }
    type = ShapeFlags.SLOTS_CHILDREN
  } else { // 文本children
    children = String(children)
    type = ShapeFlags.TEXT_CHILDREN
  }
  vnode.children = children
  vnode.shapeFlag |= type
}

export function isVNode(vnode){
    return !!vnode.__v_isVNode
}
export function normalizeVNode(vnode){
    if(isObject(vnode)){
      return vnode;
    }
    return createVNode(Text,null,String(vnode));
}

export function isSameVNodeType(n1,n2){
    // 比较类型是否一致 比较key是否一致
    return n1.type === n2.type && n1.key === n2.key;
}
