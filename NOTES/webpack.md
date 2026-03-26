# Webpack 提供了完整的 配置 -> 编译 JS&JSON -> 产出 的能力并支持在所有打包节点进行 IOC

```js
import merge form 'webpack-merge'

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
      processAssets
      // ... 更多
    };
  }

  addEntry(){}

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

  // 10. 编译
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

        // 调用compile开始真正的编译
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

  // 5. 实例化Compiler
  const compiler = new Compiler(options.context);
  compiler.options = options;

  // 6. 注入核心内置插件（如EntryPlugin、NodeEnvironmentPlugin等）
  new NodeEnvironmentPlugin().apply(compiler);

  // 7. 现在Compiler有了钩子，开始挂载配置中的插件
  if (Array.isArray(options.plugins)) {
    for (const plugin of options.plugins) {
      if (typeof plugin === "function") {
        plugin.call(compiler, compiler); // 这里才真正调用插件的apply方法！
      } else {
        plugin.apply(compiler);
      }
    }
  }

  // 8. 应用所有内置插件（基于配置）
  new WebpackOptionsApply().process(options, compiler);

  // 8.9 Compiler 环境准备相关 hooks 执行
  compiler.hooks.environment.call();
  compiler.hooks.afterEnvironment.call();

  return compiler;
};

const webpack = (options, callback) => {
  // 1. 合并配置
  options = merge(cliOptions, options);

  // 2. 验证配置
  validateSchema(schema, options);

  // 3. 创建Compiler
  const compiler = createCompiler(options);

  // 9. 立即执行模式：如果传了callback，直接执行
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

## 1. 合并配置

webpack 会根据「CLI 命令行参数 > 用户配置文件」的优先级通过 webpack-merge 来实现配置合并。

同时也可以手动使用 webpack-merge 来合并多个配置文件来实现多环境下相同配置的抽离；

- webpack5 新增的 `extends` 字段内部实现也是 webpack-merge 能力；

```js
import merge form 'webpack-merge'

const webpack = () => {
  options = merge( cliOptions, options );
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

首先会初始化 1 些基础属性：

- 设置 `this.context` 为传入的上下文路径（通常是 `process.cwd()`），作为项目根目录；
  - 是 Compiler 实例的绝对路径根目录，它在整个构建过程中扮演“路径锚点”的角色，后续若干相对路径最终都会会和它对齐；
  - Monorepo 项目下的 MultiCompiler 实例因为需要对应多个不同路径的子应用，需要配置多个 `this.context` 值；

- 设置 `this.name` 等标识属性；
  - 在 MultiCompiler 实例下才需要 `this.name` 字段来在「缓存、日志」等等位置区分应用实例；

- 初始化 `this.options` 为传入的配置（此时配置已经过校验、标准化、默认值填充，是完整配置）；

Compiler 继承自 Tapable，在构造函数中会初始化一系列贯穿构建生命周期的钩子；

初始化 `this.cache` 缓存、`this.resolverFactory` 解析器工厂等内部数据结构；

- `cache` 是配置中用于控制构建缓存行为的字段。Webpack5 引入了持久化缓存，可以将构建结果缓存到硬盘，大幅提升 2 次构建速度。

## 6. 注入核心内置插件（如EntryPlugin、NodeEnvironmentPlugin等）

```js
const createCompiler = () => {
  new NodeEnvironmentPlugin().apply(compiler);
};
```

NodeEnvironmentPlugin 是 Webpack 内置的基础环境插件，负责为 Compiler 注入 Node.js 环境下的文件系统和基础日志能力。

- compiler.inputFileSystem 和 compiler.outputFileSystem 为 Compiler 提供文件读写能力，
  - 后续为了支持用户覆盖这里的逻辑实现自定义，这里没有将其直接塞入 Compiler 内部而是独立作为 plugin 维护；
  - 单一职责：Compiler 负责构建流程编排，文件系统注入作为独立插件，符合插件化架构设计；
- compiler.infrastructureLogger 为 Webpack 内部提供日志输出能力；
- compiler.watchFileSystem 依赖 compiler.inputFileSystem 实现对文件改动的监听；
  - 默认基于 fs.watch ，环境不支持的话会降级为轮询机制，性能会差很多；

> compiler.infrastructureLogger 和 Stats 是 Webpack 中两个完全独立的模块。
>
> - compiler.infrastructureLogger：构建过程的实时日志；
> - Stats：构建结果的汇总报告；

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

依次执行配置文件中的 plugin ，将相关订阅挂载到目标 hook 上；
这里 Plugin 同时支持 Function 和 Class 两种写法，所以在这里要做区别执行；

## 8. 应用所有内置插件（基于配置）

```js
class WebpackOptionsApply {
  process(options, compiler) {
    // 1. 触发环境钩子（基础环境已就绪）
    compiler.hooks.environment.call();
    compiler.hooks.afterEnvironment.call();

    // 2. 根据 target 加载核心插件
    if (options.target === "web") {
      // 模拟：添加 web 环境下的 chunk 加载插件
      const JsonpTemplatePlugin = require("./JsonpTemplatePlugin");
      new JsonpTemplatePlugin().apply(compiler);
    } else if (options.target === "node") {
      const NodeTemplatePlugin = require("./NodeTemplatePlugin");
      new NodeTemplatePlugin().apply(compiler);
    }

    // 3. 处理 entry 配置
    const EntryOptionPlugin = require("./EntryOptionPlugin");
    new EntryOptionPlugin().apply(compiler);
    // 触发 entryOption 钩子，实际会创建 EntryPlugin
    compiler.hooks.entryOption.call(options.context, options.entry);

    // 4. 处理 resolve 配置（简化：直接赋值）
    compiler.resolverFactory.hooks.resolveOptions
      .for("normal")
      .tap("WebpackOptionsApply", (resolveOptions) => {
        return { ...resolveOptions, ...options.resolve };
      });

    // 处理 loader 解析器配置
    compiler.resolverFactory.hooks.resolveOptions
      .for("loader")
      .tap("WebpackOptionsApply", (resolveOptions) => {
        return { ...resolveOptions, ...options.resolveLoader };
      });

    // 5. 处理 module.rules（简化：模拟规则注册）
    if (options.module && options.module.rules) {
      const NormalModule = require("./NormalModule");
      for (const rule of options.module.rules) {
        // 实际会调用 NormalModule 的注册逻辑
        compiler.hooks.compilation.tap("WebpackOptionsApply", (compilation) => {
          compilation.hooks.buildModule.tap("RuleHandler", (module) => {
            // 判断是否命中规则
            if (matches(rule, module)) {
              module.addLoader(rule.use);
            }
          });
        });
      }
    }

    // 6. 根据 devtool 添加 source map 插件
    if (options.devtool) {
      const SourceMapDevToolPlugin = require("./SourceMapDevToolPlugin");
      new SourceMapDevToolPlugin(options.devtool).apply(compiler);
    }

    // 7. 根据 optimization 配置添加优化插件
    if (options.optimization && options.optimization.splitChunks) {
      const SplitChunksPlugin = require("./SplitChunksPlugin");
      new SplitChunksPlugin(options.optimization.splitChunks).apply(compiler);
    }

    if (options.optimization && options.optimization.minimize) {
      const TerserPlugin = require("./TerserPlugin");
      new TerserPlugin().apply(compiler);
    }

    // 8. 处理 externals
    if (options.externals) {
      const ExternalsPlugin = require("./ExternalsPlugin");
      new ExternalsPlugin(options.target, options.externals).apply(compiler);
    }

    // 9. 触发装配完成钩子
    compiler.hooks.afterPlugins.call(compiler);
    compiler.hooks.afterResolvers.call(compiler);
  }
}

const createCompiler = () => {
  new WebpackOptionsApply().process(options, compiler);
};
```

### 8.1 触发环境钩子（基础环境已就绪）

用户的自定义 plugins 挂载完成以后，开始执行 WebpackOptionsApply 来挂载系统内置的 plugins ，

- 首先这里需要依赖系统的读写能力，所以要在 NodeEnvironmentPlugin 后面，
- 同时这里也触发若干钩子，所以用户的自定义 plugins 要在此之前就挂载好，以免被漏掉；

此时所有 静态配置 都已经固定下来，首先会触发 `environment` 相关的钩子：

- 这里分为 `hooks.environment` 和 `hooks.afterEnvironment` 2 个步骤，这种“分步钩子”的设计在 Webpack 中非常常见，是为插件提供可控的执行顺序边界。
- `hooks.environment` 提供给 plugin 最后 1 次对 配置 进行增删改的机会；
- `hooks.afterEnvironment` 在语义上认为环境已最终确定，可以安全地将配置翻译为插件了，只能进行查询；
  - webpack 中所有配置项都对应了相关的 class 来负责实现，
    - `entry` 对应 EntryPlugin，
    - `output` 对应 JsonpTemplatePlugin，NodeTemplatePlugin 等等；

### 8.2 根据 target 加载核心插件

接下来会根据 `options.type` 来确定如何来加载 chunk ，
这里默认值是 `web` ，会选择使用 JsonpTemplatePlugin 来实现；

JsonpTemplatePlugin 会被注册进 Compiler ，待后续 seal 阶段发现有 `import()` 语法出现 LoadScriptRuntimeModule 会被实例化并插入到主 bundle 内，LoadScriptRuntimeModule 的能力是使用 JSONP 的方式动态加载模块；

- 在生成的 HTML 中，通过 `<script>` 标签异步加载额外的 chunk 文件；
- 支持跨域加载、按需加载；
- 处理 chunk 的缓存、重试、并发加载等逻辑；

Webpack 在 Web 环境选择 JSONP 作为 chunk 加载方式，主要是基于浏览器环境的技术限制和性能考量的综合选择。

- 浏览器中常规的 XMLHttpRequest 或 fetch 受同源策略限制。但 `<script>` 标签不受此限制；
  - 浏览器对 `<script>` 标签的加载有成熟的优化机制：
  - 多个 `<script>` 标签会并行下载（受浏览器同域名并发数限制，通常 6-8 个）；
  - 加载后的脚本会被浏览器独立缓存，下次访问相同 chunk 时直接使用缓存；
  - 通过 async 或 defer 属性可以控制执行时机，避免阻塞页面渲染；
- 与浏览器原生缓存机制深度集成，天然支持代码执行隔离与错误边界；

现代浏览器的 ESM 在技术特性上全面优于 JSONP 方案，Webpack 选择 JSONP 为默认加载方式，核心原因是历史包袱，而非技术优劣。

### 8.3 处理 entry 配置

接下来处理入口文件，需要把 EntryOptionPlugin 能力注册进 Compiler ，
它是 1 个必选 plugin 不受条件影响，但这里因为「需要依赖文件读取能力 和 entry 配置的最终结果」所以才拖到 WebpackOptionsApply 阶段才进行引入和挂载，同时将这两个动作放在 1 起也增加了可读性。

### 8.4 处理 resolve 配置（简化：直接赋值）

接下来是将用户配置的 resolve 和 resolveLoader 选项注入到 ResolverFactory 中，从而影响模块解析的行为。

```json
// 常见的 resolve 配置项示例
{
  "resolve": {
    "extensions": [".js", ".jsx", ".ts", ".tsx"],
    "alias": {
      "@components": "/absolute/path/to/src/components",
      "@utils": "/absolute/path/to/src/utils"
    },
    "modules": ["node_modules", "/absolute/path/to/src"],
    "mainFields": ["module", "main"],
    "mainFiles": ["index", "main"],
    "enforceExtension": false,
    "fullySpecified": false
  },
  "resolveLoader": {
    "modules": ["node_modules"],
    "extensions": [".js", ".json"],
    "mainFields": ["loader", "main"],
    "mainFiles": ["index"],
    "symlinks": true,
    "cache": true
  }
}
```

ResolverFactory 是用于创建模块解析器的工厂类。它统 1 管理不同类型解析器的创建逻辑。

Webpack 中需要 3 种解析器：

- normal：解析普通模块（如 import './foo'、import 'lodash'）；
- loader：解析 loader 模块（如 import 'babel-loader'）；
- context：解析上下文模块；

ResolverFactory 通过 get(type, options) 方法返回对应类型的解析器实例。

ResolverFactory 的 normal 解析器会读取 options.resolve 来决定以何种规则与顺序来尝试匹配模块；
ResolverFactory 的 loader 会读取 options.resolveLoader 构建 1 个寻找目标 loader 的工具函数；
options.resolveLoader 在大部分场景下不需要手动配置，预设即可满足需求，除非需要引入项目内自定义 loader（不按照 npm 来引入）；

### 8.5 处理 module.rules（简化：模拟规则注册）

接下来会遍历 options.module.rules 给 compilation.hooks.buildModule 添加包含匹配判断的订阅，

- 注意这里插入的是匹配逻辑，不是匹配结果，因为在模块使用哪些 loader，不仅仅取决于静态配置，还取决于模块的具体内容或运行时信息。
  - 支持在 use 中标记静态的 loader 集合，
  - 支持给 use 传递 1 个函数条件，根据模块内容再做决定；
  - 也支持配置内联 loader ，跳过 module.rules 步骤；
  - 可以理解为这里每 1 匹配判断的订阅都是 1 个处理器；
- 这里 compilation.hooks.buildModule 会跟随每个模块的解析执行 1 次，
  - 然后按照 module.rules 的配置顺序依次尝试匹配，直到首次匹配成功；

### 8.6 根据 devtool 添加 sourceMap 插件

根据用户配置的 devtool 选项，动态添加对应的 Source Map 生成插件。

- 'source-map'：生成独立的 .map 文件；
- 'eval-source-map'：将 Source Map 内联到 eval 执行的代码中，开发时重建速度快；
- 'cheap-module-source-map'：只保留行映射，不包含列信息，提升构建速度；

### 8.7 根据 optimization 配置添加优化插件

Webpack 的核心优化功能完全不需要外部插件，内置全部覆盖；

- 代码分割 SplitChunksPlugin
- 代码压缩 TerserPlugin
- 作用域提升 ModuleConcatenationPlugin

这时会根据 options.optimization 配置来决定挂载哪些 plugin ；

> 1 些特殊格式模块的压缩还需要外部 plugin 来实现，还有 可视化分析 等等；

### 8.8 处理 externals

options.externals 有值时，会添加 ExternalsPlugin 用于在构建过程中排除某些依赖，将其指向外部变量或全局对象。

- 减少 bundle 体积
- 利用 CDN 加速

ExternalsPlugin 会根据 options.target（如 'web'、'node'）和 options.externals 配置，注册相应的钩子来修改模块解析行为：

- 在模块解析阶段，如果模块名匹配 externals 中的键，则返回一个外部变量引用，而非继续解析模块路径
- 根据 target 不同，引用方式也不同：
- web：生成 global.React 或 window.React ，同时需要手动引入相关 CDN ，例如通过 html-webpack-plugin 的 template 来动态添加 CDN 脚本，尤其是在区分开发和生产环境时。

### 8.9 触发装配完成钩子

触发 `compiler.hooks.afterPlugins.call` 和 `compiler.hooks.afterResolvers.call` ；

这里 Resolver 相关的行为早已经结束，afterResolvers 排在 afterPlugins 后执行是为了避免后面挂载的 Plugin 再次对 resolver 配置进行修改；

此时，Compiler 所有准备工作都已经完成；

## 9. Compiler.run 执行

createCompiler 执行完成以后，回到 webpack 函数中，判断当前是否传递了 callback 来决定是否立即执行构建；

webpack-dev-server 是不传 callback 模式最典型的案例。它获取 compiler 实例后，会替换文件系统为内存文件系统，监听到文件改变后要将心内容返回给浏览器。

```js
// 在 webpack-dev-server 内部
const compiler = webpack(config);

// 关键：将 outputFileSystem 替换为内存文件系统
const MemoryFileSystem = require("memory-fs");
compiler.outputFileSystem = new MemoryFileSystem();

// 后续编译的输出不会写入硬盘，而是写入内存
compiler.watch(watchOptions, (err, stats) => {
  // 从内存中读取构建结果，快速响应 HTTP 请求
  const outputPath = compiler.options.output.path;
  const content = compiler.outputFileSystem.readFileSync(outputPath + "/bundle.js");
  // 将内容返回给浏览器
});
```

Compiler.run 并不包含构建逻辑，更多的是象征意义：表示「构建」开始了。

这里会定义最终的 onCompiled 回调，
会触发 `Compiler.hook.beforeRun` 和 `Compiler.hooks.run` 钩子方法；

- beforeRun 适合做破坏性操作（如删除文件），因为编译尚未开始，不会干扰后续流程。
- run 适合做启动性记录，因为它标志着编译即将开始，但还未触及模块。

然后 Compiler.Compile 执行；

## 10. Compiler.Compile 执行

这里会创建 1 个 Compilation 实例，然后触发 Compiler.hooks.make 开始工作。

Compilation 是构建流程中的核心工作单元，它代表 1 次完整的模块构建和资源生成过程，
从它的生命周期中就可以看清它完整的工作步骤：

- `buildModule` 递归触发，构建每个模块；
- `finishModules` 所有模块构建完成；
- `optimize` 相关，优化；
- `processAssets` 生成最终资源，压缩、添加 source map、生成额外文件；

早先 EntryPlugin 相关的 Plugin 针对 Compiler.hooks.make 进行的了订阅，此时会执行相关回调，

- 首先它执行了 compilation.addEntry 生成 入口依赖对象 ，Compilation 会记录这个入口，后续用来 chunk 分组；
- 执行 `_addModuleChain`，调用 `processModuleDependencies` 启动递归：
  - `buildModule` 中识别当前模块所需的 loader 并执行，将模块构建结果与模块路径绑定缓存起来，解析依赖继续向下，
  - 这期间逐步构建 1 个 DAG 依赖图，确保无环；
- 最终 queue 队列被清空掉，`finishModules` 执行；

```js
class Compilation {
  constructor() {
    this.modules = new Map(); // 缓存已构建的模块
    this.queue = []; // 待构建的模块队列
    this.dependencies = new Map(); // 依赖关系记录
  }

  addEntry(entryPath, callback) {
    // 入口模块入队
    this.queue.push({ path: entryPath, parent: null });
    this._processQueue(callback);
  }

  _processQueue(callback) {
    const processNext = () => {
      if (this.queue.length === 0) {
        callback();
        return;
      }

      // 取出下一个待构建的模块
      const { path, parent } = this.queue.shift();

      // 检查缓存，避免重复构建
      if (this.modules.has(path)) {
        // 只记录依赖关系，不重复构建
        if (parent) {
          this._addDependency(parent, path);
        }
        processNext();
        return;
      }

      // 构建模块（模拟）
      this._buildModule(path, (err, dependencies) => {
        if (err) throw err;

        // 缓存模块
        this.modules.set(path, { code: `// content of ${path}` });

        // 记录父模块依赖
        if (parent) {
          this._addDependency(parent, path);
        }

        // 将依赖加入队列（深度优先：立即递归处理第一个依赖）
        // 注意：这里是"递归"处理，而不是一次性加入所有依赖
        this._addDependenciesToQueue(path, dependencies, processNext);
      });
    };

    processNext();
  }

  _buildModule(path, callback) {
    // 模拟读取文件、执行 loader、解析依赖
    console.log(`Building: ${path}`);

    // 模拟解析出的依赖
    const mockDependencies = this._parseDependencies(path);

    setTimeout(() => {
      callback(null, mockDependencies);
    }, 10);
  }

  _parseDependencies(path) {
    // 模拟依赖解析
    const depsMap = {
      "./src/index.js": ["./src/utils/math.js", "./src/components/Button.js"],
      "./src/utils/math.js": [],
      "./src/components/Button.js": ["./src/utils/math.js"],
    };
    return depsMap[path] || [];
  }

  _addDependenciesToQueue(modulePath, dependencies, callback) {
    if (dependencies.length === 0) {
      callback();
      return;
    }

    // 深度优先：取第一个依赖，立即处理（递归）
    const firstDep = dependencies[0];
    const remainingDeps = dependencies.slice(1);

    // 从后往前插入，保持原顺序
    for (let i = dependencies.length - 1; i >= 0; i--) {
      this.queue.unshift({ path: dependencies[i], parent: modulePath });
    }

    // 继续处理队列（会立即处理刚插入的第一个依赖）
    callback();
  }

  _addDependency(parent, child) {
    if (!this.dependencies.has(parent)) {
      this.dependencies.set(parent, []);
    }
    this.dependencies.get(parent).push(child);
  }
}

// 使用示例
const compilation = new Compilation();
compilation.addEntry("./src/index.js", () => {
  console.log("All modules built");
  console.log("Modules:", Array.from(compilation.modules.keys()));
  console.log("Dependencies:", compilation.dependencies);
});
```

## 11. Compilation.seal 执行

Compilation.hooks.finishModules 的回调函数中，Compilation.seal 执行。

seal 阶段被定义为优化阶段，具体的行为有很多，但最主要的步骤按照顺序依次是：

- optimizeDependencies 标记使用的导出（Tree Shaking 标记）
- optimizeChunks 代码分割
- optimizeModules 作用域提升

首先 FlagDependencyUsagePlugin 会遍历模块依赖图，标记哪些导出被实际使用，哪些未被使用，为后续的代码压缩和死代码移除提供依据。这是实现 Tree Shaking 的核心前置。

然后 SplitChunksPlugin 进行代码分割，根据 import 语句、模块的使用频率等等，将有效模块拆分为多个 chunk ；

最后 ModuleConcatenationPlugin 在 chunk 内进行作用域提升，减少运行时的访问开销，也能减少 chunk 的体积；

在 Compilation.seal 的最后，执行 Compilation.hook.processAssets ；

## 12 Compilation.hook.processAssets

这是资源生成的核心钩子，所有对最终输出文件的处理都在这个阶段完成：

- TerserPlugin JS 压缩
- CssMinimizerPlugin CSS 压缩
- SourceMapDevToolPlugin 生成 sourceMap
- HtmlWebpackPlugin 生成 HTML

WebpackOptionsApply 在最后阶段，会读取 options.optimization 配置，据此动态创建和挂载对应的 Plugin 。

### 12.1 TerserPlugin

用来对 JavaScript 文件进行压缩，支持并行处理以提升性能。
它会遍历 compilation.assets，筛选出 JavaScript 文件。
根据配置决定是否创建子进程池，对每个文件调用 `terser.minify()` 生成压缩后的内容，然后进行替换。

- Compilation 内部维护了 1 个类 sourceMap 结构来记录每个模块的脚本细节，`terser.minify()` 更新文件结构后会更新这里；
- 首先，将当前模块内容解析为 AST ，根据配置决定是否去除 空格、换行、注释、日志 等内容；
- 然后针对局部变量替换变量名，注意避免全局冲突；
- 进行 1 些逻辑优化；

### 12.2 CssMinimizerPlugin

### 12.3 SourceMapDevToolPlugin

### 12.4 HtmlWebpackPlugin
