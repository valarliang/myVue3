const minimist = require('minimist')
const execa = require('execa')

const args = minimist(process.argv.slice(2))
const target = args._[0]
const format = args.f || 'global'
const sourcemap = args.s || false

execa('rollup', [
  '-wc', // --watch --config 监听config文件变化自动打包
  '--environment',
  [`TARGET:${target}`, `FORMAT:${format}`, sourcemap && 'SOURCE_MAP:true'].filter(Boolean).join(','),
],{
  stdio: 'inherit', // 输出到执行此脚本的终端
})
