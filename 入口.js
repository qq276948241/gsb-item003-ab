'use strict';

const path = require('path');
const { 打包, 打包错误 } = require('./打包');

const 工作目录 = path.resolve(process.argv[2] || process.cwd());

try {
  const 结果 = 打包(工作目录);
  process.stdout.write('打包成功｜共 ' + 结果.顺序.length + ' 个片段｜顺序：' + 结果.顺序.join('、') + '\n');
  process.stdout.write('总指纹：' + 结果.总指纹 + '\n');
  process.exitCode = 0;
} catch (err) {
  if (err instanceof 打包错误) {
    process.stderr.write('打包失败｜' + err.类别 + '｜' + err.message + '\n');
  } else {
    process.stderr.write('打包失败｜未预期错误｜' + (err && err.stack ? err.stack : String(err)) + '\n');
  }
  process.exitCode = 1;
}
