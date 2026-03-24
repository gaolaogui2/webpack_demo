# Webpack 提供了完整的 配置 -> 编译 JS&JSON -> 产出 的能力并支持在所有打包节点进行 IOC

```js
class Compilation extends Tapable {
  constructor(compiler) {
    super();

    this.compiler = compiler; // 所属的 Compiler
    this.options = compiler.options;
    this.inputFileSystem = compiler.inputFileSystem;
    this.outputFileSystem = compiler.outputFileSystem;

    // ===== 核心数据结构 =====
    this.modules = new Set(); // 所有模块
    this.chunks = new Set(); // 所有代码块
    this.assets = {}; // 待输出的资源
    this.errors = []; // 错误收集
    this.warnings = []; // 警告收集

    // ===== 依赖关系图 =====
    this.moduleGraph = new ModuleGraph(); // 模块依赖图
    this.chunkGraph = new ChunkGraph(); // Chunk 关系图

    // ===== 内置钩子 =====
    this.hooks = {
      buildModule: new SyncHook(["module"]), // 开始构建一个模块前
      succeedModule: new SyncHook(["module"]), // 模块构建成功后
      finishModules: new AsyncSeriesHook(["modules"]), // 所有模块构建完成
      seal: new SyncHook(), // 开始封装
      optimizeChunks: new SyncHook(["chunks"]), // 优化 Chunk
      // ... 更多
    };
  }
  // 15. 构建模块
  buildModule(module, callback) {
    this.hooks.buildModule.call(module);

    // 执行 Loader → 解析 AST → 收集依赖
    module.build(this.options, this, (err) => {
      if (err) return callback(err);

      this.hooks.succeedModule.call(module);
      callback(null, module);
    });
  }

  // 16. 处理依赖，构建依赖图
  processModuleDependencies() {
    const dependencies = module.dependencies;

    // 调用 addModuleDependencies 处理所有依赖
    this.addModuleDependencies(module, dependencies, callback);
  }

  // 17. 递归处理每个依赖重走 1 次 buildModule -> processModuleDependencies
  addModuleDependencies(module, dependencies, callback) {}

  // 完成构建
  finish(callback) {
    this.hooks.finishModules.callAsync(this.modules, callback);
  }

  // 封装（模块 → Chunk）
  seal(callback) {
    this.hooks.seal.call(); // 开始封装

    // 20. 创建 Chunk（根据入口和动态导入）
    this.createChunks();

    // 21. 构建 ChunkGraph（Chunk 之间的关系）
    this.buildChunkGraph();

    // 22. 优化 Chunk（合并、分割等）
    this.hooks.optimizeChunks.callAsync(this.chunks, () => {
      // 23. 生成资源（将 Chunk 转为 Asset）
      this.createAssets();

      this.hooks.afterSeal.call();
      callback();
    });
  }

  // 进行 DAG 计算，确保没有循环依赖
  buildChunkGraph() {}

  // 4. 添加资源
  emitAsset(filename, source) {
    this.assets[filename] = source;
  }
}

class Compiler extends Tapable {
  hooks;
  options;
  constructor(context) {
    super();
    // 5.1 生命 Compiler 相关 hooks
    this.hooks = {
      // -------------------- 环境准备 --------------------
      environment: new SyncHook(), // 环境正在准备
      afterEnvironment: new SyncHook(), // 环境已就绪

      // -------------------- 运行期 --------------------
      beforeRun: new AsyncSeriesHook(["compiler"]), // 运行前
      run: new AsyncSeriesHook(["compiler"]), // 运行开始
      watchRun: new AsyncSeriesHook(["compiler"]), // 监听模式运行

      // -------------------- 编译期 --------------------
      beforeCompile: new AsyncSeriesHook(["params"]), // 编译参数准备
      compile: new SyncHook(["params"]), // 编译开始

      thisCompilation: new SyncHook(["compilation", "params"]), // Compilation创建瞬间
      compilation: new SyncHook(["compilation", "params"]), // Compilation准备就绪

      make: new AsyncParallelHook(["compilation"]), // 开始构建模块（核心！）

      afterCompile: new AsyncSeriesHook(["compilation"]), // 编译完成

      // -------------------- 产出期 --------------------
      shouldEmit: new SyncBailHook(["compilation"]), // 是否输出文件
      emit: new AsyncSeriesHook(["compilation"]), // 输出文件
      afterEmit: new AsyncSeriesHook(["compilation"]), // 输出完成

      // -------------------- 完成期 --------------------
      done: new AsyncSeriesHook(["stats"]), // 构建成功完成
      failed: new SyncHook(["error"]), // 构建失败
      afterDone: new SyncHook(["stats"]), // done之后（缓存清理等）

      // -------------------- 监听模式 --------------------
      watchClose: new SyncHook(), // 监听停止

      // -------------------- 其他基础设施 --------------------
      initialize: new SyncHook(), // 所有配置应用完成
      infrastructureLog: new SyncHook(["log"]), // 日志
      log: new SyncHook(["log"]), // 日志
    };
  }

  newCompilation(params) {
    // 创建 Compilation 实例
    const compilation = new Compilation(this, params);

    // 触发 thisCompilation 钩子（刚创建）
    this.hooks.thisCompilation.call(compilation, params);

    // 触发 compilation 钩子（准备就绪）
    this.hooks.compilation.call(compilation, params);

    return compilation;
  }

  // 编译
  compile(callback) {
    // 创建编译参数
    const params = this.newCompilationParams();

    // 触发compile钩子
    this.hooks.compile.call(params);

    // 12. 创建compilation（核心产出）
    const compilation = this.newCompilation(params);

    // 13. 触发make钩子 - 推进 Compilation 开始编译构建
    this.hooks.make.callAsync(compilation, (err) => {
      if (err) return callback(err);

      // 18. 完成编译
      compilation.finish((err) => {
        if (err) return callback(err);

        // 19. 封装结果
        compilation.seal((err) => {
          if (err) return callback(err);

          // 返回编译结果
          callback(null, compilation);
        });
      });
    });
  }

  // 运行
  run(callback) {
    // 处理最终回调
    const onCompiled = (err, compilation) => {
      if (err) return finalCallback(err);

      // 触发emit钩子
      this.hooks.emit.callAsync(compilation, (err) => {
        if (err) return finalCallback(err);

        // 24. 写入文件系统
        this.emitAssets(compilation, (err) => {
          // 触发done钩子
          this.hooks.done.callAsync(stats, finalCallback);
        });
      });
    };

    // 触发beforeRun钩子
    this.hooks.beforeRun.callAsync(this, (err) => {
      if (err) return finalCallback(err);

      // 触发run钩子
      this.hooks.run.callAsync(this, (err) => {
        if (err) return finalCallback(err);

        // 11. 调用compile开始真正的编译
        this.compile(onCompiled);
      });
    });
  }

  // 输出结果到文件系统中
  emitAssets() {}

  close(callback) {
    // 触发close钩子，让插件清理资源
    this.hooks.close.callAsync((err) => {
      // 清理文件监听
      if (this.watching) {
        this.watching.close();
      }

      // 释放内存
      this.cache = null;
      this.compilations = [];

      // 完成清理
      callback(err);
    });
  }

  watch(watchOptions, handler) {
    // 创建 Watching 实例
    const watching = new Watching(this, watchOptions, handler);

    // 启动文件监听
    this.watchFileSystem.watch(watchOptions, (err, changes) => {
      // 文件变化时调用 watching 的 _go 方法
      watching._go(changes); // ✅ 应该是 watching._go，不是 this._go
    });

    // 返回 Watching 对象
    return watching;
  }
}

const createCompiler = (rawOptions) => {
  // 4. 标准化配置，处理预设
  const options = getNormalizedWebpackOptions(rawOptions);
  applyWebpackOptionsBaseDefaults(options);

  // 5. 实例化Compiler - 这是**第一个**Compiler对象
  const compiler = new Compiler(options.context);
  compiler.options = options;

  // 6. 现在Compiler有了钩子，开始挂载配置中的插件
  if (Array.isArray(options.plugins)) {
    for (const plugin of options.plugins) {
      if (typeof plugin === "function") {
        plugin.call(compiler, compiler); // 这里才真正调用插件的apply方法！
      } else {
        plugin.apply(compiler);
      }
    }
  }

  // 7. 注入核心内置插件（如EntryPlugin、NodeEnvironmentPlugin等）
  new NodeEnvironmentPlugin().apply(compiler);

  // 8. Compiler 环境准备相关 hooks 执行
  compiler.hooks.environment.call();
  compiler.hooks.afterEnvironment.call();

  // 9. 应用所有内置插件（基于配置）
  new WebpackOptionsApply().process(options, compiler);

  return compiler;
};

const webpack = (options, callback) => {
  // 1. 验证配置
  validateSchema(schema, options);

  // 2. 应用默认配置
  options = { ...defaultOptions, ...options };

  // 3. 创建Compiler
  const compiler = createCompiler(options);

  // 10. 立即执行模式：如果传了callback，直接执行
  if (callback) {
    compiler.run((err, stats) => {
      compiler.close((closeErr) => {
        callback(err || closeErr, stats);
      });
    });
    // 构建已经异步开始了，但这里返回的compiler仍然可用
    return compiler;
  }

  // 999. 惰性模式：如果没有callback，只返回compiler（由调用者自己控制）
  return compiler;
};

// 基础设施
class NodeEnvironmentPlugin {
  apply(compiler) {
    // 输入文件系统（读取文件的基础）
    compiler.inputFileSystem = new CachedInputFileSystem(new NodeJsInputFileSystem(), 60000);

    // 输出文件系统（写入文件的基础）
    compiler.outputFileSystem = new NodeOutputFileSystem();

    // 监听文件系统（watch 模式的基础）
    compiler.watchFileSystem = new NodeWatchFileSystem(compiler.inputFileSystem);

    // 缓存系统
    compiler.cache = new MemoryCachePlugin();
  }
}

// 所有内置插件的注册中心
class WebpackOptionsApply {
  process(options, compiler) {
    // 输入：标准化后的配置对象 + Compiler 实例
    // 输出：根据配置，注册所有需要的内置插件

    // 基础插件（几乎总是启用）
    new JavascriptModulesPlugin().apply(compiler);
    new JsonModulesPlugin().apply(compiler);

    // 14. 根据入口配置
    if (options.entry) {
      new EntryOptionPlugin().apply(compiler);
    }

    // 根据输出配置
    if (options.output.path) {
      // 输出相关插件
    }

    // 根据目标环境
    switch (options.target) {
      case "web":
        new WebTargetPlugin().apply(compiler);
        break;
      case "node":
        new NodeTargetPlugin().apply(compiler);
        break;
      case "electron-main":
        new ElectronTargetPlugin().apply(compiler);
        break;
    }

    // 根据优化配置
    if (options.optimization) {
      if (options.optimization.splitChunks) {
        new SplitChunksPlugin().apply(compiler);
      }
      if (options.optimization.minimize) {
        new TerserPlugin().apply(compiler);
      }
    }

    // 根据模块规则
    if (options.module) {
      if (options.module.rules) {
        new RuleSetPlugin().apply(compiler);
      }
    }

    // ... 几百行这样的条件判断
  }
}

// 文件监听中间件：收集涉及文件改动相关的回调，挂载到 Compiler.compile 中
class Watching {
  constructor(compiler, watchOptions, handler) {
    this.compiler = compiler;
    this.handler = handler; // 编译完成的回调
    this.running = false;
  }

  _go(changes) {
    this.running = true;

    // 触发 watchRun 钩子
    this.compiler.hooks.watchRun.callAsync(this.compiler, () => {
      // 执行编译（复用之前的 compile 逻辑！）
      this.compiler.compile((err, compilation) => {
        // 编译完成，调用 handler
        this.handler(err, stats);
        this.running = false;
      });
    });
  }

  close(callback) {
    // 停止监听
    this.compiler.watchFileSystem.close(callback);
  }
}

export { webpack };
```

## 0. webpack 函数本质上是 1 个工厂函数，负责实例化 Compiler，是整个 Webpack 构建流程的启动入口。

webpack 函数本质上是 1 个工厂函数，负责实例化 Compiler，是整个 Webpack 构建流程的启动入口。

> 这里说它是工厂函数，是因为它不直接作为类被实例化（不通过 new webpack() 调用），
> 而是通过普通函数调用 webpack(config) 来创建并返回 1 个全新的实例。

在 Node.js 环境中调用它时：

1. webpack 函数接收 1 个配置对象（或配置数组）作为参数，返回 1 个 Compiler 实例。这个实例代表了整个编译过程的完整生命周期，拥有 run、watch 等方法，以及贯穿整个构建过程的钩子系统。

2. 它内部会解析用户传入的配置，合并默认配置、CLI 参数以及不同模式下的预设配置，最终生成标准化的配置对象传递给 Compiler。

3. 当传入配置数组或 1 个返回包含多个配置的函数时，它会创建 MultiCompiler 实例，用于并行或串行管理多个独立的编译流程。

## 1. 应用默认配置

webpack 会根据「CLI 命令行参数 > 用户配置文件」的优先级通过 webpack-merge 来实现配置合并。

同时也可以手动使用 webpack-merge 来合并多个配置文件来实现多环境下相同配置的抽离；

- webpack5 新增的 `extends` 字段内部实现也是 webpack-merge 能力；

```js
const webpack = () => {
  options = { ...defaultOptions, ...options };
};
```

## 2. 验证配置

```js
import schema form './schema';

const webpack = (options) => {
  validateSchema(schema, options);
};
```

`validateSchema` 是 1 个内部由 JSON schema 验证库实现的配置校验函数；
所有版本的 webpack 都有维护 1 个 JSON Schema 定义文件放在全局，类似 1 种声明式的 DSL ，描述了所有合法配置项的类型、结构、枚举值、默认行为等。

`webpack()` 首次执行时，会将这份 JSON Schema 转为 AST 并根据这份 AST 动态生成 1 个校验逻辑集合，并缓存起来，后续直接复用；

- 这里传入配置数组时会多次执行校验环境，但针对 JSON Schema 的编译动作只执行 1 次；

> 这里的 JSON Schema 作为配置规则的唯 1 源头，不止用于在 `validateSchema` 中；
>
> - 在 IDE 中编写 webpack.config.json 时可以通过 `$schema` 字段引用这份 JSON Schema 来生成配置编写提示；
>   - 这里的 `$schema` 和 `@types/webpack` 的类型提示本质是同 1 个能力，区别在于 `$schema` 针对 .json 文件，`@types/webpack` 则针对 .ts 文件；
> - webpack 官方配置文档也是根据这份 JSON Schema 映射生成而不是手动维护的；
> - 第三方库可以利用这份 Schema 在合并时提供类型安全的校验;

webpack 编译 1 次 Schema 通常会耗时 5-20ms ，相较后续若干密集I/O操作在时间消耗上几乎可以忽略不计，
所以 webpack 在发版前没有将这份编译结果保留在 webpack 源码中。

## 3. 创建Compiler

> 「配置信息的整理和校验」并不是 webpack 的责任，责任属于它的上层调用者，比如 webpack-cli 、webpack-dev-server ，
> 若在第 3 方项目中直接引用了 webpack 能力，那配置相关的责任则需要第 3 方自行承担。

配置信息整理完成以后，开始进入 webpack 核心逻辑，执行 `createCompiler` 创建 1 个 Compiler 实例。
注意，这里如果涉及多构建任务时，会转而执行 `createMultiCompiler` 。

- 物料库 和 公共工具包 通常会涉及同时提供多个 bundle 格式的情况：
  - CommonJS 供 Node 环境使用；
  - ES Module 供支持 tree shaking 的打包工具使用；
  - UMD 供浏览器直接引用；
- 在 monorepo 根目录下调用 1 次 Webpack 同时构建多个子包是非常常见的需求；

`MultiCompiler` 的并行实现是依赖 NodeJS 的轮询机制，本质是并发，
由于编译任务多为 I/O 密集型任务，所以可以在宏观上表现出“同时进行”的效果。

```js
const webpack = (options) => {
  const isMultiCompiler = Array.isArray(options);
  if (isMultiCompiler) {
    const compilers = createMultiCompiler(options);
  } else {
    const compiler = createCompiler(options);
  }
};
```

## 4. 标准化配置，处理预设

```js
const createCompiler = () => {
  const options = getNormalizedWebpackOptions(rawOptions);
  applyWebpackOptionsBaseDefaults(options);
};
```

将用户传入的配置（可能含有简写形式、未规范的字段）转换为标准化的内部格式；
填充那些不依赖于模式（mode）的默认值，也就是无论开发模式还是生产模式都通用的默认配置。

这些默认值是在配置校验通过后、编译器实例化之前填充的，确保编译器运行时拥有完整的配置。

## 5. 实例化Compiler

```js
const createCompiler = () => {
  const compiler = new Compiler(options.context);
  compiler.options = options;
};
```

## 6. 注入核心内置插件（如EntryPlugin、NodeEnvironmentPlugin等）

```js
const createCompiler = () => {
  new NodeEnvironmentPlugin().apply(compiler);
};
```

## 7. 现在Compiler有了钩子，开始挂载配置中的插件

```js
const createCompiler = () => {
  if (Array.isArray(options.plugins)) {
    for (const plugin of options.plugins) {
      // 这里才真正调用插件的apply方法！
      if (typeof plugin === "function") {
        plugin.call(compiler, compiler);
      } else {
        plugin.apply(compiler);
      }
    }
  }
};
```

## 8. Compiler 环境准备相关 hooks 执行

```js
const createCompiler = () => {
  compiler.hooks.environment.call();
  compiler.hooks.afterEnvironment.call();
};
```

## 9. 应用所有内置插件（基于配置）

```js
const createCompiler = () => {
  new WebpackOptionsApply().process(options, compiler);
};
```
