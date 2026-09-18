'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class 打包错误 extends Error {
  constructor(类别, 消息) {
    super(消息);
    this.name = '打包错误';
    this.类别 = 类别;
  }
}

const 名字规则 = /^[一-龥0-9-]+$/;
const 指纹规则 = /^[0-9a-f]{64}$/;

function 引用名(名字) {
  return '「' + 名字 + '」';
}

function 解析配方(原文) {
  const 行表 = 原文.toString('utf8').split('\n');
  const 片段表 = [];
  const 出现过 = new Map();

  行表.forEach(function (原始行, 下标) {
    const 行号 = 下标 + 1;
    const 行 = 原始行.replace(/\r$/, '');
    if (行.trim() === '') {
      return;
    }

    const 字段 = 行.split('|');
    if (字段.length !== 3) {
      throw new 打包错误('配方格式错误', '第 ' + 行号 + ' 行不是“名字|依赖|指纹”三段结构');
    }

    const 名字 = 字段[0];
    const 依赖段 = 字段[1];
    const 指纹 = 字段[2];

    if (!名字规则.test(名字)) {
      throw new 打包错误('名字非法', '第 ' + 行号 + ' 行的名字 ' + 引用名(名字) + ' 只允许汉字、数字和短横线');
    }
    if (出现过.has(名字)) {
      throw new 打包错误('重复名字', '名字 ' + 引用名(名字) + ' 第 2 次出现（第 ' + 行号 + ' 行，首见于第 ' + 出现过.get(名字) + ' 行）');
    }
    if (!指纹规则.test(指纹)) {
      throw new 打包错误('指纹非法', '片段 ' + 引用名(名字) + ' 的指纹不是 64 位小写十六进制 SHA-256');
    }

    let 依赖 = [];
    if (依赖段 !== '') {
      依赖 = 依赖段.split('、');
      const 见过的依赖 = new Set();
      for (const 依赖名 of 依赖) {
        if (!名字规则.test(依赖名)) {
          throw new 打包错误('名字非法', '片段 ' + 引用名(名字) + ' 声明的依赖名 ' + 引用名(依赖名) + ' 只允许汉字、数字和短横线');
        }
        if (见过的依赖.has(依赖名)) {
          throw new 打包错误('配方格式错误', '片段 ' + 引用名(名字) + ' 的依赖中 ' + 引用名(依赖名) + ' 重复声明');
        }
        见过的依赖.add(依赖名);
      }
    }

    出现过.set(名字, 行号);
    片段表.push({ 名字: 名字, 依赖: 依赖, 指纹: 指纹 });
  });

  return 片段表;
}

function 排依赖顺序(片段表) {
  const 信息 = new Map();
  for (const 片段 of 片段表) {
    信息.set(片段.名字, { 依赖: 片段.依赖.slice(), 后继: [], 入度: 0 });
  }

  const 自依赖 = [];
  const 缺失 = new Map();
  for (const 片段 of 片段表) {
    for (const 依赖名 of 片段.依赖) {
      if (依赖名 === 片段.名字) {
        自依赖.push(片段.名字);
        continue;
      }
      if (!信息.has(依赖名)) {
        if (!缺失.has(依赖名)) {
          缺失.set(依赖名, []);
        }
        缺失.get(依赖名).push(片段.名字);
      }
    }
  }

  if (自依赖.length > 0) {
    自依赖.sort();
    throw new 打包错误('依赖自己', '片段依赖自己：' + 自依赖.map(引用名).join('、'));
  }
  if (缺失.size > 0) {
    const 明细 = Array.from(缺失.keys()).sort().map(function (依赖名) {
      return 引用名(依赖名) + '（被 ' + 缺失.get(依赖名).map(引用名).join('、') + ' 依赖）';
    });
    throw new 打包错误('依赖缺失', '配方点名了不存在的片段：' + 明细.join('；'));
  }

  for (const 片段 of 片段表) {
    const 当前 = 信息.get(片段.名字);
    当前.入度 = 当前.依赖.length;
    for (const 依赖名 of 当前.依赖) {
      信息.get(依赖名).后继.push(片段.名字);
    }
  }

  const 顺序 = [];
  for (;;) {
    const 就绪 = [];
    for (const 片段 of 片段表) {
      const 当前 = 信息.get(片段.名字);
      if (当前.入度 === 0 && !当前.已排) {
        就绪.push(片段.名字);
      }
    }

    if (就绪.length === 0) {
      break;
    }
    if (就绪.length > 1) {
      就绪.sort();
      throw new 打包错误('先后顺序不唯一', '同一层里这些片段谁先谁后都说得通：' + 就绪.map(引用名).join('、'));
    }

    const 名字 = 就绪[0];
    信息.get(名字).已排 = true;
    顺序.push(名字);
    for (const 下游 of 信息.get(名字).后继) {
      信息.get(下游).入度 -= 1;
    }
  }

  if (顺序.length < 片段表.length) {
    const 卡住 = [];
    for (const 片段 of 片段表) {
      if (!信息.get(片段.名字).已排) {
        卡住.push(片段.名字);
      }
    }
    卡住.sort();
    throw new 打包错误('依赖成环', '依赖关系成环，卡住的片段：' + 卡住.map(引用名).join('、'));
  }

  return 顺序;
}

function 读取并核对片段(工作目录, 片段表) {
  const 片段目录 = path.join(工作目录, '片段');
  let 根真实路径;
  try {
    根真实路径 = fs.realpathSync(工作目录);
  } catch (err) {
    throw new 打包错误('工作目录无效', '工作目录不存在或无法访问：' + 工作目录);
  }

  let 目录真实路径;
  try {
    目录真实路径 = fs.realpathSync(片段目录);
  } catch (err) {
    throw new 打包错误('片段目录缺失', '找不到“片段”文件夹：' + 片段目录);
  }

  const 相对路径 = path.relative(根真实路径, 目录真实路径);
  if (相对路径 === '' || 相对路径.startsWith('..') || path.isAbsolute(相对路径)) {
    throw new 打包错误('路径越界', '“片段”文件夹没有老老实实待在工作目录里');
  }

  const 按名字 = new Map();
  for (const 片段 of 片段表) {
    按名字.set(片段.名字, 片段);
  }

  const 正文表 = new Map();
  for (const 片段 of 片段表) {
    const 文件路径 = path.join(片段目录, 片段.名字);

    let 链接信息;
    try {
      链接信息 = fs.lstatSync(文件路径);
    } catch (err) {
      throw new 打包错误('片段文件缺失', '片段 ' + 引用名(片段.名字) + ' 的正文文件缺失：' + 文件路径);
    }
    if (链接信息.isSymbolicLink()) {
      throw new 打包错误('路径越界', '片段 ' + 引用名(片段.名字) + ' 是软链接，一律拒绝：' + 文件路径);
    }

    let 真实路径;
    try {
      真实路径 = fs.realpathSync(文件路径);
    } catch (err) {
      throw new 打包错误('路径越界', '片段 ' + 引用名(片段.名字) + ' 的路径无法解析：' + 文件路径);
    }
    const 在目录内 = path.relative(目录真实路径, 真实路径);
    if (在目录内.startsWith('..') || path.isAbsolute(在目录内)) {
      throw new 打包错误('路径越界', '片段 ' + 引用名(片段.名字) + ' 跳到工作目录之外，一律拒绝');
    }
    if (!链接信息.isFile()) {
      throw new 打包错误('片段文件非法', '片段 ' + 引用名(片段.名字) + ' 的正文不是普通文件：' + 文件路径);
    }

    const 正文 = fs.readFileSync(文件路径);
    const 实际指纹 = crypto.createHash('sha256').update(正文).digest('hex');
    if (实际指纹 !== 片段.指纹) {
      throw new 打包错误(
        '指纹不符',
        '片段 ' + 引用名(片段.名字) + ' 的指纹对不上（配方记载 ' + 片段.指纹 + '，实际算出 ' + 实际指纹 + '）'
      );
    }
    正文表.set(片段.名字, 正文);
  }

  return 正文表;
}

function 算总指纹(顺序, 正文表) {
  const 摘要 = crypto.createHash('sha256');
  for (const 名字 of 顺序) {
    const 正文 = 正文表.get(名字);
    const 名字字节 = Buffer.from(名字, 'utf8');
    摘要.update('片段名|');
    摘要.update(名字字节.length.toString());
    摘要.update('|');
    摘要.update(名字字节);
    摘要.update('\n');
    摘要.update('正文长度|');
    摘要.update(正文.length.toString());
    摘要.update('\n');
    摘要.update(正文);
    摘要.update('\n');
  }
  return 摘要.digest('hex');
}

function 打包(工作目录) {
  const 配方路径 = path.join(工作目录, '配方');
  let 配方原文;
  try {
    配方原文 = fs.readFileSync(配方路径);
  } catch (err) {
    throw new 打包错误('配方缺失', '找不到配方文件：' + 配方路径);
  }

  const 片段表 = 解析配方(配方原文);
  const 顺序 = 排依赖顺序(片段表);
  const 正文表 = 读取并核对片段(工作目录, 片段表);

  const 拼接 = Buffer.concat(顺序.map(function (名字) {
    return 正文表.get(名字);
  }));
  const 总指纹 = 算总指纹(顺序, 正文表);

  const 产物目录 = path.join(工作目录, '产物');
  fs.mkdirSync(产物目录, { recursive: true });
  fs.writeFileSync(path.join(产物目录, '拼接结果'), 拼接);
  fs.writeFileSync(path.join(产物目录, '总指纹'), 总指纹 + '\n', 'utf8');
  const 分项行 = 顺序.map(function (名字) {
    const 片段 = 片段表.find(function (条目) {
      return 条目.名字 === 名字;
    });
    return 名字 + '|' + 片段.指纹;
  });
  fs.writeFileSync(path.join(产物目录, '分项指纹'), 分项行.join('\n') + (分项行.length > 0 ? '\n' : ''), 'utf8');

  return { 顺序: 顺序, 总指纹: 总指纹 };
}

module.exports = { 打包: 打包, 打包错误: 打包错误 };
