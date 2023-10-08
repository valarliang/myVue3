var VueRuntimeCore = (function (exports) {
  'use strict';

  function isObject(value) {
      return typeof value === 'object' && value !== null;
  }
  function isFunction(value) {
      return typeof value === 'function';
  }
  function isString(value) {
      return typeof value === 'string';
  }
  const toTypeString = (value) => Object.prototype.toString.call(value);
  const hasChanged = (value, oldValue) => !Object.is(value, oldValue);
  const isPlainObject = (val) => toTypeString(val) === '[object Object]';
  const isMap = (val) => toTypeString(val) === '[object Map]';
  const isSet = (val) => toTypeString(val) === '[object Set]';
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  // effectStack作用（源码中通过 parent 属性实现）：
  // 1.配合 activedEffect 解决 effect 内部嵌套 effect 时收集的依赖属性属于哪个effect的问题
  // 2.记录当前effect实例，避免 fn 内赋值时触发 setter 重复执行 run()导致死循环
  const effectStack = [];
  let activedEffect; // 保存当前执行的effect，以便收集依赖
  class ReactiveEffect {
      constructor(fn, scheduler) {
          this.fn = fn;
          this.scheduler = scheduler;
          this.active = true; // 当前 effect 实例有用（有依赖项）
          this.deps = []; // 记录当前 effect实例依赖的 响应属性 收集的 effect数组，用于取消当前effect的响应式调用
      }
      run() {
          if (!this.active)
              return this.fn; // 虽然当前effect失活了，但调用 run 时依然要执行 fn
          if (!effectStack.includes(this)) { // 避免 fn 内赋值时触发 setter 重复执行 run()导致死循环
              try {
                  effectStack.push(activedEffect = this);
                  return this.fn(); // 主线：触发用到的响应属性的 getter，执行 track()收集当前effect实例
              }
              finally { // 解决 effect 内部嵌套 effect 时收集的依赖属性属于哪个effect的问题
                  effectStack.pop();
                  activedEffect = effectStack[effectStack.length - 1];
              }
          }
      }
      stop() {
          if (this.active) {
              for (const dep of this.deps) {
                  dep.delete(this);
              }
              this.active = false;
          }
      }
  }
  const targetMap = new WeakMap(); // 响应属性收集的依赖集合：{ target1: { key1: [effect, ...], key2... }, target2... }
  function track(target, key) {
      if (!activedEffect)
          return; // 没有 effect（不是响应性的操作）不收集
      let depsMap = targetMap.get(target);
      if (!depsMap) {
          targetMap.set(target, depsMap = new Map());
      }
      let dep = depsMap.get(key);
      if (!dep) {
          depsMap.set(key, dep = new Set()); // 源码中使用 createDep()
      }
      trackEffects(dep);
  }
  function trackEffects(dep) {
      if (!dep.has(activedEffect)) {
          dep.add(activedEffect); // 主线：收集当前 effect实例（dep为Set，也可写在判断外）
          activedEffect.deps.push(dep); // 互相记录
      }
  }
  function trigger(target, key) {
      const depsMap = targetMap.get(target);
      if (!depsMap)
          return; // 没有依赖（没有响应性的操作）
      if (key !== undefined) {
          const dep = depsMap.get(key);
          triggerEffects(dep);
      }
  }
  function triggerEffects(dep) {
      for (const effect of dep) {
          if (effect.scheduler) { // computed & watch主线：若当前effect来源于计算或侦听器，要触发计算属性响应更新，执行计算属性中收集的 effect
              return effect.scheduler();
          }
          else {
              effect.run(); // 主线：触发依赖执行更新
          }
      }
  }
  function effect(fn, options) {
      const _effect = new ReactiveEffect(fn);
      if (options) {
          Object.assign(_effect, options);
      }
      if (!options || !options.lazy) {
          _effect.run();
      }
      // 处理 强制执行effect（runner()）和注销effect（runner.effect.stop()）的情况
      const runner = _effect.run.bind(_effect);
      runner.effect = _effect;
      return runner;
  }

  function createGetter(isReadonly = false, shallow = false) {
      return function get(target, key, receiver) {
          if (key === "__v_isReactive" /* ReactiveFlags.IS_REACTIVE */) {
              return !isReadonly;
          }
          else if (key === "__v_isReadonly" /* ReactiveFlags.IS_READONLY */) {
              return isReadonly;
          }
          else if (key === "__v_isShallow" /* ReactiveFlags.IS_SHALLOW */) {
              return shallow;
          }
          else if ( // 将被代理对象转为原始对象条件
          key === "__v_raw" /* ReactiveFlags.RAW */ &&
              receiver ===
                  (isReadonly
                      ? shallow
                          ? shallowReadonlyMap
                          : readonlyMap
                      : shallow
                          ? shallowReactiveMap
                          : reactiveMap).get(target)) {
              return target;
          }
          const res = Reflect.get(target, key, receiver);
          if (!isReadonly) {
              track(target, key); // 主线：依赖收集
          }
          if (shallow) {
              return res; // shallow 不递归代理嵌套对象
          }
          if (isObject(res)) {
              // 读取嵌套对象时递归收集依赖：Convert returned value into a proxy as well. we do the isObject check
              // here to avoid invalid value warning. Also need to lazy access readonly
              // and reactive here to avoid circular dependency.
              return isReadonly ? readonly(res) : reactive(res);
          }
          return res;
      };
  }
  function createSetter() {
      return function set(target, key, value, receiver) {
          const oldValue = target[key];
          const result = Reflect.set(target, key, value, receiver);
          if (oldValue !== value)
              trigger(target, key); // 主线：依赖触发
          return result;
      };
  }
  const get = createGetter();
  const shallowGet = createGetter(false, true);
  const readonlyGet = createGetter(true);
  const shallowReadonlyGet = createGetter(true, true);
  const set = createSetter();
  const mutableHandlers = { get, set };
  // in shallow mode, objects are set as-is regardless of reactive or not
  Object.assign({}, mutableHandlers, { get: shallowGet });
  const readonlyHandlers = {
      get: readonlyGet,
      set(target, key) {
          return true;
      },
      deleteProperty(target, key) {
          return true;
      }
  };
  Object.assign({}, readonlyHandlers, { get: shallowReadonlyGet });
  const reactiveMap = new WeakMap();
  const shallowReactiveMap = new WeakMap();
  const readonlyMap = new WeakMap();
  const shallowReadonlyMap = new WeakMap();
  function createReactiveObject(target, isReadonly, baseHandlers, proxyMap) {
      if (!isObject(target))
          return target;
      // target is already a Proxy, return it.代理已经被代理过的对象 直接返回（原理：代理对象读取 ReactiveFlags.RAW属性会返回原始对象，为 true）
      // exception: calling readonly() on a reactive object. 要考虑已代理对象转readonly的情况，判断是否已为只读对象，否则会直接返回代理对象
      if (target["__v_raw" /* ReactiveFlags.RAW */] && !(isReadonly && target["__v_isReactive" /* ReactiveFlags.IS_REACTIVE */])) {
          return target;
      }
      const existingProxy = proxyMap.get(target); // 解决重复代理同一对象问题（原理：使用 WeakMap 缓存）
      if (existingProxy)
          return existingProxy;
      const proxy = new Proxy(target, baseHandlers); // 主线
      proxyMap.set(target, proxy); // 缓存
      return proxy;
  }
  function reactive(target) {
      return createReactiveObject(target, false, mutableHandlers, reactiveMap);
  }
  function readonly(target) {
      return createReactiveObject(target, true, readonlyHandlers, readonlyMap);
  }
  // 获取被代理对象的原始对象
  function toRaw(observed) {
      const raw = observed && observed["__v_raw" /* ReactiveFlags.RAW */];
      return raw ? toRaw(raw) : observed;
  }
  const toReactive = value => isObject(value) ? reactive(value) : value;
  function isReactive(value) {
      if (isReadonly(value)) {
          return isReactive(value["__v_raw" /* ReactiveFlags.RAW */]);
      }
      return !!(value && value["__v_isReactive" /* ReactiveFlags.IS_REACTIVE */]);
  }
  function isShallow(value) {
      return !!(value && value["__v_isShallow" /* ReactiveFlags.IS_SHALLOW */]);
  }
  function isReadonly(value) {
      return !!(value && value["__v_isReadonly" /* ReactiveFlags.IS_READONLY */]);
  }

  class ComputedRefImpl {
      constructor(getter, _setter) {
          this._setter = _setter;
          this._dirty = true; // 缓存控制开关，默认没有缓存（未被同步的脏数据）
          this.__v_isRef = true;
          // getter中的响应属性变更时，它的 trigger() 会执行之前收集到的计算属性的getter，但并不会响应式地执行此计算属性的依赖，
          // 所以要加入第二个参数 scheduler函数以手动执行收集的 effect
          this.effect = new ReactiveEffect(getter, () => {
              this._dirty = true;
              triggerEffects(this.dep); // 主线3：计算属性的依赖属性更新后，用到了计算属性的依赖也要执行
          });
      }
      // 类的属性访问器，底层为 defineProperty
      get value() {
          if (activedEffect) { // 主线1：收集计算属性自己的依赖（计算属性如果是在其他 effect中被读取，要收集那些 effect，以便将来响应更新）
              trackEffects(this.dep || (this.dep = new Set()));
          }
          if (this._dirty) {
              this._value = this.effect.run(); // 主线2：执行（用户传入的）getter得到结果，同时因为内部会读取某响应性属性，this.effect 将作为那个响应性属性的依赖被收集起来
              this._dirty = false; // 缓存，避免多次取值时（getter中的响应属性不变的情况下）多次无意义地重新执行getter
          }
          return this._value;
      }
      set value(newValue) {
          this._setter(newValue);
      }
  }
  function computed(getterOrOptions) {
      let getter, setter;
      const onlyGetter = isFunction(getterOrOptions);
      if (onlyGetter) {
          getter = getterOrOptions;
          setter = () => { };
      }
      else {
          getter = getterOrOptions.get;
          setter = getterOrOptions.set;
      }
      return new ComputedRefImpl(getter, setter);
  }

  class RefImp {
      constructor(_rawValue, __v_isShallow) {
          this._rawValue = _rawValue;
          this.__v_isShallow = __v_isShallow;
          this.__v_isRef = true; // 处理 已经添加过响应的值 直接返回（原理：createRef中 value.__v_isRef 返回 true）
          this._value = __v_isShallow ? _rawValue : toReactive(_rawValue); // 如果是对象要转为reactive，对象内部依赖收集是通过reactive实现的，而非“.value”的依赖收集
      }
      get value() {
          if (activedEffect) {
              trackEffects(this.dep || (this.dep = new Set())); // 主线：简单类型的依赖收集（只收集.value的响应）
          }
          return this._value;
      }
      set value(newVal) {
          const useDirectValue = this.__v_isShallow || newVal.__v_isShallow || newVal.__v_isReadonly;
          if (newVal !== this._rawValue) {
              this._rawValue = newVal;
              this._value = useDirectValue ? newVal : toReactive(newVal); // 如果是对象要转为reactive，同上，对象内部响应触发是通过reactive实现的
              triggerEffects(this.dep); // 主线：简单类型的依赖触发（只触发.value的赋值）
          }
      }
  }
  function createRef(value, shallow) {
      if (isRef(value)) {
          return value;
      }
      return new RefImp(value, shallow);
  }
  function ref(value) {
      return createRef(value, false);
  }
  function isRef(r) {
      return !!(r && r.__v_isRef === true);
  }

  function createVNode(type, props, children = null) {
      const shapeFlag = isObject(type)
          ? 6 /* ShapeFlags.COMPONENT */
          : isString(type)
              ? 1 /* ShapeFlags.ELEMENT */
              : 0;
      // 虚拟节点就是 用一个对象来描述信息的
      const vnode = {
          __v_isVNode: true,
          type,
          shapeFlag,
          props,
          children,
          key: props && props.key,
          component: null,
          el: null, // 虚拟节点对应的真实节点
      };
      if (children) {
          // 告诉此节点 是什么样的儿子 
          // 稍后渲染虚拟节点的时候 可以判断儿子是数组 就循环渲染
          vnode.shapeFlag |= isString(children) ? 8 /* ShapeFlags.TEXT_CHILDREN */ : 16 /* ShapeFlags.ARRAY_CHILDREN */;
      }
      // vnode 就可以描述出来 当前他是一个什么样的节点 儿子是什么样的
      return vnode; // createApp(App)
  }
  function isVNode(vnode) {
      return !!vnode.__v_isVNode;
  }
  const Text = Symbol();
  function normalizeVNode(vnode) {
      if (isObject(vnode)) {
          return vnode;
      }
      return createVNode(Text, null, String(vnode));
  }
  function isSameVNodeType(n1, n2) {
      // 比较类型是否一致 比较key是否一致
      return n1.type === n2.type && n1.key === n2.key;
  }

  function createAppAPI(render) {
      return (rootComponent, rootProps) => {
          const app = {
              mount(container) {
                  // 1.创造组件虚拟节点 
                  let vnode = createVNode(rootComponent, rootProps); // h函数
                  // 2.挂载的核心就是根据传入的组件对象 创造一个组件的虚拟节点 ，在将这个虚拟节点渲染到容器中
                  render(vnode, container);
              }
          };
          return app;
      };
  }

  function createComponentInstance(vnode) {
      const type = vnode.type; // 用户自己传入的属性
      const instance = {
          vnode,
          type,
          subTree: null,
          update: null,
          ctx: {},
          props: {},
          attrs: {},
          slots: {},
          setupState: {},
          propsOptions: type.props,
          proxy: null,
          render: null,
          emit: null,
          exposed: {},
          isMounted: false // 是否挂载完成
      };
      instance.ctx = { _: instance }; // 也可以直接赋值instance
      return instance;
  }
  function initProps(instance, rawProps) {
      const props = {};
      const attrs = {};
      const options = Object.keys(instance.propsOptions); // 用户注册过的, 校验类型
      if (rawProps) {
          for (let key in rawProps) {
              const value = rawProps[key];
              if (options.includes(key)) {
                  props[key] = value;
              }
              else {
                  attrs[key] = value;
              }
          }
      }
      instance.props = reactive(props);
      instance.attrs = attrs; // 这个attrs 是非响应式的
  }
  function createSetupContext(instance) {
      return {
          attrs: instance.attrs,
          slots: instance.slots,
          emit: instance.emit,
          expose: (exposed) => instance.exposed = exposed || {}
      };
  }
  const PublicInstanceProxyHandlers = {
      get({ _: instance }, key) {
          const { setupState, props } = instance; // 同名 props 和状态同名   通过proxy 可以直接访问状态和属性
          if (hasOwn(setupState, key)) {
              return setupState[key];
          }
          else if (hasOwn(props, key)) {
              return props[key];
          }
          else ;
      },
      set({ _: instance }, key, value) {
          const { setupState, props } = instance; // 属性不能修改
          if (hasOwn(setupState, key)) {
              setupState[key] = value;
          }
          else if (hasOwn(props, key)) {
              console.warn('Props are readonly');
              return false;
          }
          else ;
          return true;
      }
  };
  function setupStatefulComponent(instance) {
      // 核心就是调用组件的setup方法
      const Component = instance.type;
      const { setup } = Component;
      instance.proxy = new Proxy(instance.ctx, PublicInstanceProxyHandlers); // proxy就是代理的上下文
      if (setup) {
          const setupContext = createSetupContext(instance);
          let setupResult = setup(instance.props, setupContext); /// 获取setup的返回值
          if (isFunction(setupResult)) {
              instance.render = setupResult; // 如果setup返回的是函数那么就是render函数
          }
          else if (isObject(setupResult)) {
              instance.setupState = setupResult;
          }
      }
      if (!instance.render) {
          // 如果setup没有写render，可能写的是template，要做模板编译
          // 或用户自己写了 rander
          instance.render = Component.render;
      }
  }
  function setupComponent(instance) {
      const { props, children } = instance.vnode;
      // 组件的props 做初始化  attrs也要初始化
      initProps(instance, props);
      // 插槽的初始化
      // initSlots(instance,children) ...
      setupStatefulComponent(instance); // 这个方法的目的就是调用setup函数 拿到返回值给 setupState 或 render
  }

  function createRenderer(renderOptions) {
      const { insert: hostInsert, remove: hostRemove, patchProp: hostPatchProp, createElement: hostCreateElement, createText: hostCreateText, createComment: hostCreateComment, setText: hostSetText, setElementText: hostSetElementText, parentNode: hostParentNode, nextSibling: hostNextSibling, } = renderOptions;
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
                  initialVNode.el = subTree.el;
                  instance.isMounted = true;
              }
              else {
                  // 组件更新的流程 。。。
                  // diff算法   比较前后的两颗树 
                  const prevTree = instance.subTree;
                  const nextTree = instance.render.call(proxy, proxy); // 重新渲染
                  patch(prevTree, nextTree, container); // 比较两棵树
              }
          };
          const effect = new ReactiveEffect(componentUpdateFn);
          // 默认调用（force）update方法 就会执行componentUpdateFn
          const update = instance.update = effect.run.bind(effect);
          update();
      };
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
      };
      // 组建的生成、更新
      const processComponent = (n1, n2, container) => {
          if (n1 == null) {
              // 组件的初始化
              mountComponent(n2, container);
          }
      };
      const mountChildren = (children, container) => {
          // 如果是一个文本 可以直接   el.textContnt = 文本2
          // ['文本1','文本2']   两个文本 需要 创建两个文本节点 塞入到我们的元素中
          for (let i = 0; i < children.length; i++) {
              const child = (children[i] = normalizeVNode(children[i]));
              patch(null, child, container); // 如果是文本需要特殊处理
          }
      };
      const mountElement = (vnode, container, anchor) => {
          // vnode中的children  可能是字符串 或者是数组
          let { type, props, shapeFlag, children } = vnode; // 获取节点的类型 属性 儿子的形状 children
          // 创建根节点
          let el = vnode.el = hostCreateElement(type);
          // 添加子节点
          if (shapeFlag & 8 /* ShapeFlags.TEXT_CHILDREN */) {
              hostSetElementText(el, children);
          }
          else if (shapeFlag & 16 /* ShapeFlags.ARRAY_CHILDREN */) { // 按位与
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
      };
      // 属性patch
      const patchProps = (oldProps, newProps, el) => {
          if (oldProps === newProps)
              return;
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
      };
      // 新旧两组子元素patch
      const patchKeyedChildren = (c1, c2, container) => {
          let i = 0;
          let e1 = c1.length - 1; // prev ending index
          let e2 = c2.length - 1; // next ending index
          // 1. sync from start
          // (a b) c d
          // (a b) e c d
          while (i <= e1 && i <= e2) {
              const n1 = c1[i];
              const n2 = c2[i];
              if (isSameVNodeType(n1, n2)) {
                  patch(n1, n2, container);
              }
              else {
                  break;
              }
              i++;
          }
          // 2. sync from end
          // a b (c d)
          // a b e (c d)
          while (i <= e1 && i <= e2) {
              const n1 = c1[i];
              const n2 = c2[i];
              if (isSameVNodeType(n1, n2)) {
                  patch(n1, n2, container);
              }
              else {
                  break;
              }
              c1--;
              c2--;
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
                  const nextPos = e2 + 1;
                  const anchor = nextPos < c2.length ? c2[nextPos].el : null; // 判断在哪里新增元素（通过判断是否有参照物）
                  while (i <= e2) {
                      patch(null, c2[i], container, anchor);
                      i++;
                  }
              }
          }
          else if (i > e2) {
              // 4. common sequence + unmount
              // (a b) c
              // (a b)
              // i = 2, e1 = 2, e2 = 1
              // a (b c)
              // (b c)
              // i = 0, e1 = 0, e2 = -1
              while (i <= e1) {
                  unmount(c1[i]);
                  i++;
              }
          }
          else {
              // 5. unknown sequence
              // [i ... e1 + 1]: a b [c d e] f g
              // [i ... e2 + 1]: a b [e d c h] f g
              // i = 2, e1 = 4, e2 = 5
              const s1 = i; // prev starting index
              const s2 = i; // next starting index
              // 5.1 build key:index map for newChildren：{e:2, d:3, c:4, h:5}
              const keyToNewIndexMap = new Map();
              for (let i = s2; i <= e2; i++) {
                  keyToNewIndexMap.set(c2[i].key, i);
              }
              // used for determining longest stable subsequence
              const toBePatched = e2 - s2 + 1; // 要对比的数量
              const newIndexToOldIndexMap = new Array(toBePatched).fill(0); // [0,0,0,0]
              // 5.2 loop through old children left to be patched and try to patch
              // matching nodes & remove nodes that are no longer present
              for (let i = s1; i <= e1; i++) {
                  const prevChild = c1[i];
                  let newIndex = keyToNewIndexMap.get(prevChild.key);
                  if (newIndex === undefined) {
                      unmount(prevChild); // 移除不需要的旧节点
                  }
                  else {
                      newIndexToOldIndexMap[newIndex - s2] = i + 1; // [4,3,2,0] 加1是为避免s1为0（0用于判定是否为新增节点）
                      patch(prevChild, c2[newIndex], container); // 递归patch相同的节点
                  }
              }
              // 5.3 move and mount
              const increasingNewIndexSequence = getSequence(newIndexToOldIndexMap); // generate longest stable subsequence
              let j = increasingNewIndexSequence.length - 1;
              // looping backwards so that we can use last patched node as anchor
              for (i = toBePatched - 1; i >= 0; i--) {
                  const nextIndex = s2 + i;
                  const nextChild = c2[nextIndex];
                  const anchor = nextIndex + 1 < c2.length ? c2[nextIndex + 1].el : null;
                  if (newIndexToOldIndexMap[i] === 0) { // mount新增节点
                      patch(null, nextChild, container, anchor);
                  }
                  else {
                      // 利用 最长递增子序列算法 优化移动复用节点的次数（减少DOM操作）
                      if (i !== increasingNewIndexSequence[j]) { // 如果是递增序列元素则无需移动
                          hostInsert(nextChild.el, container, anchor);
                      }
                      else {
                          j--;
                      }
                  }
              }
          }
      };
      const unmountChildren = children => {
          for (let i = 0; i < children.length; i++) {
              unmount(children[i]);
          }
      };
      // 子元素对比
      const patchChildren = (n1, n2, container) => {
          const c1 = n1 && n1.children;
          const c2 = n2.children;
          const prevShapeFlag = n1 ? n1.shapeFlag : 0;
          const { shapeFlag } = n2;
          // children has 3 possibilities: text, array or no children.
          if (shapeFlag & 8 /* ShapeFlags.TEXT_CHILDREN */) { // n2 是 text
              // text children fast path
              if (prevShapeFlag & 16 /* ShapeFlags.ARRAY_CHILDREN */) {
                  unmountChildren(c1);
              }
              if (c2 !== c1) {
                  hostSetElementText(container, c2);
              }
          }
          else { // n2 是 array or no children
              if (prevShapeFlag & 16 /* ShapeFlags.ARRAY_CHILDREN */) {
                  // prev children was array
                  if (shapeFlag & 16 /* ShapeFlags.ARRAY_CHILDREN */) {
                      // two arrays, cannot assume anything, do full diff
                      patchKeyedChildren(c1, c2, container);
                  }
                  else {
                      // no new children, just unmount old
                      unmountChildren(c1);
                  }
              }
              else {
                  // prev children was text OR null
                  // new children is array OR null
                  if (prevShapeFlag & 8 /* ShapeFlags.TEXT_CHILDREN */) {
                      hostSetElementText(container, '');
                  }
                  // mount new if array
                  if (shapeFlag & 16 /* ShapeFlags.ARRAY_CHILDREN */) {
                      mountChildren(c2, container);
                  }
              }
          }
      };
      const patchElement = (n1, n2) => {
          let el = n2.el = n1.el; // 是同一节点，复用老元素
          const oldProps = n1.props || {};
          const newProps = n2.props || {};
          patchProps(oldProps, newProps, el); // 复用后比较属性
          // 实现比较儿子  diff算法
          patchChildren(n1, n2, el);
      };
      // 组件的生成、更新 最终是 DOM 的生成和更新
      const processElement = (n1, n2, container, anchor) => {
          if (n1 == null) {
              // 初始化、新增元素
              mountElement(n2, container, anchor);
          }
          else {
              // diff
              patchElement(n1, n2); // 更新两个元素之间的差异
          }
      };
      const processText = (n1, n2, container) => {
          if (n1 === null) {
              // 文本的初始化 
              let textNode = n2.el = hostCreateText(n2.children);
              hostInsert(textNode, container);
          }
      };
      const unmount = (vnode) => {
          hostRemove(vnode.el); // 删除真实节点即可
      };
      // 比较前后
      const patch = (n1, n2, container, anchor = null) => {
          // 更新时两个元素完全不一样，删除老的元素，创建新的元素
          if (n1 && !isSameVNodeType(n1, n2)) { // n1 有值 再看两个是否是相同节点
              unmount(n1);
              n1 = null;
          }
          if (n1 == n2)
              return;
          const { shapeFlag, type } = n2; // 初始化：createApp(type)
          switch (type) {
              case Text:
                  processText(n1, n2, container);
                  break;
              default:
                  if (shapeFlag & 6 /* ShapeFlags.COMPONENT */) {
                      processComponent(n1, n2, container);
                  }
                  else if (shapeFlag & 1 /* ShapeFlags.ELEMENT */) {
                      processElement(n1, n2, container, anchor);
                  }
          }
      };
      // 初次渲染
      const render = (vnode, container) => {
          patch(null, vnode, container);
      };
      return {
          createApp: createAppAPI(render),
          render
      };
  }
  // https://en.wikipedia.org/wiki/Longest_increasing_subsequence
  function getSequence(arr) {
      const p = arr.slice();
      const result = [0];
      let i, j, u, v, c;
      const len = arr.length;
      for (i = 0; i < len; i++) {
          const arrI = arr[i];
          if (arrI !== 0) {
              j = result[result.length - 1];
              if (arr[j] < arrI) {
                  p[i] = j;
                  result.push(i);
                  continue;
              }
              u = 0;
              v = result.length - 1;
              while (u < v) {
                  c = (u + v) >> 1;
                  if (arr[result[c]] < arrI) {
                      u = c + 1;
                  }
                  else {
                      v = c;
                  }
              }
              if (arrI < arr[result[u]]) {
                  if (u > 0) {
                      p[i] = result[u - 1];
                  }
                  result[u] = i;
              }
          }
      }
      u = result.length;
      v = result[u - 1];
      while (u-- > 0) {
          result[u] = v;
          v = p[v];
      }
      return result;
  }

  function h(type, propsOrChildren, children) {
      // 写法1.  h('div',{color:red})
      // 写法2.  h('div',h('span'))
      // 写法3   h('div','hello')
      // 写法4：  h('div',['hello','hello'])
      let l = arguments.length;
      if (l === 2) {
          if (isObject(propsOrChildren) && !Array.isArray(propsOrChildren)) {
              if (isVNode(propsOrChildren)) {
                  return createVNode(type, null, [propsOrChildren]); //  h('div',h('span'))
              }
              return createVNode(type, propsOrChildren); //  h('div',{color:red})
          }
          else {
              return createVNode(type, null, propsOrChildren); // h('div','hello')   h('div',['hello','hello'])
          }
      }
      else {
          if (l > 3) {
              children = Array.prototype.slice.call(arguments, 2);
          }
          else if (l === 3 && isVNode(children)) {
              children = [children];
          }
          return createVNode(type, propsOrChildren, children);
      }
      // h('div',{},'孩子')
      // h('div',{},['孩子','孩子','孩子'])
      // h('div',{},[h('span'),h('span'),h('span')])
  }

  const queue = [];
  let isFlushPending = false;
  function queueJob(job) {
      if (!queue.length || !queue.includes(job)) {
          queue.push(job);
          queueFlush();
      }
  }
  function queueFlush() {
      if (!isFlushPending) {
          isFlushPending = true;
          Promise.resolve().then(flushJobs);
      }
  }
  function flushJobs() {
      isFlushPending = false;
      queue.forEach(job => job());
      queue.length = 0;
  }

  function watch(source, cb, options) {
      return doWatch(source, cb, options);
  }
  function doWatch(source, cb, { immediate = false, deep = false } = {}) {
      let getter;
      if (isRef(source)) {
          getter = () => source.value;
      }
      else if (isReactive(source)) {
          getter = () => source;
          deep = true;
      }
      else if (Array.isArray(source)) {
          getter = () => source.map(s => {
              if (isRef(s)) {
                  return s.value;
              }
              else if (isReactive(s)) {
                  return traverse(s); // 同35行，没有读取动作，需手动触发依赖收集
              }
              else if (isFunction(s)) {
                  return s();
              }
              else {
                  return s;
              }
          });
      }
      else if (isFunction(source)) {
          getter = () => source();
      }
      if (cb && deep) {
          const baseGetter = getter;
          getter = () => traverse(baseGetter()); // source若直接是一个响应式对象，需用 traverse 读取 source（手动触发依赖收集）
      }
      let oldValue;
      const job = () => {
          if (cb) {
              const newValue = effect.run();
              if (deep || hasChanged(newValue, oldValue)) {
                  cb(newValue, oldValue);
                  oldValue = newValue;
              }
          }
      };
      let scheduler = () => queueJob(job); // 用微任务执行
      const effect = new ReactiveEffect(getter, scheduler);
      // initial run
      if (cb) {
          if (immediate) {
              job();
          }
          else {
              oldValue = effect.run();
          }
      }
      else {
          effect.run();
      }
      return () => {
          effect.stop();
      };
  }
  // 遍历查看value，用于触发响应数据的 getter 从而收集依赖
  function traverse(value, seen) {
      if (!isObject(value)) {
          return value;
      }
      seen = seen || new Set();
      if (seen.has(value)) {
          return value;
      }
      seen.add(value);
      if (isRef(value)) {
          traverse(value.value, seen);
      }
      else if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
              traverse(value[i], seen);
          }
      }
      else if (isSet(value) || isMap(value)) {
          value.forEach((v) => {
              traverse(v, seen);
          });
      }
      else if (isPlainObject(value)) {
          for (const key in value) {
              traverse(value[key], seen);
          }
      }
      return value;
  }

  exports.ReactiveEffect = ReactiveEffect;
  exports.computed = computed;
  exports.createRenderer = createRenderer;
  exports.effect = effect;
  exports.h = h;
  exports.isReactive = isReactive;
  exports.isReadonly = isReadonly;
  exports.isRef = isRef;
  exports.isShallow = isShallow;
  exports.reactive = reactive;
  exports.ref = ref;
  exports.toRaw = toRaw;
  exports.watch = watch;

  return exports;

})({});
//# sourceMappingURL=runtime-core.global.js.map
