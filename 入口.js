#!/usr/bin/env node
'use strict';

// 封包工具:按配方把 片段/ 里的片段正文校验后拼进 产物/。
// 用法: node 入口.js [配方路径]   (默认读取工作目录下的 配方)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const 名字规则 = /^[一-鿿0-9-]+$/;
const 指纹规则 = /^[0-9a-f]{64}$/;

function 失败(类别, 说明) {
  process.stderr.write(`错误[${类别}]: ${说明}\n`);
  process.exit(1);
}

function sha256(缓冲) {
  return crypto.createHash('sha256').update(缓冲).digest('hex');
}

function 主流程() {
  const 工作目录 = process.cwd();
  const 配方路径 = path.resolve(工作目录, process.argv[2] || '配方');

  // 配方本身也必须待在工作目录里面
  const 工作目录真实 = fs.realpathSync(工作目录);
  let 配方真实;
  try {
    配方真实 = fs.realpathSync(配方路径);
  } catch {
    失败('配方缺失', `找不到配方文件: ${配方路径}`);
  }
  if (配方真实 !== 工作目录真实 && !配方真实.startsWith(工作目录真实 + path.sep)) {
    失败('路径越界', `配方文件不在工作目录内: ${配方路径}`);
  }

  const 配方文本 = fs.readFileSync(配方路径, 'utf8');
  const 行们 = 配方文本.split('\n').map((行) => 行.replace(/\r$/, ''));

  // 解析配方
  const 条目表 = new Map(); // 名字 -> { 依赖: [...], 指纹 }
  行们.forEach((行, 下标) => {
    if (行.trim() === '') return;
    const 列 = 行.split('|');
    if (列.length !== 3) {
      失败('配方格式错误', `第 ${下标 + 1} 行不是三段竖线格式: ${行}`);
    }
    const [名字, 依赖段, 指纹] = 列;
    if (!名字规则.test(名字)) {
      失败('名字非法', `第 ${下标 + 1} 行名字只允许汉字、数字和短横线: 「${名字}」`);
    }
    if (!指纹规则.test(指纹)) {
      失败('配方格式错误', `第 ${下标 + 1} 行指纹不是六十四位小写十六进制: 「${指纹}」(片段「${名字}」)`);
    }
    if (条目表.has(名字)) {
      失败('重复名字', `名字「${名字}」在配方里出现了第二次`);
    }
    const 依赖列表 = 依赖段 === '' ? [] : [...new Set(依赖段.split('、'))];
    for (const 依赖名 of 依赖列表) {
      if (!名字规则.test(依赖名)) {
        失败('名字非法', `第 ${下标 + 1} 行依赖名不合法: 「${依赖名}」(片段「${名字}」)`);
      }
    }
    条目表.set(名字, { 依赖: 依赖列表, 指纹 });
  });

  // 依赖关系检查:缺名、自依赖
  for (const [名字, 条目] of 条目表) {
    for (const 依赖名 of 条目.依赖) {
      if (依赖名 === 名字) {
        失败('自我依赖', `片段「${名字}」依赖了它自己`);
      }
      if (!条目表.has(依赖名)) {
        失败('依赖缺失', `片段「${名字}」点名的「${依赖名}」不在配方里`);
      }
    }
  }

  // 拓扑排序,要求先后顺序唯一
  const 入度 = new Map();
  const 被依赖表 = new Map(); // 依赖名 -> [依赖它的名字]
  for (const 名字 of 条目表.keys()) {
    入度.set(名字, 0);
    被依赖表.set(名字, []);
  }
  for (const [名字, 条目] of 条目表) {
    for (const 依赖名 of 条目.依赖) {
      入度.set(名字, 入度.get(名字) + 1);
      被依赖表.get(依赖名).push(名字);
    }
  }
  const 顺序 = [];
  const 就绪 = () => [...入度.keys()].filter((名) => 入度.get(名) === 0 && !顺序.includes(名));
  for (;;) {
    const 候选 = 就绪();
    if (候选.length === 0) {
      if (顺序.length < 条目表.size) {
        const 卡住 = [...入度.keys()].filter((名) => !顺序.includes(名));
        失败('依赖成环', `以下片段互相咬住,排不出先后顺序: ${卡住.join('、')}`);
      }
      break;
    }
    if (候选.length > 1) {
      失败('顺序不唯一', `同一层里「${候选.join('、')}」谁先谁后都说得通,依赖必须只能排出一种顺序`);
    }
    const 当前 = 候选[0];
    顺序.push(当前);
    for (const 后继 of 被依赖表.get(当前)) {
      入度.set(后继, 入度.get(后继) - 1);
    }
  }

  // 片段文件:路径安全 + 指纹核验
  const 片段目录 = path.join(工作目录, '片段');
  let 片段目录状态;
  try {
    片段目录状态 = fs.lstatSync(片段目录);
  } catch {
    失败('片段缺失', `找不到片段目录: ${片段目录}`);
  }
  if (片段目录状态.isSymbolicLink() || !片段目录状态.isDirectory()) {
    失败('路径越界', `片段目录必须是工作目录里的真实目录,不能是软链接: ${片段目录}`);
  }
  const 片段目录真实 = fs.realpathSync(片段目录);
  if (片段目录真实 !== 工作目录真实 && !片段目录真实.startsWith(工作目录真实 + path.sep)) {
    失败('路径越界', `片段目录的真实位置跑出了工作目录: ${片段目录真实}`);
  }

  const 正文表 = new Map(); // 名字 -> Buffer
  for (const 名字 of 顺序) {
    const 片段路径 = path.join(片段目录, 名字);
    const 相对 = path.relative(片段目录, 片段路径);
    if (path.isAbsolute(相对) || 相对.startsWith('..')) {
      失败('路径越界', `片段「${名字}」的路径跳出了片段目录`);
    }
    let 状态;
    try {
      状态 = fs.lstatSync(片段路径);
    } catch {
      失败('片段缺失', `配方点了名但文件不存在: 片段/${名字}`);
    }
    if (状态.isSymbolicLink()) {
      失败('路径越界', `片段「${名字}」是软链接,一律拒绝: 片段/${名字}`);
    }
    if (!状态.isFile()) {
      失败('片段缺失', `片段「${名字}」不是普通文件: 片段/${名字}`);
    }
    const 真实位置 = fs.realpathSync(片段路径);
    if (!真实位置.startsWith(片段目录真实 + path.sep)) {
      失败('路径越界', `片段「${名字}」的真实位置跑出了工作目录: ${真实位置}`);
    }
    const 正文 = fs.readFileSync(片段路径);
    const 实际指纹 = sha256(正文);
    const 声明指纹 = 条目表.get(名字).指纹;
    if (实际指纹 !== 声明指纹) {
      失败('指纹不符', `片段「${名字}」声明指纹 ${声明指纹},实际算出来 ${实际指纹}`);
    }
    正文表.set(名字, 正文);
  }

  // 拼接并落盘
  const 拼接结果 = Buffer.concat(顺序.map((名字) => 正文表.get(名字)));
  const 总指纹 = sha256(拼接结果);
  const 分项指纹 = 顺序.map((名字) => `${名字}|${条目表.get(名字).指纹}`).join('\n') + (顺序.length ? '\n' : '');

  const 产物目录 = path.join(工作目录, '产物');
  if (fs.existsSync(产物目录)) {
    const 产物状态 = fs.lstatSync(产物目录);
    if (产物状态.isSymbolicLink() || !产物状态.isDirectory()) {
      失败('路径越界', `产物路径已存在且不是真实目录,拒绝写入: ${产物目录}`);
    }
  } else {
    fs.mkdirSync(产物目录);
  }
  fs.writeFileSync(path.join(产物目录, '拼接结果'), 拼接结果);
  fs.writeFileSync(path.join(产物目录, '总指纹'), 总指纹 + '\n');
  fs.writeFileSync(path.join(产物目录, '分项指纹'), 分项指纹);

  process.stdout.write(`打包完成: ${顺序.length} 个片段,总指纹 ${总指纹}\n`);
  process.exit(0);
}

主流程();
