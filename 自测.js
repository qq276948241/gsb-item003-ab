'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const child_process = require('child_process');

const 工程目录 = __dirname;
const 入口 = path.join(工程目录, '入口.js');
const 临时根目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'fengbao-selftest-'));
let 用例序号 = 0;

function 建工程目录() {
  用例序号 += 1;
  const 目录 = path.join(临时根目录, 'case-' + 用例序号);
  fs.mkdirSync(path.join(目录, '片段'), { recursive: true });
  return 目录;
}

function 写配方(目录, 行表) {
  fs.writeFileSync(path.join(目录, '配方'), 行表.join('\n') + '\n', 'utf8');
}

function 写片段(目录, 名字, 正文) {
  fs.writeFileSync(path.join(目录, '片段', 名字), Buffer.from(正文, 'utf8'));
}

function 指纹(正文) {
  return crypto.createHash('sha256').update(Buffer.from(正文, 'utf8')).digest('hex');
}

function 跑入口(目录) {
  return child_process.spawnSync(process.execPath, [入口, 目录], { encoding: 'utf8' });
}

function 期望失败(用例名, 目录, 类别关键字, 名字关键字) {
  const 结果 = 跑入口(目录);
  const 问题 = [];
  if (结果.status === 0) {
    问题.push('期望失败但退出状态为 0');
  }
  if (结果.stderr.indexOf('打包失败｜') === -1) {
    问题.push('标准错误缺少“打包失败｜”前缀');
  }
  if (结果.stderr.indexOf(类别关键字) === -1) {
    问题.push('标准错误缺少问题类别“' + 类别关键字 + '”，实际：' + JSON.stringify(结果.stderr));
  }
  if (名字关键字 && 结果.stderr.indexOf(名字关键字) === -1) {
    问题.push('标准错误缺少牵涉的名字“' + 名字关键字 + '”，实际：' + JSON.stringify(结果.stderr));
  }
  return {
 通过: 问题.length === 0,
 详情: 问题.length > 0 ? 问题.join('；') : '退出码 ' + 结果.status + '，报错：' + 结果.stderr.trim()
  };
}

function 用例成环() {
  const 目录 = 建工程目录();
  const 甲 = '甲段', 乙 = '乙段', 丙 = '丙段';
  写片段(目录, 甲, '甲');
  写片段(目录, 乙, '乙');
  写片段(目录, 丙, '丙');
  写配方(目录, [
    甲 + '|' + 乙 + '|' + 指纹('甲'),
    乙 + '|' + 丙 + '|' + 指纹('乙'),
    丙 + '|' + 甲 + '|' + 指纹('丙')
  ]);
  return 期望失败('成环', 目录, '依赖成环', 甲);
}

function 用例缺依赖() {
  const 目录 = 建工程目录();
  写片段(目录, '甲段', '甲');
  写配方(目录, ['甲段|乙段|' + 指纹('甲')]);
  return 期望失败('缺依赖', 目录, '依赖缺失', '乙段');
}

function 用例自己依赖自己() {
  const 目录 = 建工程目录();
  写片段(目录, '甲段', '甲');
  写配方(目录, ['甲段|甲段|' + 指纹('甲')]);
  return 期望失败('自己依赖自己', 目录, '依赖自己', '甲段');
}

function 用例顺序不唯一() {
  const 目录 = 建工程目录();
  写片段(目录, '甲段', '甲');
  写片段(目录, '乙段', '乙');
  写配方(目录, [
    '甲段||' + 指纹('甲'),
    '乙段||' + 指纹('乙')
  ]);
  return 期望失败('同层顺序不唯一', 目录, '先后顺序不唯一', '');
}

function 用例指纹不符() {
  const 目录 = 建工程目录();
  写片段(目录, '甲段', '甲');
  写配方(目录, ['甲段||' + '0'.repeat(64)]);
  return 期望失败('指纹不符', 目录, '指纹不符', '甲段');
}

function 用例路径越界() {
  const 目录 = 建工程目录();
  const 外部正文 = '我在工作目录外面';
  const 外部文件 = path.join(临时根目录, 'outside-' + 用例序号 + '.txt');
  fs.writeFileSync(外部文件, Buffer.from(外部正文, 'utf8'));
  写片段(目录, '甲段', '占位');
  const 链接路径 = path.join(目录, '片段', '甲段');
  fs.rmSync(链接路径);
  fs.symlinkSync(外部文件, 链接路径);
  写配方(目录, ['甲段||' + 指纹(外部正文)]);
  return 期望失败('路径越界（软链接）', 目录, '路径越界', '甲段');
}

function 用例重复名字() {
  const 目录 = 建工程目录();
  写片段(目录, '甲段', '甲');
  写配方(目录, [
    '甲段||' + 指纹('甲'),
    '甲段||' + 指纹('甲')
  ]);
  return 期望失败('重复名字', 目录, '重复名字', '甲段');
}

function 用例正常配方() {
  const 目录 = 建工程目录();
  const 正文表 = {
    '地基-1': '第一层\n',
    '梁-2': '第二层',
    '顶3': '第三层\n收尾\n'
  };
  Object.keys(正文表).forEach(function (名字) {
    写片段(目录, 名字, 正文表[名字]);
  });
  写配方(目录, [
    '地基-1||' + 指纹(正文表['地基-1']),
    '梁-2|地基-1|' + 指纹(正文表['梁-2']),
    '顶3|梁-2、地基-1|' + 指纹(正文表['顶3'])
  ]);

  const 第一次 = 跑入口(目录);
  const 问题 = [];
  if (第一次.status !== 0) {
    问题.push('首次打包退出码为 ' + 第一次.status + '：' + 第一次.stderr);
  }

  const 拼接原文 = 正文表['地基-1'] + 正文表['梁-2'] + 正文表['顶3'];
  let 总指纹甲 = null;

  if (问题.length === 0) {
    const 拼接文件 = fs.readFileSync(path.join(目录, '产物', '拼接结果'));
    if (Buffer.compare(拼接文件, Buffer.from(拼接原文, 'utf8')) !== 0) {
      问题.push('拼接结果与依赖顺序正文不一致');
    }
    const 分项 = fs.readFileSync(path.join(目录, '产物', '分项指纹'), 'utf8');
    const 期望分项 = [
      '地基-1|' + 指纹(正文表['地基-1']),
      '梁-2|' + 指纹(正文表['梁-2']),
      '顶3|' + 指纹(正文表['顶3'])
    ].join('\n') + '\n';
    if (分项 !== 期望分项) {
      问题.push('分项指纹内容或顺序不对：' + JSON.stringify(分项));
    }
    总指纹甲 = fs.readFileSync(path.join(目录, '产物', '总指纹'), 'utf8').trim();
    if (!/^[0-9a-f]{64}$/.test(总指纹甲)) {
      问题.push('总指纹不是 64 位小写十六进制：' + 总指纹甲);
    }
  }

  let 总指纹乙 = null;
  if (问题.length === 0) {
    const 副本目录 = path.join(临时根目录, 'case-' + 用例序号 + '-copy');
    fs.cpSync(目录, 副本目录, { recursive: true });
    const 第二次 = 跑入口(副本目录);
    if (第二次.status !== 0) {
      问题.push('在另一目录重打退出码为 ' + 第二次.status + '：' + 第二次.stderr);
    } else {
      总指纹乙 = fs.readFileSync(path.join(副本目录, '产物', '总指纹'), 'utf8').trim();
      if (总指纹甲 !== 总指纹乙) {
        问题.push('同配方同原文在不同目录打出的总指纹不一致：' + 总指纹甲 + ' vs ' + 总指纹乙);
      }
    }
  }

  return {
    通过: 问题.length === 0,
    详情: 问题.length > 0
      ? 问题.join('；')
      : '退出码 0；三份产物齐备；跨目录重打总指纹一致：' + 总指纹甲
  };
}

const 用例表 = [
  ['正常配方：依赖顺序、三份产物、跨目录总指纹稳定', 用例正常配方],
  ['失败：依赖成环', 用例成环],
  ['失败：依赖缺失', 用例缺依赖],
  ['失败：自己依赖自己', 用例自己依赖自己],
  ['失败：同层先后不唯一', 用例顺序不唯一],
  ['失败：指纹不符', 用例指纹不符],
  ['失败：路径越界（软链接）', 用例路径越界],
  ['失败：重复名字', 用例重复名字]
];

const 报告行 = [];
let 通过数 = 0;
用例表.forEach(function (条目) {
  const 名字 = 条目[0];
  let 结论;
  try {
    结论 = 条目[1]();
  } catch (err) {
    结论 = { 通过: false, 详情: '自测本身抛错：' + (err && err.stack ? err.stack : String(err)) };
  }
  if (结论.通过) {
    通过数 += 1;
  }
  报告行.push('[' + (结论.通过 ? '通过' : '失败') + '] ' + 名字);
  报告行.push('        ' + 结论.详情);
});

const 全部通过 = 通过数 === 用例表.length;
报告行.unshift('打包工具自测：' + 通过数 + '/' + 用例表.length + ' 个用例通过');
报告行.push(全部通过 ? '结论：全部通过' : '结论：存在失败用例');
const 报告 = 报告行.join('\n') + '\n';

fs.writeFileSync(path.join(工程目录, '自测结果'), 报告, 'utf8');
process.stdout.write(报告);

try {
  fs.rmSync(临时根目录, { recursive: true, force: true });
} catch (err) {
  // 清理临时目录失败不影响自测结论
}

process.exitCode = 全部通过 ? 0 : 1;
