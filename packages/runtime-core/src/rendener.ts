
// runtime-core  根平台无关的运行时  
import { ShapeFlags } from '@vue/shared'
import { ReactiveEffect } from '@vue/reactivity';
import { createAppAPI } from './apiCreateApp'
import { createComponentInstance, setupComponent } from './component';
import { isSameVNodeType, normalizeVNode, Text } from './createVNode';

export function createRenderer(renderOptions) { // runtime-core   renderOptionsDOMAPI -> rootComponent -> rootProps -> container
  const {
    insert: hostInsert,
    remove: hostRemove,
    patchProp: hostPatchProp,
    createElement: hostCreateElement,
    createText: hostCreateText,
    createComment: hostCreateComment,
    setText: hostSetText,
    setElementText: hostSetElementText,
    parentNode: hostParentNode,
    nextSibling: hostNextSibling,
  } = renderOptions;

  // 创建渲染effect
  const setupRenderEffect = (initialVNode, instance, container) => {
    // 核心就是调用render，数据变化 就重新调用render 
    const componentUpdateFn = () => {
      let { proxy } = instance; //  render中的参数
      if (!instance.isMounted) {
        // 组件初始化的流程
        // 真正渲染组件，渲染的其实是subTree
        // 调用render方法 （渲染页面的时候会进行取值操作，那么取值的时候会进行依赖收集，收集对应的effect，稍后属性变化了会重新执行当前方法）
        const subTree = instance.subTree = instance.render.call(proxy, proxy); // 渲染的时候会调用 h 方法
        patch(null, subTree, container);
        // patch渲染完subTree 会生成真实根节点之后挂载到 subTree.el
        initialVNode.el = subTree.el
        instance.isMounted = true;
      } else {
        // 组件更新的流程 。。。
        // diff算法   比较前后的两颗树 
        const prevTree = instance.subTree;
        const nextTree = instance.render.call(proxy, proxy); // 重新渲染
        patch(prevTree, nextTree, container); // 比较两棵树
      }
    }
    const effect = new ReactiveEffect(componentUpdateFn);
    // 默认调用（force）update方法 就会执行componentUpdateFn
    const update = instance.update = effect.run.bind(effect);
    update();
  }
  // 组件的挂载流程
  const mountComponent = (initialVNode, container) => {
    // 根据组件的虚拟节点 创造一个真实节点，渲染到容器中
    // 1.我们要给组件创造一个组件的实例
    const instance = initialVNode.component = createComponentInstance(initialVNode);
    // 2. 需要给组件的实例进行赋值操作
    setupComponent(instance); // 给实例赋予属性
    // 3.调用render方法实现 组件的渲染逻辑。 如果依赖的状态发生变化 组件要重新渲染
    // effect 可以用在组件中，这样数据变化后可以自动重新的执行effect函数
    setupRenderEffect(initialVNode, instance, container); // 渲染effect
  }
  // 组建的生成、更新
  const processComponent = (n1, n2, container) => {
    if (n1 == null) {
      // 组件的初始化
      mountComponent(n2, container);
    } else {
      // 组件的更新
      // updateComponent(n1, n2)
    }
  }

  const mountChildren = (children, container) => {
    // 如果是一个文本 可以直接   el.textContnt = 文本2
    // ['文本1','文本2']   两个文本 需要 创建两个文本节点 塞入到我们的元素中
    for (let i = 0; i < children.length; i++) {
      const child = (children[i] = normalizeVNode(children[i]));
      patch(null, child, container); // 如果是文本需要特殊处理
    }
  }
  const mountElement = (vnode, container, anchor) => {
    // vnode中的children  可能是字符串 或者是数组
    let { type, props, shapeFlag, children } = vnode; // 获取节点的类型 属性 儿子的形状 children
    // 创建根节点
    let el = vnode.el = hostCreateElement(type)
    // 添加子节点
    if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
      hostSetElementText(el, children)
    } else if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {  // 按位与
      mountChildren(children, el);
    }
    // 处理属性
    if (props) {
      for (const key in props) {
        hostPatchProp(el, key, null, props[key]); // 给元素添加属性
      }
    }
    // 挂载到DOM
    hostInsert(el, container, anchor);
  }
  // 属性patch
  const patchProps = (oldProps, newProps, el) => {
    if (oldProps === newProps) return;

    for (let key in newProps) {
      const prev = oldProps[key];
      const next = newProps[key]; // 获取新老属性
      if (prev !== next) {
        hostPatchProp(el, key, prev, next);
      }
    }
    for (const key in oldProps) { // 老的有新的没有  移除老的
      if (!(key in newProps)) {
        hostPatchProp(el, key, oldProps[key], null);
      }
    }
  }
  // 新旧两组子元素patch
  const patchKeyedChildren = (c1, c2, container) => {
    let i = 0
    let e1 = c1.length - 1 // prev ending index
    let e2 = c2.length - 1 // next ending index
    // 1. sync from start
    // (a b) c d
    // (a b) e c d
    while (i <= e1 && i <= e2) {
      const n1 = c1[i]
      const n2 = c2[i]
      if (isSameVNodeType(n1, n2)) {
        patch(n1, n2, container)
      } else {
        break
      }
      i++
    }
    // 2. sync from end
    // a b (c d)
    // a b e (c d)
    while (i <= e1 && i <= e2) {
      const n1 = c1[i]
      const n2 = c2[i]
      if (isSameVNodeType(n1, n2)) {
        patch(n1, n2, container)
      } else {
        break
      }
      c1--
      c2--
    }
    // 3. common sequence + mount
    // (a b) [(c d)]
    // (a b) e ... [(c d)]
    // i = 2, e1 = 1, e2 = 2+
    // (a b)
    // c ... (a b)
    // i = 0, e1 = -1, e2 = 0+
    if (i > e1) {
      if (i <= e2) {
        const nextPos = e2 + 1
        const anchor = nextPos < c2.length ? c2[nextPos].el : null // 判断在哪里新增元素（通过判断是否有参照物）
        while (i <= e2) {
          patch(null, c2[i], container, anchor)
          i++
        }
      }
    } else if (i > e2) {
    // 4. common sequence + unmount
    // (a b) c
    // (a b)
    // i = 2, e1 = 2, e2 = 1
    // a (b c)
    // (b c)
    // i = 0, e1 = 0, e2 = -1
      while (i <= e1) {
        unmount(c1[i])
        i++
      }
    } else {
    // 5. unknown sequence
    // [i ... e1 + 1]: a b [c d e] f g
    // [i ... e2 + 1]: a b [e d c h] f g
    // i = 2, e1 = 4, e2 = 5
      const s1 = i // prev starting index
      const s2 = i // next starting index

      // 5.1 build key:index map for newChildren：{e:2, d:3, c:4, h:5}
      const keyToNewIndexMap = new Map()
      for (let i = s2; i <= e2; i++) {
        keyToNewIndexMap.set(c2[i].key, i)
      }

      // used for determining longest stable subsequence
      const toBePatched = e2 - s2 + 1 // 要对比的数量
      const newIndexToOldIndexMap = new Array(toBePatched).fill(0) // [0,0,0,0]

      // 5.2 loop through old children left to be patched and try to patch
      // matching nodes & remove nodes that are no longer present
      for (let i = s1; i <= e1; i++) {
        const prevChild = c1[i]
        let newIndex = keyToNewIndexMap.get(prevChild.key)
        if (newIndex === undefined) {
          unmount(prevChild) // 移除不需要的旧节点
        } else {
          newIndexToOldIndexMap[newIndex - s2] = i + 1 // [4,3,2,0] 加1是为避免s1为0（0用于判定是否为新增节点）
          patch(prevChild, c2[newIndex], container) // 递归patch相同的节点
        }
      }

      // 5.3 move and mount
      // looping backwards so that we can use last patched node as anchor
      for (i = toBePatched - 1; i >= 0; i--) { 
        const nextIndex = s2 + i
        const nextChild = c2[nextIndex]
        const anchor = nextIndex + 1 < c2.length ? c2[nextIndex + 1].el : null
        if (newIndexToOldIndexMap[i] === 0) { // mount新增节点
          patch(null, nextChild, container, anchor)
        } else { // 利用 最长递增子序列算法 优化移动复用节点的次数（减少DOM操作）
          const increasingNewIndexSequence = getSequence(newIndexToOldIndexMap) // generate longest stable subsequence
          let j = increasingNewIndexSequence.length - 1
          if (i !== increasingNewIndexSequence[j]) {
            hostInsert(nextChild.el, container, anchor)
          } else {
            j--
          }
        }
      }
    }
  }
  const unmountChildren = children => {
    for (let i = 0; i < children.length; i++) {
      unmount(children[i])
    }
  }
  // 子元素对比
  const patchChildren = (n1, n2, container) => {
    const c1 = n1 && n1.children
    const c2 = n2.children
    const prevShapeFlag = n1 ? n1.shapeFlag : 0
    const { shapeFlag } = n2

    // children has 3 possibilities: text, array or no children.
    if (shapeFlag & ShapeFlags.TEXT_CHILDREN) { // n2 是 text
      // text children fast path
      if (prevShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        unmountChildren(c1)
      }
      if (c2 !== c1) {
        hostSetElementText(container, c2)
      }
    } else { // n2 是 array or no children
      if (prevShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        // prev children was array
        if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
          // two arrays, cannot assume anything, do full diff
          patchKeyedChildren(c1, c2, container)
        } else {
          // no new children, just unmount old
          unmountChildren(c1)
        }
      } else {
        // prev children was text OR null
        // new children is array OR null
        if (prevShapeFlag & ShapeFlags.TEXT_CHILDREN) {
          hostSetElementText(container, '')
        }
        // mount new if array
        if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
          mountChildren(c2, container)
        }
      }
    }
  }
  const patchElement = (n1, n2) => {
    let el = n2.el = n1.el; // 是同一节点，复用老元素
    const oldProps = n1.props || {};
    const newProps = n2.props || {};
    patchProps(oldProps, newProps, el); // 复用后比较属性
    // 实现比较儿子  diff算法
    patchChildren(n1, n2, el)
  }
  // 组件的生成、更新 最终是 DOM 的生成和更新
  const processElement = (n1, n2, container, anchor) => {
    if (n1 == null) {
      // 初始化、新增元素
      mountElement(n2, container, anchor);
    } else {
      // diff
      patchElement(n1, n2); // 更新两个元素之间的差异
    }

  }
  const processText = (n1, n2, container) => {
    if (n1 === null) {
      // 文本的初始化 
      let textNode = n2.el = hostCreateText(n2.children);
      hostInsert(textNode, container)
    }
  }
  const unmount = (vnode) => {
    hostRemove(vnode.el); // 删除真实节点即可
  }
  // 比较前后
  const patch = (n1, n2, container, anchor = null) => {
    // 更新时两个元素完全不一样，删除老的元素，创建新的元素
    if (n1 && !isSameVNodeType(n1, n2)) { // n1 有值 再看两个是否是相同节点
      unmount(n1);
      n1 = null;
    }
    if (n1 == n2) return;
    const { shapeFlag, type } = n2; // 初始化：createApp(type)
    switch (type) {
      case Text:
        processText(n1, n2, container);
        break;
      default:
        if (shapeFlag & ShapeFlags.COMPONENT) {
          processComponent(n1, n2, container);
        } else if (shapeFlag & ShapeFlags.ELEMENT) {
          processElement(n1, n2, container, anchor);
        }
    }
  }
  // 初次渲染
  const render = (vnode, container) => { // 将虚拟节点 转化成真实节点渲染到容器中
    patch(null, vnode, container);
  }

  return {
    createApp: createAppAPI(render), // 创建一个api createApp
    render
  }
}

// https://en.wikipedia.org/wiki/Longest_increasing_subsequence
function getSequence(arr: number[]): number[] {
  const p = arr.slice()
  const result = [0]
  let i, j, u, v, c
  const len = arr.length
  for (i = 0; i < len; i++) {
    const arrI = arr[i]
    if (arrI !== 0) {
      j = result[result.length - 1]
      if (arr[j] < arrI) {
        p[i] = j
        result.push(i)
        continue
      }
      u = 0
      v = result.length - 1
      while (u < v) {
        c = (u + v) >> 1
        if (arr[result[c]] < arrI) {
          u = c + 1
        } else {
          v = c
        }
      }
      if (arrI < arr[result[u]]) {
        if (u > 0) {
          p[i] = result[u - 1]
        }
        result[u] = i
      }
    }
  }
  u = result.length
  v = result[u - 1]
  while (u-- > 0) {
    result[u] = v
    v = p[v]
  }
  return result
}