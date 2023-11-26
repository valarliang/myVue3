import { isString } from "@vue/shared";

// 需要比对属性 diff算法    属性比对前后值
function patchClass(el, value) {
  if (value == null) {
    el.removeAttribute("class");
  } else {
    el.className = value;
  }
}
function patchStyle(el, prev, next) {
  const style = el.style; // 操作的是样式
  if (next && !isString(next)) {
    // 新的没有 但是老的有这个属性, 将老的移除掉
    if (prev && !isString(prev)) {
      for (const key in prev) {
        if (next[key] == null) {
          style[key] = null;
        }
      }
    }
    for (const key in next) {
      style[key] = next[key];
    }
  } else {
    if (isString(next) && prev !== next) {
      style.cssText = next
    } else if (prev) {
      el.removeAttribute('style')
    }
  }
}
function createInvoker(value) {
  const invoker = (e) => {
    // 每次事件触发调用的都是invoker
    invoker.value(e);
  };
  invoker.value = value; // 存储这个变量, 后续想换绑 可以直接更新value值
  return invoker;
}
function patchEvent(el, key, nextValue) {
  // vei  vue event invoker  缓存绑定的事件，方便快速换绑（同一事件无需重复新建、删除）
  const invokers = el._vei || (el._vei = {}); // 在元素上绑定一个自定义属性 用来记录绑定的事件
  let exisitingInvoker = invokers[key]; // 先看一下有没有绑定过这个事件
  if (exisitingInvoker && nextValue) {
    // 换绑逻辑
    exisitingInvoker.value = nextValue;
  } else {
    const name = key.slice(2).toLowerCase(); // get eventName
    if (nextValue) {
      const invoker = (invokers[key] = createInvoker(nextValue)); // 返回一个引用
      el.addEventListener(name, invoker); // 正规事件 onClick = (e) => {}
    } else if (exisitingInvoker) {
      // 如果下一个值没有 需要删除
      el.removeEventListener(name, exisitingInvoker);
      invokers[key] = undefined; // 解绑了
    }
  }
}
function patchAttr(el, key, value) {
  if (value == null) {
    el.removeAttribute(key);
  } else {
    el.setAttribute(key, value);
  }
}
export const patchProp = (el, key, prevValue, nextValue) => {
  if (key === "class") {
    // 类名
    patchClass(el, nextValue); //
  } else if (key === "style") {
    // 样式
    patchStyle(el, prevValue, nextValue);
  } else if (/^on[^a-z]/.test(key)) {
    // onXxx
    // 如果有事件 addEventListener  如果没事件 应该用removeListener
    patchEvent(el, key, nextValue);
    // 绑定一个 换帮了一个  在换绑一个
  } else if (key in el) {
    // input value要通过 el.value 设置
    el[key] = nextValue
  } else {
    // 其他属性 setAttribute
    patchAttr(el, key, nextValue);
  }
};
