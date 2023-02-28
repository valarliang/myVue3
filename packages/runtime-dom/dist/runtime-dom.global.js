var VueRuntimeDOM = (function (exports) {
    'use strict';

    const nodeOps = {
        insert: (child, parent, anchor = null) => {
            parent.insertBefore(child, anchor); // parent.appendChild(child)
        },
        remove: child => {
            const parent = child.parentNode;
            if (parent) {
                parent.removeChild(child);
            }
        },
        createElement: tag => document.createElement(tag),
        createText: text => document.createTextNode(text),
        setElementText: (el, text) => el.textContent = text,
        setText: (node, text) => node.nodeValue = text,
        parentNode: node => node.parentNode,
        nextSibling: node => node.nextSibling,
        querySelector: selector => document.querySelector(selector)
    };
    // runtime-dom 提供 节点操作的api -> 传递给 runtime-core

    // 需要比对属性 diff算法    属性比对前后值
    function patchClass(el, value) {
        if (value == null) {
            el.removeAttribute('class');
        }
        else {
            el.className = value;
        }
    }
    function patchStyle(el, prev, next) {
        const style = el.style; // 操作的是样式
        // 最新的肯定要全部加到元素上
        for (let key in next) {
            style[key] = next[key];
        }
        // 新的没有 但是老的有这个属性, 将老的移除掉
        if (prev) {
            for (let key in prev) {
                if (next[key] == null) {
                    style[key] = null;
                }
            }
        }
    }
    function createInvoker(value) {
        const invoker = (e) => {
            invoker.value(e);
        };
        invoker.value = value; // 存储这个变量, 后续想换绑 可以直接更新value值
        return invoker;
    }
    function patchEvent(el, key, nextValue) {
        // vei  vue event invoker  缓存绑定的事件 
        const invokers = el._vei || (el._vei = {}); // 在元素上绑定一个自定义属性 用来记录绑定的事件
        let exisitingInvoker = invokers[key]; // 先看一下有没有绑定过这个事件
        if (exisitingInvoker && nextValue) { // 换绑逻辑
            exisitingInvoker.value = nextValue;
        }
        else {
            const name = key.slice(2).toLowerCase(); // eventName
            if (nextValue) {
                const invoker = invokers[key] = createInvoker(nextValue); // 返回一个引用
                el.addEventListener(name, invoker); // 正规的时间 onClick =(e)=>{}
            }
            else if (exisitingInvoker) {
                // 如果下一个值没有 需要删除
                el.removeEventListener(name, exisitingInvoker);
                invokers[key] = undefined; // 解绑了
            }
            // else{
            //     // 压根没有绑定过 事件就不需要删除了
            // }
        }
    }
    function patchAttr(el, key, value) {
        if (value == null) {
            el.removeAttribute(key);
        }
        else {
            el.setAttribute(key, value);
        }
    }
    const patchProp = (el, key, prevValue, nextValue) => {
        if (key === 'class') { // 类名 
            patchClass(el, nextValue); // 
        }
        else if (key === 'style') { // 样式
            patchStyle(el, prevValue, nextValue);
        }
        else if (/^on[^a-z]/.test(key)) { // onXxx
            // 如果有事件 addEventListener  如果没事件 应该用removeListener
            patchEvent(el, key, nextValue);
            // 绑定一个 换帮了一个  在换绑一个
        }
        else {
            // 其他属性 setAttribute
            patchAttr(el, key, nextValue);
        }
    };

    function isObject(value) {
        return typeof value === 'object' && value !== null;
    }
    function isFunction(value) {
        return typeof value === 'function';
    }

    // effectStack作用：
    // 1.配合 activedEffect 解决 effect 内部嵌套 effect 时收集的依赖属性属于哪个effect的问题
    // 2.记录当前effect实例，避免 fn 内赋值时触发 setter 重复执行 run()导致死循环
    const effectStack = [];
    let activedEffect;
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
                    return this.fn(); // 触发用到的响应属性的 getter，执行 track()收集当前effect实例
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
            return; // 没有 effect不收集
        let depsMap = targetMap.get(target);
        if (!depsMap) {
            targetMap.set(target, depsMap = new Map());
        }
        let dep = depsMap.get(key);
        if (!dep) {
            depsMap.set(key, dep = new Set());
        }
        trackEffects(dep);
    }
    function trackEffects(dep) {
        if (!dep.has(activedEffect)) {
            dep.add(activedEffect); // 收集当前 effect实例
            activedEffect.deps.push(dep); // 互相记录
        }
    }
    function trigger(target, key) {
        const depsMap = targetMap.get(target);
        if (!depsMap)
            return;
        if (key !== undefined) {
            const dep = depsMap.get(key);
            triggerEffects(dep);
        }
    }
    function triggerEffects(dep) {
        for (const effect of dep) {
            if (effect !== activedEffect) // 赋值可能发生在 effect内，注意不能重复执行
                if (effect.scheduler) { // 为实现计算属性响应更新的功能：以手动执行计算属性中收集的其他 effect
                    return effect.scheduler();
                }
            effect.run();
        }
    }
    function effect(fn) {
        const _effect = new ReactiveEffect(fn);
        _effect.run();
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
                track(target, key); // 依赖收集
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
                trigger(target, key);
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
        // target is already a Proxy, return it.
        // exception: calling readonly() on a reactive object
        // 代理 已经被代理过的对象 直接返回（原理：被代理后 target[ReactiveFlags.RAW] 将返回原始对象，为 true）
        if (target["__v_raw" /* ReactiveFlags.RAW */] && !(isReadonly && target["__v_isReactive" /* ReactiveFlags.IS_REACTIVE */])) {
            return target;
        }
        const existingProxy = proxyMap.get(target); // 解决重复代理同一对象问题（原理：使用 WeakMap 缓存）
        if (existingProxy)
            return existingProxy;
        const proxy = new Proxy(target, baseHandlers);
        proxyMap.set(target, proxy);
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

    class ComputedRefImpl {
        constructor(getter, _setter) {
            this._setter = _setter;
            this._dirty = true; // 缓存控制开关
            this.__v_isRef = true;
            // getter中的响应属性变更时，trigger()中如果“按部就班”执行 effect（即执行getter）并不会响应式地执行 this.dep中的依赖，
            // 所以要加入第二个参数 scheduler函数以手动执行收集的 effect
            this.effect = new ReactiveEffect(getter, () => {
                this._dirty = true;
                triggerEffects(this.dep);
            });
        }
        // 类的属性访问器，底层为 defineProperty
        get value() {
            if (activedEffect) { // 计算属性如果是在其他 effect中被读取，要收集那些 effect，以便将来响应更新
                trackEffects(this.dep || (this.dep = new Set()));
            }
            if (this._dirty) {
                this._value = this.effect.run(); // 触发 getter中的响应属性从而收集this.effect
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
            this._value = __v_isShallow ? _rawValue : toReactive(_rawValue); // 如果是对象要转为reactive
        }
        get value() {
            if (activedEffect) { // 如果是在其他 effect中被读取，要收集那些 effect，以便将来响应更新
                trackEffects(this.dep || (this.dep = new Set()));
            }
            return this._value;
        }
        set value(newVal) {
            const useDirectValue = this.__v_isShallow || newVal.__v_isShallow || newVal.__v_isReadonly;
            if (newVal !== this._rawValue) {
                this._rawValue = newVal;
                this._value = useDirectValue ? newVal : toReactive(newVal);
                triggerEffects(this.dep);
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

    Object.assign(nodeOps, { patchProp });

    exports.computed = computed;
    exports.effect = effect;
    exports.reactive = reactive;
    exports.ref = ref;
    exports.toRaw = toRaw;

    return exports;

})({});
//# sourceMappingURL=runtime-dom.global.js.map
