#!/usr/bin/env node
'use strict';

// 自测入口:在临时目录里搭各种夹具,驱动 入口.js 验证行为。
// 用法: node 自测.js   (不联网,结果写入工作目录下的 自测结果)

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const 项目目录 = __dirname;
const 入口路径 = path.join(项目目录, '入口.js');
const 结果路径 = path.join(项目目录, '自测结果');

function sha256(文本) {
  return crypto.createHash('sha256').update(文本).digest('hex');
}

function 建夹具(片段们, 配方行们) {
  const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), '封包自测-'));
  fs.mkdirSync(path.join(目录, '片段'));
  for (const [名字, 正文] of Object.entries(片段们)) {
    fs.writeFileSync(path.join(目录, '片段', 名字), 正文);
  }
  fs.writeFileSync(path.join(目录, '配方'), 配方行们.join('\n') + '\n');
  return 目录;
}

function 跑(目录) {
  return spawnSync(process.execPath, [入口路径], { cwd: 目录, encoding: 'utf8' });
}

const 用例 = [];
function 记录(名称, 通过, 细节) {
  用例.push({ 名称, 通过, 细节 });
}

// 1. 正常配方:链式依赖保证顺序唯一,打两次总指纹必须一致
{
  const 片段们 = { 甲: '春风\n', 乙: '得意\n', 丙: '马蹄疾\n' };
  const 配方行们 = [
    `甲||${sha256('春风\n')}`,
    `乙|甲|${sha256('得意\n')}`,
    `丙|乙|${sha256('马蹄疾\n')}`,
  ];
  const 目录一 = 建夹具(片段们, 配方行们);
  const 结果一 = 跑(目录一);
  // 换一份目录、换个建文件顺序,模拟另一台机器
  const 目录二 = fs.mkdtempSync(path.join(os.tmpdir(), '封包自测-'));
  fs.mkdirSync(path.join(目录二, '片段'));
  for (const 名字 of ['丙', '甲', '乙']) {
    fs.writeFileSync(path.join(目录二, '片段', 名字), 片段们[名字]);
  }
  fs.writeFileSync(path.join(目录二, '配方'), 配方行们.join('\n') + '\n');
  const 结果二 = 跑(目录二);

  const 指纹一 = 结果一.status === 0 ? fs.readFileSync(path.join(目录一, '产物', '总指纹'), 'utf8') : '';
  const 指纹二 = 结果二.status === 0 ? fs.readFileSync(path.join(目录二, '产物', '总指纹'), 'utf8') : '';
  const 分项 = 结果一.status === 0 ? fs.readFileSync(path.join(目录一, '产物', '分项指纹'), 'utf8') : '';
  const 拼接 = 结果一.status === 0 ? fs.readFileSync(path.join(目录一, '产物', '拼接结果'), 'utf8') : '';
  const 通过 = 结果一.status === 0 && 结果二.status === 0
    && 指纹一 === 指纹二 && 指纹一.trim() === sha256('春风\n得意\n马蹄疾\n')
    && 拼接 === '春风\n得意\n马蹄疾\n'
    && 分项 === `甲|${sha256('春风\n')}\n乙|${sha256('得意\n')}\n丙|${sha256('马蹄疾\n')}\n`;
  记录('正常配方且总指纹稳定', 通过, 通过 ? `总指纹 ${指纹一.trim()}` : `退出码 ${结果一.status}/${结果二.status}, stderr: ${结果一.stderr}${结果二.stderr}`);
}

// 2. 成环
{
  const 目录 = 建夹具(
    { 甲: 'a', 乙: 'b' },
    [`甲|乙|${sha256('a')}`, `乙|甲|${sha256('b')}`],
  );
  const 结果 = 跑(目录);
  const 通过 = 结果.status !== 0 && 结果.stderr.includes('依赖成环') && 结果.stderr.includes('甲') && 结果.stderr.includes('乙');
  记录('成环必须失败', 通过, 结果.stderr.trim());
}

// 3. 缺依赖
{
  const 目录 = 建夹具(
    { 甲: 'a' },
    [`甲|不存在的片段|${sha256('a')}`],
  );
  const 结果 = 跑(目录);
  const 通过 = 结果.status !== 0 && 结果.stderr.includes('依赖缺失') && 结果.stderr.includes('不存在的片段');
  记录('缺依赖必须失败', 通过, 结果.stderr.trim());
}

// 4. 指纹不符
{
  const 目录 = 建夹具(
    { 甲: 'a' },
    [`甲||${'0'.repeat(64)}`],
  );
  const 结果 = 跑(目录);
  const 通过 = 结果.status !== 0 && 结果.stderr.includes('指纹不符') && 结果.stderr.includes('甲');
  记录('指纹不符必须失败', 通过, 结果.stderr.trim());
}

// 5. 路径越界:片段是软链接
{
  const 目录 = 建夹具({}, [`甲||${sha256('外面的内容')}`]);
  const 外部文件 = path.join(os.tmpdir(), `封包自测-外部-${process.pid}`);
  fs.writeFileSync(外部文件, '外面的内容');
  fs.symlinkSync(外部文件, path.join(目录, '片段', '甲'));
  const 结果 = 跑(目录);
  const 通过 = 结果.status !== 0 && 结果.stderr.includes('路径越界') && 结果.stderr.includes('甲');
  记录('软链接越界必须失败', 通过, 结果.stderr.trim());
  fs.unlinkSync(外部文件);
}

// 6. 重复名字
{
  const 目录 = 建夹具(
    { 甲: 'a' },
    [`甲||${sha256('a')}`, `甲||${sha256('a')}`],
  );
  const 结果 = 跑(目录);
  const 通过 = 结果.status !== 0 && 结果.stderr.includes('重复名字') && 结果.stderr.includes('甲');
  记录('重复名字必须失败', 通过, 结果.stderr.trim());
}

// 7. 顺序不唯一:同一层两个无依赖片段
{
  const 目录 = 建夹具(
    { 甲: 'a', 乙: 'b' },
    [`甲||${sha256('a')}`, `乙||${sha256('b')}`],
  );
  const 结果 = 跑(目录);
  const 通过 = 结果.status !== 0 && 结果.stderr.includes('顺序不唯一') && 结果.stderr.includes('甲') && 结果.stderr.includes('乙');
  记录('顺序不唯一必须失败', 通过, 结果.stderr.trim());
}

const 全部通过 = 用例.every((例) => 例.通过);
const 报告行 = [
  `自测时间: ${new Date().toISOString()}`,
  '',
  ...用例.map((例) => `[${例.通过 ? '通过' : '失败'}] ${例.名称} -- ${例.细节}`),
  '',
  全部通过 ? '总结: 全部通过' : '总结: 存在失败',
];
fs.writeFileSync(结果路径, 报告行.join('\n') + '\n');
for (const 行 of 报告行) process.stdout.write(行 + '\n');
process.exit(全部通过 ? 0 : 1);
