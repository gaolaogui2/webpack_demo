# Tapable 实现了完善的发布订阅能力

它是插件系统的底层基础设施，在此之上 Compiler 和 Compilation 构建了自己的生命周期。

```js
// 核心类：所有钩子的基类
class Hook {
  constructor(args = []) {
    this._args = args; // 参数名列表，如 ['compilation', 'callback']
    this.taps = []; // 注册的回调
    this._call = null; // 编译后的执行函数缓存
    this.call = this._call; // 对外方法
  }

  // 注册
  tap(name, fn) {
    // 注册同步回调
    this.taps.push({ name, fn, type: "sync" });
    this._call = null; // 清除缓存，下次 call 会重新编译
  }

  // 调用
  call() {
    // 懒编译
    if (!this._call) {
      this._call = this._compile();
    }
    return this._call(...args);
  }

  // 编译
  _compile() {
    // 抽象方法，由子类实现具体的编译逻辑
    throw new Error("必须由子类实现");
  }
}

// 同步串行：不关心返回值
class SyncHook extends Hook {
  constructor(args) {
    super(args); // 调用父类构造函数
  }
  // 重写 _compile 方法，实现同步逻辑
  _compile() {
    // 获取所有注册的回调
    const taps = this.taps;
    const args = this._args;

    // 动态生成执行函数
    // 注意：这里返回的是一个函数，会被缓存到 this._call
    return function syncCall() {
      return `use strict ...`;
    };
  }
}

class SyncBailHook extends Hook {} // 同步串行：返回非undefined即停止
class SyncWaterfallHook extends Hook {} // 同步瀑布：返回值传给下一个
class SyncLoopHook extends Hook {} // 同步循环：返回true则重复执行
class AsyncParallelHook extends Hook {} // 异步并行：不关心返回值
class AsyncParallelBailHook extends Hook {} // 异步并行：第一个出错即停止
class AsyncSeriesHook extends Hook {} // 异步串行：不关心返回值
class AsyncSeriesBailHook extends Hook {} // 异步串行：出错或返回值即停止
class AsyncSeriesWaterfallHook extends Hook {} // 异步串行瀑布：返回值传给下一个

// 容器类（几乎是个空壳，新版本 webpack 已经删掉）
class Tapable {
  constructor() {
    this.hooks = {};
  }
}
```

## Hook 作为基类提供了标准的发布订阅能力

Hook 作为基类实现了标准的发布订阅能力，只负责注册和缓存逻辑；
`_compile` 作为抽象方法，由子类单独实现，通过懒编译 + 缓存机制，避免重复编译：

- 由于编译依赖 `tap` 和 `intercept` 内容，所以每次新增订阅后，缓存 `_call` 都要删掉；

`intercept` 是基类提供的拦截器能力，任意 Plugin 都可以对订阅的 Hook 实例添加拦截逻辑，用以在不改变原有订阅基础上，新增 1 些如 日志、调试 等横切面能力；
拦截器可以监听所有订阅的 `register` `call` `tap` 这 3 个阶段，插入 1 些自定义逻辑；

- `register` 在每个 `tap` 挂载时执行 1 次；
- `call` 在 `hook.call` 触发时执行 1 次；
- `tap` 则在每个 `tap` 回调执行前都执行 1 次；

多个相同阶段的拦截器会按照 Plugin 的引用顺序执行，不支持自定义权重；

tap 与 intercept 的定位与区别：

- `tap` 用于注册业务逻辑回调，执行确定且可编译展开，是插件系统的核心承载点；
- `intercept` 用于注入横切关注点，方法可选，所以需要运行时判断，适合日志、监控、参数注入等辅助逻辑；
- 两者在 `_compile` 中处理方式不同：
  - tap 回调被平铺展开以消除循环开销，
  - `intercept` 逻辑保留循环因其数量少且方法存在性不确定。

## 不同的子类通过重写 `_compile` 实现不同的执行逻辑

```js
class SyncHook {
  constructor(args = []) {
    // 存储所有注册的 tap 回调
    this._x = undefined; // 实际存储函数的数组
    this.taps = []; // 存储 tap 信息（name, type, fn）
    this.interceptors = []; // 存储拦截器
    this._args = args; // 参数名称列表，如 ['name', 'age']
  }

  // 注册 tap 回调
  tap(options, fn) {
    this._tap("sync", options, fn);
  }

  _tap(type, options, fn) {
    // 标准化 options
    if (typeof options === "string") {
      options = { name: options };
    }

    const tapInfo = {
      type,
      fn,
      name: options.name,
      ...options,
    };

    // 调用 intercept 的 register 钩子
    for (const interceptor of this.interceptors) {
      if (interceptor.register) {
        const newTapInfo = interceptor.register(tapInfo);
        if (newTapInfo) {
          tapInfo.fn = newTapInfo.fn;
          tapInfo.name = newTapInfo.name;
        }
      }
    }

    // 添加到 taps 数组
    this.taps.push(tapInfo);

    // 重新编译 hook
    this._compile();
  }

  // 添加拦截器
  intercept(interceptor) {
    this.interceptors.push(interceptor);

    // 如果已有 taps，对新添加的 taps 调用 register
    if (interceptor.register) {
      for (let i = 0; i < this.taps.length; i++) {
        const newTapInfo = interceptor.register(this.taps[i]);
        if (newTapInfo) {
          this.taps[i] = newTapInfo;
        }
      }
    }

    // 重新编译
    this._compile();
  }

  // 调用 hook
  call(...args) {
    // 执行编译后的函数
    return this._call(args);
  }

  // 编译方法：生成调用函数
  _compile() {
    // 提取所有 tap 函数到 _x 数组
    this._x = this.taps.map((tap) => tap.fn);

    // 生成函数代码
    const code = this._createCallCode();

    // 使用 new Function 创建函数
    // 参数: this, _x, 实际的调用参数
    this._call = new Function(
      "var _context;\n" +
        "var _x = this._x;\n" +
        "var _taps = this.taps;\n" +
        "var _interceptors = this.interceptors;\n" +
        code,
    ).bind(this);
  }

  // 核心：生成调用代码（这是关键）
  _createCallCode() {
    const taps = this.taps;
    const interceptors = this.interceptors;
    const args = this._args;

    // 构建参数列表
    const argsStr = args.length ? args.join(", ") : "";

    let code = "";

    // 1. 生成 intercept 的 call 钩子（循环，因为方法可选）
    if (interceptors.length > 0) {
      code += `
        var _interceptors = this.interceptors;
        if (_interceptors.length > 0) {
          for (var i = 0; i < _interceptors.length; i++) {
            var interceptor = _interceptors[i];
            if (interceptor.call) {
              interceptor.call(${argsStr});
            }
          }
        }
      `;
    }

    // 2. 生成 tap 回调的执行代码（平铺展开）
    for (let i = 0; i < taps.length; i++) {
      const tap = taps[i];

      // 每个 tap 执行前，调用 intercept 的 tap 钩子（循环）
      if (interceptors.length > 0) {
        code += `
          {
            var _tap = this.taps[${i}];
            for (var j = 0; j < _interceptors.length; j++) {
              var interceptor = _interceptors[j];
              if (interceptor.tap) {
                interceptor.tap(_tap);
              }
            }
          }
        `;
      }

      // 执行 tap 回调（直接调用，没有循环）
      code += `
        var _fn${i} = _x[${i}];
        var _result${i} = _fn${i}(${argsStr});
      `;

      // SyncBailHook 会有返回判断，但 SyncHook 不需要
      // if (_result${i} !== undefined) return _result${i};
    }

    // 3. 返回结果（SyncHook 返回最后一个结果）
    if (taps.length > 0) {
      code += `return _result${taps.length - 1};`;
    } else {
      code += `return undefined;`;
    }

    return code;
  }
}
```

不同的子类通过重写 `_compile` 实现不同的执行逻辑。例如：

- `SyncHook` 会将回调依次排列按顺序执行；
- `BailHook` 会判断前 1 个回调的返回值是否为 undefined 来决定是否继续向下执行；
- `AsyncServiceHook` 中后 1 个 Promise 回调的执行时机依赖于前 1 个 Promise 回调的完整状态；
- 等等；

`_compile` 内部逻辑可以简单理解为是拼接，会把所有订阅回调都「编织」进了最终的执行函数中，
也包括拦截器等 `tap` 以外的内容，
来确保在真正执行回调时不再包含「遍历数组」等运行时开销，
在 Node.js 环境中，这种「以空间换时间」思路的开销远小于循环控制的开销；

## Compiler 和 Compilation 实例在 hooks 字段中声明若干个具备语义的特定类型的钩子实例，实现它的生命周期

Compiler 和 Compilation 实例在 hooks 字段中声明若干个具备语义的特定类型的钩子实例，实现它的生命周期。

Compiler 中：

- `environment` 相关代表环境准备阶段；
- `run` 相关代表运行阶段；
- `compile` `compilation` `make` 相关代表编译阶段；
- `emit` 相关代表产出阶段；

Compilation 中：

- `addEntry` 开始识别入口文件；
- `buildModule` `succeedModule` 相关代表模块构建阶段；
- `finishModules` 表示所有模块构建完成；
- `seal` 表述开始进行封装；
- `optimize` 相关表示进行优化；
- `processAssets` 相关表示资源生成；

同时外部插件也可以新增生命周期节点提供给其它插件挂载回调；
例如 html-webpack-plugin ，本身也是对其他插件的"服务提供者" ，
它需要在HTML生成的不同阶段暴露控制点，让其他插件可以修改标签、内容、属性等，例如：

- `csp-html-webpack-plugin` 添加 CSP 相关 meta 标签；
- `html-webpack-inject-preload` 添加 preload 链接；

所以它提供了若干 `AsyncSeriesWaterfallHook` 类型的 hook ；
