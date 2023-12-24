import { isObject } from "@vue/shared";
import { isVNode, createVNode } from "./vnode";
// h 函数用于将 组件或html节点 生成 vnode
export function h(type, propsOrChildren, children) {
  // 写法1  h('div',{color:red})
  // 写法2  h('div',h('span'))
  // 写法3  h('div','hello')
  // 写法4  h('div',['hello','hello'])
  let l = arguments.length;
  if (l === 2) {
    if (isObject(propsOrChildren) && !Array.isArray(propsOrChildren)) {
      // single vnode without props: h('div',h('span')) (参数h('span')会先执行返回vnode对象）
      if (isVNode(propsOrChildren)) {
        return createVNode(type, null, [propsOrChildren])
      }
      // props without children: h('div',{color:red})
      return createVNode(type, propsOrChildren);
    } else {
      // omit props: h('div','hello')   h('div',['hello','hello'])
      return createVNode(type, null, propsOrChildren);
    }
  } else {
    if (l > 3) {
      children = Array.prototype.slice.call(arguments, 2);
    } else if (l === 3 && isVNode(children)) {
      children = [children]
    }
    return createVNode(type, propsOrChildren, children);
  }
  // h('div',{},'孩子')
  // h('div',{},['孩子','孩子','孩子'])
  // h('div',{},[h('span'),h('span'),h('span')])
}