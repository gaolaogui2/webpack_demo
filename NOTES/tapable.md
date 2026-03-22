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

- 由于编译依赖 tap 内容，所以每次新增订阅后，缓存 `_call` 都要删掉；

`intercept` 是基类提供的拦截器能力，任意 Plugin 都可以对订阅的 Hook 实例添加拦截逻辑，用以在不改变原有订阅基础上，修改其订阅的内部实现逻辑；
拦截器可以监听所有订阅的 `register` `tap` `call` 这 3 个阶段，插入 1 些自定义逻辑；
多个相同阶段的拦截器会按照 Plugin 的引用顺序执行，不支持自定义权重；

## 不同的子类通过重写 `_compile` 实现不同的执行逻辑

```js
class SyncHook {
  _compile() {
    // 1. 拿到当前所有的订阅（taps）
    const taps = this.taps; // [{ fn, name }, { fn, name }]

    // 2. 把它们编译成一个函数
    return function compiled(...args) {
      // 这个函数体里"硬编码"了所有订阅的回调
      taps[0].fn(...args);
      taps[1].fn(...args);
      // ...
    };
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

- csp-html-webpack-plugin 添加 CSP 相关 meta 标签；
- html-webpack-inject-preload 添加 preload 链接；

所以它提供了若干 AsyncSeriesWaterfallHook 类型的 hook ；
