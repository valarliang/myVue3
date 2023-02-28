const path = require('path')
const json = require('@rollup/plugin-json')
const commonjs = require('@rollup/plugin-commonjs')
const ts = require('rollup-plugin-typescript2')
const { nodeResolve } = require('@rollup/plugin-node-resolve')

const formats = process.env.FORMAT.split(',')
const sourcemap = process.env.SOURCE_MAP
const pkgsDir = path.resolve(__dirname, 'packages')
const packageDir = path.resolve(pkgsDir, process.env.TARGET) // 要打包的分包目录
const resolve = p => path.resolve(packageDir, p)
const name = path.basename(packageDir)
const pkg = require(resolve('package.json'))
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
  else external = Object.keys(pkg.dependencies)
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