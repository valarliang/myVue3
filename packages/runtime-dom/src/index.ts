import { createRenderer } from '@vue/runtime-core';
import { nodeOps } from './nodeOps'
import { patchProp } from "./patchProp";

const renderOptions = Object.assign(nodeOps, { patchProp })

export const createApp = (component, rootProps = null) => {
  // 需要创建一个渲染器
  const { createApp } = createRenderer(renderOptions); // runtime-core中的方法
  let app = createApp(component, rootProps);
  let { mount } = app; // 获取core中mount
  app.mount = function (container) {  // 在重写mount
      container = nodeOps.querySelector(container);
      container.innerHTML = '';
      mount(container); // 处理节点后传入到mount中
  }
  return app;
}

export const createSSRApp = () =>{ 

}

export * from '@vue/runtime-core'