var VueReactivity = (function (exports) {
  'use strict';

  function isObject(value) {
      return typeof value === 'object' && value !== null;
  }
  function isFunction(value) {
      return typeof value === 'function';
  }

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
          console.log('已在effectStack，不执行fn', effectStack.includes(this));
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
          if (effect.scheduler) { // computed主线3：若当前effect来源于计算属性，要触发计算属性响应更新，执行计算属性中收集的 effect
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

  exports.ReactiveEffect = ReactiveEffect;
  exports.computed = computed;
  exports.effect = effect;
  exports.isReactive = isReactive;
  exports.isReadonly = isReadonly;
  exports.isRef = isRef;
  exports.isShallow = isShallow;
  exports.reactive = reactive;
  exports.ref = ref;
  exports.toRaw = toRaw;

  return exports;

})({});
//# sourceMappingURL=reactivity.global.js.map
