const path = require('path')
const json = require('@rollup/plugin-json') // 支持解析引入的json文件
const commonjs = require('@rollup/plugin-commonjs') // 支持解析引入的cjs模块
const ts = require('rollup-plugin-typescript2')
const { nodeResolve } = require('@rollup/plugin-node-resolve') // 定位引入的三方库（路径补全，以打包进结果）

const formats = process.env.FORMAT.split(',')
const sourcemap = process.env.SOURCE_MAP
const packageDir = path.resolve(__dirname,'packages', process.env.TARGET) // 要打包的分包目录
const resolve = p => path.resolve(packageDir, p)
const pkg = require(resolve('package.json'))
const name = path.basename(packageDir)
const packageConfigs = formats || pkg.buildOptions.formats

const outputConfig = {
  'esm-bundler': {
    file: resolve(`dist/${name}.esm-bundler.js`),
    format: 'es'
  },
  'cjs': {
    file: resolve(`dist/${name}.cjs.js`),
    format: 'cjs'
  },
  'global': {
    file: resolve(`dist/${name}.global.js`),
    format: 'iife'
  }
}
console.log(packageConfigs)
function createConfig(format, output) {
  let external = []
  if (format === 'global') output.name = pkg.buildOptions.name
  else external = Object.keys(pkg.dependencies) // 模块化模式不打包依赖包
  return {
    input: resolve('src/index.ts'),
    output: {
      ...output,
      sourcemap,
      exports: 'named',
    },
    external,
    plugins: [
      json(),
      ts(),
      commonjs(),
      nodeResolve()
    ]
  }
}
module.exports = packageConfigs.map(format => createConfig(format, outputConfig[format]))