import { reactive } from "@vue/reactivity";
import { hasOwn, isFunction, isObject } from "@vue/shared";
import { onBeforeMount, onMounted, onBeforeUpdate, onUpdated } from "./apiLifecycle";

let uid = 0;
export function createComponentInstance(vnode) {
  const type = vnode.type; // 用户自己传入的属性（组件或html标签）
  const instance = {
    uid: uid++,
    vnode, // 实例对应的虚拟节点
    type, // 组件对象
    subTree: null, // 组件渲染的内容   will be set synchronously right after creation
    update: null, // will be set synchronously right after creation
    ctx: {}, // 组件上下文
    props: {}, // 组件属性
    attrs: {}, // 除了props中的属性
    slots: {}, // 组件的插槽
    setupState: {}, // setup返回的状态
    propsOptions: type.props, // 属性选项
    proxy: null, // 实例的代理对象
    render: null, // 组件的渲染函数
    emit: null, // 事件触发
    exposed: {}, // 暴露的方法
    isMounted: false, // 是否挂载完成
    bc: null,
    c: null,
    bm: null,
    m: null,
    bu: null,
    u: null,
    um: null,
    bum: null,
    da: null,
    a: null,
  };
  instance.ctx = { _: instance };
  return instance;
}
export function initProps(instance, rawProps) {
  const props = {};
  const attrs = {};
  const options = Object.keys(instance.propsOptions); // 用户已在组件中显示注册的 props
  if (rawProps) {
    for (let key in rawProps) {
      const value = rawProps[key];
      if (options.includes(key)) {
        props[key] = value;
      } else {
        attrs[key] = value; // 没有被用户显式注册的 props 放入 attrs 中
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
    expose: (exposed) => (instance.exposed = exposed || {}),
  };
}
const PublicInstanceProxyHandlers = {
  get({ _: instance }, key) { // target 解构到instance
    const { ctx, setupState, data, props } = instance;
    if (hasOwn(setupState, key)) {
      return setupState[key];
    } else if (hasOwn(data, key)) {
      return data[key]
    } else if (hasOwn(props, key)) {
      return props[key];
    } else if (hasOwn(ctx, key)) {
      return ctx[key];
    } else {
      // ....
    }
  },
  set({ _: instance }, key, value) {
    const { setupState, props } = instance; // 属性不能修改
    if (hasOwn(setupState, key)) {
      setupState[key] = value;
    } else if (hasOwn(props, key)) {
      console.warn("Props are readonly");
      return false;
    } else {
      // ....
    }
    return true;
  },
};

export let currentInstance = null
export function setupStatefulComponent(instance) {
  // 核心就是调用组件的setup方法
  const Component = instance.type;
  const { setup } = Component;
  instance.proxy = new Proxy(instance.ctx, PublicInstanceProxyHandlers); // proxy就是代理的上下文
  if (setup) { // composition API
    const setupContext = createSetupContext(instance);
    currentInstance = instance
    let setupResult = setup(instance.props, setupContext); /// 获取setup的返回值
    if (isFunction(setupResult)) {
      instance.render = setupResult; // 如果setup返回的是函数那么就是render函数
    } else if (isObject(setupResult)) {
      instance.setupState = setupResult;
    }
  }
  finishComponentSetup(instance);
}

export function finishComponentSetup(instance) {
  const Component = instance.type;
  if (!instance.render) {
    // 如果setup没有写render，可能写的是template，要做模板编译
    // 或用户自己写了 rander
    instance.render = Component.render;
  }
  // support for 2.x options
  applyOptions(instance)
}

export function setupComponent(instance) {
  const { props, children } = instance.vnode;
  // 组件的 props 做初始化  attrs也要初始化
  initProps(instance, props);
  // initSlots(instance,children) // 插槽的初始化...
  setupStatefulComponent(instance); // 这个方法的目的就是调用setup函数 拿到返回值给 setupState 或 render
}


export function applyOptions(instance) {
  const options = instance.type // 此处省略mixins、extends、emits等处理
  const publicThis = instance.proxy
  const ctx = instance.ctx

  // call beforeCreate first before accessing other options since
  // the hook may mutate resolved options (#2791)
  if (options.beforeCreate) {
    options.beforeCreate.call(publicThis) // beforeCreate hook
  }
  const {
    // state
    data: dataOptions,
    // computed: computedOptions,
    methods,
    // watch, provide, inject, lifecycle
    created,
    beforeMount,
    mounted,
    beforeUpdate,
    updated,
    // activated, deactivated, beforeDestroy, beforeUnmount, destroyed, unmounted, render, renderTracked, renderTriggered, errorCaptured, serverPrefetch,
    // public API
    // expose, inheritAttrs,
    // assets
    // components, directives, filters
  } = options

  if (methods) {
    for (const key in methods) {
      ctx[key] = methods[key].bind(publicThis)
    }
  }
  if (dataOptions) {
    const data = dataOptions.call(publicThis, publicThis)
    instance.data = reactive(data)
  }
  if (created) created.call(publicThis) // created hook

  function registerLifecycleHook(register, hook) {
    register(hook.bind(publicThis))
  }
  registerLifecycleHook(onBeforeMount, beforeMount)
  registerLifecycleHook(onMounted, mounted)
  registerLifecycleHook(onBeforeUpdate, beforeUpdate)
  registerLifecycleHook(onUpdated, updated)
  // register um、bum、a、da...
}
