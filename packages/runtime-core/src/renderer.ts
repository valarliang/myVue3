
// runtime-core  根平台无关的运行时  
import { ShapeFlags, invokeArrayFns } from '@vue/shared'
import { ReactiveEffect } from '@vue/reactivity';
import { createAppAPI } from './apiCreateApp'
import { createComponentInstance, setupComponent } from './component';
import { isSameVNodeType, normalizeVNode, Text, Comment, Fragment } from './vnode';
import { queueJob, queuePostFlushCb } from "./scheduler";

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

  // 新旧两组子元素patch，分5种情况，前4种用于处理最常见的插入、删除列表元素的情况，第五种：从乱序开始的地方处理
  const patchKeyedChildren = (c1, c2, container) => {
    let i = 0
    let e1 = c1.length - 1 // prev ending index
    let e2 = c2.length - 1 // next ending index
    // 1. sync from start 从前到后一一对比，相同则递归patch，不同跳出循环
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
    // 2. sync from end 从后到前一一对比，相同则递归patch，不同跳出循环
    // a b (c d)
    // a b e (c d)
    while (i <= e1 && i <= e2) {
      const n1 = c1[e1]
      const n2 = c2[e2]
      if (isSameVNodeType(n1, n2)) {
        patch(n1, n2, container)
      } else {
        break
      }
      e1--
      e2--
    }
    // 3. common sequence + mount 若c2多元素，批量挂载
    // [(a b)] [(c d)]
    // [(a b)] e ... [(c d)]

    // (a b)
    // (a b) e ...
    // i = 2, e1 = 1, e2 = 2（或 3、4...最后一个不相等的元素)
    // (a b)
    // c ... (a b)
    // i = 0, e1 = -1, e2 = 0（或 1、2...最后一个不相等的元素)
    if (i > e1) {
      if (i <= e2) {
        const nextPos = e2 + 1
        const anchor = c2[nextPos]?.el // 判断是否有anchor（用于node.insertBefore(child, anchor)）
        while (i <= e2) { // 批量 mount
          patch(null, c2[i], container, anchor)
          i++
        }
      }
    }
    // 4. common sequence + unmount 若c2少元素，批量卸载
    // [(a b)] e ... [(c d)]
    // [(a b)] [(c d)]

    // (a b) c ...
    // (a b)
    // i = 2, e1 = 2（或 3、4...最后一个不相等的元素), e2 = 1
    // a ... (b c)
    // (b c)
    // i = 0, e1 = 0（或 1、2...最后一个不相等的元素), e2 = -1
    else if (i > e2) {
      while (i <= e1) {
        unmount(c1[i])
        i++
      }
    }
    // 5. unknown sequence
    // [i ... e1 + 1]: a b [c d e] f g
    // [i ... e2 + 1]: a b [e d c h] f g
    // i = 2, e1 = 4, e2 = 5
    else {
      const s1 = i // prev starting index
      const s2 = i // next starting index

      // 5.1 build key:index map for newChildren：{e:2, d:3, c:4, h:5}
      const keyToNewIndexMap = new Map()
      for (let i = s2; i <= e2; i++) {
        keyToNewIndexMap.set(c2[i].key, i)
      }

      // 5.2 loop through old children left to be patched and try to patch
      // matching nodes & remove nodes that are no longer present

      let moved = false // 用于判断是否需要计算最长递增子序列
      // used to track whether any node has moved
      let maxNewIndexSoFar = 0
      // used for determining longest stable subsequence
      const toBePatched = e2 - s2 + 1 // 要对比的数量
      const newIndexToOldIndexMap = new Array(toBePatched).fill(0) // [0,0,0,0]

      for (let i = s1; i <= e1; i++) {
        const prevChild = c1[i]
        let newIndex = keyToNewIndexMap.get(prevChild.key)
        if (newIndex === undefined) {
          unmount(prevChild) // 移除不需要的旧节点
        } else {
          newIndexToOldIndexMap[newIndex - s2] = i + 1 // [4,3,2,0] 加1是为避免s1为0（0用于表示新增的节点）
          if (newIndex >= maxNewIndexSoFar) {
            maxNewIndexSoFar = newIndex
          } else {
            // 如果没有走过这里，说明c2复用节点的前后顺序并没有变化（只可能新增节点），无需移动元素，也就无需计算最长递增子序列优化移动次数
            // 相应的newIndexToOldIndexMap例子[c i d e h]：[2,0,3,4,0]
            moved = true
          }
          patch(prevChild, c2[newIndex], container) // 递归patch更新相同的节点
        }
      }

      // 5.3 move and mount
      const increasingNewIndexSequence = moved ? getSequence(newIndexToOldIndexMap) : [] // generate longest stable subsequence [2]
      let j = increasingNewIndexSequence.length - 1
      // looping backwards so that we can use last patched node as anchor
      for (i = toBePatched - 1; i >= 0; i--) { 
        const nextIndex = s2 + i
        const nextChild = c2[nextIndex]
        const anchor = c2[nextIndex + 1]?.el
        if (newIndexToOldIndexMap[i] === 0) { // mount新增节点
          patch(null, nextChild, container, anchor)
        } else if (moved) {
          // 利用 最长递增子序列算法最大限度减少移动复用节点的次数（减少DOM操作）
          if (i !== increasingNewIndexSequence[j]) { // 如果下标不在最长递增子序列中则需移动元素
            hostInsert(nextChild.el, container, anchor)
          } else { // 无需移动
            j--
          }
        }
      }
    }
  }

  // 创建渲染effect
  const setupRenderEffect = (initialVNode, instance, container) => {
    // 核心就是调用render，数据变化 就重新调用render 
    const componentUpdateFn = () => {
      let { proxy, bm, m, bu, u } = instance; //  render中的参数
      if (!instance.isMounted) {
        if (bm) invokeArrayFns(bm) // beforeMount hook
        // 组件初始化的流程
        // 真正渲染组件，渲染的其实是subTree
        // 调用render方法 （渲染页面的时候会进行取值操作，触发依赖收集，收集对应的effect，稍后属性变化了会重新执行当前方法）
        const subTree = instance.subTree = instance.render.call(proxy, proxy);
        // patch渲染完subTree 会生成真实根节点之后挂载到 subTree.el（即 vnode.el = hostCreateElement(type)）
        patch(null, subTree, container); // 递归挂载
        initialVNode.el = subTree.el
        // mounted hook
        if (m) queuePostFlushCb(m)
        instance.isMounted = true
      } else {
        // 组件更新的流程 。。。
        // diff算法   比较前后的两颗树 
        if (bu) invokeArrayFns(bu) // beforeUpdate hook
        const nextTree = instance.render.call(proxy, proxy); // 重新渲染
        const prevTree = instance.subTree;
        instance.subTree = nextTree
        patch(prevTree, nextTree, container); // 比较两棵树
        if (u) queuePostFlushCb(u) // updated hook
      }
    }
    const effect = instance.effect = new ReactiveEffect(
      componentUpdateFn,
      // 通过 effect.scheduler 可对 update包裹异步方法，异步响应页面更新，否则componentUpdateFn将被同步触发
      // 当用户对同一状态进行频繁更新（for循环），避免多次执行无意义的 componentUpdateFn
      () => queueJob(update)
    )
    // 默认调用（force）update方法 就会执行componentUpdateFn
    const update = instance.update = effect.run.bind(effect);
    update();
  }
  const unmountChildren = children => {
    for (let i = 0; i < children.length; i++) {
      unmount(children[i])
    }
  }
  // 属性patch
  const patchProps = (el, oldProps, newProps) => {
    if (oldProps !== newProps) {
      for (const key in oldProps) { // 老的有新的没有  移除老的
        if (!(key in newProps)) {
          hostPatchProp(el, key, oldProps[key], null);
        }
      }
      for (let key in newProps) {
        const prev = oldProps[key];
        const next = newProps[key]; // 获取新老属性
        if (prev !== next) {
          hostPatchProp(el, key, prev, next);
        }
      }
    }
  }
  // 子元素对比
  const patchChildren = (n1, n2, container) => {
    const c1 = n1 && n1.children
    const prevShapeFlag = n1 ? n1.shapeFlag : 0
    const c2 = n2.children
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
    } else {
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
    // 比较儿子  diff算法
    patchChildren(n1, n2, el)
    patchProps(el, oldProps, newProps); // 复用后比较属性
  }
  const mountChildren = (children, container) => {
    for (let i = 0; i < children.length; i++) {
      // 源码中已限制 h函数渲染Fragment的children只能为数组：h(Fragment, ['hello'])，否则此处报如下错误:
      // Cannot assign to read only property '0' of string 'hello'(即 'h' = v)
      const child = (children[i] = normalizeVNode(children[i]));
      patch(null, child, container);
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
    } else if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
      mountChildren(children, el); // 递归挂载子节点
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
  const updateComponent = (n1, n2) => {
    const instance = (n2.component = n1.component)
    // instance.update()
  }
  // 组件的挂载流程
  const mountComponent = (initialVNode, container) => {
    // 根据组件的虚拟节点 创造一个真实节点，渲染到容器中
    // 1.创造组件的实例
    const instance = initialVNode.component = createComponentInstance(initialVNode);
    // 2.resolve props and slots for setup context
    setupComponent(instance);
    // 3.调用render方法实现组件的渲染逻辑。如果依赖的状态发生变化，组件要重新渲染
    //（实现：为 render+patch 建立一个effect，当render读取data时，当前effect会作为依赖被收集）
    setupRenderEffect(initialVNode, instance, container); // 渲染effect
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
  // 组件的生成、更新
  const processComponent = (n1, n2, container) => {
    if (n1 == null) {
      // 组件的初始化
      mountComponent(n2, container);
    } else {
      // 组件的更新
      updateComponent(n1, n2)
    }
  }
  const processFragment = (n1, n2, container) => {
    if (n1 === null) {
      mountChildren(n2.children, container)
    } else {
      patchChildren(n1, n2, container)
    }
  }
  const processCommentNode = (n1, n2, container) => {
    if (n1 === null) {
      hostInsert(n2.el = hostCreateComment(n2.children), container)
    } else {
      // 注释无更新
      n2.el = n1.el
    }
  }
  const processText = (n1, n2, container) => {
    if (n1 === null) {
      // 文本的初始化并挂载
      hostInsert(n2.el = hostCreateText(n2.children), container)
    } else {
      const el = (n2.el = n1.el!)
      if (n2.children !== n1.children) {
        hostSetText(el, n2.children as string)
      }
    }
  }
  const unmount = (vnode) => {
    hostRemove(vnode.el); // 删除真实节点即可
  }
  // 比较前后
  const patch = (n1, n2, container, anchor = null) => {
    if (n1 == n2) return;
    // 更新时两个元素完全不一样，删除老的元素，创建新的元素
    if (n1 && !isSameVNodeType(n1, n2)) {
      unmount(n1);
      n1 = null;
    }
    const { shapeFlag, type } = n2; // 初始化：createApp(type)
    switch (type) {
      case Text:
        processText(n1, n2, container);
        break
      case Comment:
        processCommentNode(n1, n2, container)
        break
      case Fragment: // 多个根节点组成的片段
        processFragment(n1, n2, container)
        break
      default:
        if (shapeFlag & ShapeFlags.COMPONENT) {
          processComponent(n1, n2, container);
        } else if (shapeFlag & ShapeFlags.ELEMENT) {
          processElement(n1, n2, container, anchor);
        }
    }
  }
  // render作用：将虚拟节点转化成真实节点渲染到容器中
  const render = (vnode, container) => {
    if (vnode == null) {
      if (container._vnode) { // 有旧节点则卸载
        unmount(container._vnode)
      }
    } else {
      patch(container._vnode || null, vnode, container, null) // 初次渲染n1为null
    }
    container._vnode = vnode
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