# DevServer 对 Webpack 进行 2 次封装来实现本地服务和 HMR

## webpack-dev-server 是 1 个独立的 CLI 工具

webpack-dev-server 是 1 个独立的 CLI 工具，本质上是 1 个基于 Express 的 Node.js 服务器。

```js
import webpackDevMiddleware from "webpack-dev-middleware";

class WebpackCLI {
  async serve() {
    // 创建 compiler
    const compiler = webpack(options);

    // 创建 Server
    const Server = require("webpack-dev-server");
    const server = new Server(compiler, serveOptions);

    // 启动服务
    await server.start();
  }
}

// webpack-dev-server 内部实现
class Server {
  constructor(compiler, options = {}) {
    this.compiler = compiler;

    // 创建 Express 应用实例
    this.app = express();

    // 在这里挂载 middleware
    this.middleware = require("webpack-dev-middleware")(compiler, {
      publicPath: this.compiler.options.output.publicPath,
    });

    // 设置 express 使用这个中间件
    this.app.use(this.middleware);

    // 挂载其他中间件（如静态文件、路由等）
    this.app.use(express.static("public"));

    // 创建 HTTP 服务器
    this.server = http.createServer(this.app);

    // 创建 WebSocket 服务器（附着在 HTTP 服务器上）
    this.sockServer = new SockJS(this.server, {
      path: "/sockjs-node",
    });
  }

  start() {
    // 这里开始监听
    this.watching = this.compiler.watch(this.watchOptions, (err, stats) => {
      this.sendStats(stats);
    });

    // 启动 HTTP 服务器
    this.server.listen(this.options.port, () => {
      console.log(`Server running on port ${this.options.port}`);
    });
  }

  sendStats(stats) {
    // 通过 WebSocket 发送消息
    this.sockServer.sockets.forEach((socket) => {
      socket.write(
        JSON.stringify({
          type: "hash",
          data: stats.hash,
        })
      );
      // 或
      socket.write(
        JSON.stringify({
          type: "ok",
        })
      );
    });
  }
}
```

可以视 webpack-dev-server 为 1 个调度层：

- WebSocket 通信由 webpack-dev-server 负责；
- 但「编译能力、文件存储、状态感知」全部委托给 webpack-dev-middleware 来实现；

## webpack-dev-middleware 本质是 1 个 Express/Koa 中间件

webpack-dev-middleware 是连接 webpack 和 webpack-dev-server 的核心桥梁，本质是 1 个 Express/Koa 中间件。

webpack-dev-middleware 是 webpack 的“编译能力适配器”，它将 webpack 从命令行工具适配为可嵌入 Node.js 服务的中间件，为 WDS 提供了内存存储、增量监听和状态通知三大核心能力。

核心职责：

- 文件系统劫持：通过 IoC 的方式将 webpack 的 `outputFileSystem` 替换为 `MemoryFileSystem`，所有编译产物直接写入内存；
- 监听与触发：调用 `webpack.watch()` 开启文件监听，并在编译完成后触发回；
- 请求拦截：拦截浏览器对静态资源的请求，从内存文件系统中读取对应文件并返；
- 状态传递：将编译状态（hash、编译完成等）传递给 WDS，供其通过 WebSocket 通知浏览器；

```js
// 1. 替换文件系统
compiler.outputFileSystem = new MemoryFileSystem();

// 2. 启动 watch
const watching = compiler.watch({}, (err, stats) => {
  // 编译完成，通知 WDS
  context.state = true;
  context.stats = stats;

  // 触发回调，WDS 借此发送 hash 和 ok
  context.callbacks.forEach((cb) => cb(stats));
});

// 3. 作为中间件挂载
app.use(middleware);
// 浏览器请求 /main.js 时，从内存中读取返回
```

## 开发环境下 HMR 动作的完整流程

开发环境下 HMR 动作的完整流程：

1. 编译阶段

- WDS 内部调用 webpack 的能力对应用进行全量编译；
- 通过 webpack-dev-middleware 以 IoC 形式替换 webpack 的 outputFileSystem，将输出产物写入内存而非磁盘，提升后续增量编译的读写效率；

2. 服务与通信建立

- WDS 启动 1 个 Node.js 服务，将 webpack 的编译结果作为静态资源提供给浏览器；
- 同时与浏览器建立 WebSocket 长连接，用于实时推送状态消息；

3. 监听与增量构建

- 通过 webpack-dev-middleware 调用 webpack 的 .watch() 能力，监听项目文件变化；
- 文件变动后触发增量编译，生成描述更新内容的 manifest（包含更新的 chunkId 和新 chunk 的 hash），以及本次编译的全量项目 hash ；

4. 通知与拉取更新

- hash 优先：全量项目 hash 生成后立即通过 WebSocket 推送给浏览器；
- ok 信号：待所有增量内容编译完成、内存文件系统就绪后，再通过 WebSocket 发送 ok ；
- 浏览器收到 ok 后，根据最近 1 次收到的 hash，发起 HTTP 请求获取对应的 manifest ；
- 根据 manifest 中的更新清单，通过 JSONP 方式请求对应的 [chunkId].[hash].hot-update.js 文件

5. 热更新执行

- JSONP 文件加载后立即执行内部的 webpackHotUpdate 函数，将新模块注册到 webpack 运行时；
- HMR runtime 调用 hotApply 完成模块替换，执行模块的 accept 回调，完成热更新；

6. 高频变更处理

- 若在浏览器 HMR 执行期间收到新的 hash 或 ok 消息，会暂存最新的 hash
- 待本次 HMR 完成后，自动根据暂存的最新 hash 触发下一次 HMR，确保最终状态与最新代码一致

好的！让我用**具体的场景和时间线**来重新梳理，加上详细的注解。

### 示例

#### 场景设定

假设你的项目结构：

```javascript
// src/index.js
import { add } from "./utils.js";

console.log(add(1, 2));

if (module.hot) {
  module.hot.accept("./utils.js", () => {
    console.log("utils.js 更新了！");
    console.log("新的结果：", add(1, 2));
  });
}

// src/utils.js
export function add(a, b) {
  return a + b;
}
```

---

#### 第一阶段：编译时（你运行 `npm run dev`）

##### 步骤 1：webpack-dev-server 启动

```javascript
// webpack-dev-server 内部
class Server {
  constructor() {
    // 因为你在 webpack.config.js 中设置了 devServer.hot: true
    if (options.hot) {
      // WDS 自动添加 HotModuleReplacementPlugin
      compiler.options.plugins.push(new webpack.HotModuleReplacementPlugin());

      // WDS 自动添加自己的客户端（用于 WebSocket 通信）
      compiler.options.entry = [
        "webpack-dev-server/client/index.js", // ① 通信层
        "./src/index.js", // ② 你的业务入口
      ];
    }
  }
}
```

#### 步骤 2：HotModuleReplacementPlugin 开始工作

```javascript
// webpack/lib/HotModuleReplacementPlugin.js
class HotModuleReplacementPlugin {
  apply(compiler) {
    // 插件会在编译时注册各种钩子
    compiler.hooks.compilation.tap("HMR", (compilation) => {
      // ========== 注入点 1: 包裹模块 ==========
      compilation.hooks.moduleCodeGeneration.tap("HMR", (module, codeGen) => {
        // 每个模块被编译时，都会经过这个钩子
        // 比如当前正在编译 utils.js 模块

        const moduleId = module.id; // './src/utils.js'
        const originalCode = codeGen.source; // export function add(a,b){return a+b}

        // 返回包裹后的代码
        return `
          // ===== HMR 包裹开始 =====
          if (module.hot) {
            // 注册模块ID到HMR系统
            module.hot.register(${JSON.stringify(moduleId)});
          }
          
          // ===== 你的原始代码 =====
          ${originalCode}
          
          // ===== HMR 包裹结束 =====
          if (module.hot) {
            // 标记模块已就绪
            module.hot.ready(${JSON.stringify(moduleId)});
          }
        `;
      });

      // ========== 注入点 2: 注入 HMR Runtime ==========
      compilation.hooks.runtimeRequirementInModule.tap("HMR", () => {
        // 在 bundle 末尾添加 HMR 运行时
        // 这段代码会在页面加载时执行
      });

      // ========== 注入点 3: 提供 module.hot API ==========
      compilation.hooks.runtimeModule.tap("HMR", (module) => {
        // 定义 module.hot 对象的具体实现
        // 让业务代码可以调用 module.hot.accept()
      });
    });
  }
}
```

##### 步骤 3：编译结果（bundle.js 中包含什么）

```javascript
// ==========================================
// 第一部分：WDS 客户端（WebSocket 通信层）
// ==========================================
(function () {
  // webpack-dev-server/client/index.js
  const socket = new WebSocket("ws://localhost:8080/ws");

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === "hash") {
      // 收到新版本号，记录但不触发更新
      window.__HMR_HASH__ = msg.data;
    } else if (msg.type === "ok") {
      // 收到 ok 信号，触发 HMR 检查
      if (window.__HMR_RUNTIME__) {
        window.__HMR_RUNTIME__.check();
      }
    }
  };
})();

// ==========================================
// 第二部分：HMR Runtime（核心更新逻辑）
// ==========================================
(function () {
  // 创建 HMR 运行时对象
  const HMRRuntime = {
    currentHash: null, // 当前运行版本的 hash
    checking: false, // 是否正在检查更新

    // 检查更新
    check() {
      if (this.checking) return;
      this.checking = true;

      // 请求 manifest 文件
      fetch(`/${this.currentHash}.hot-update.json`)
        .then((res) => res.json())
        .then((manifest) => {
          // 下载需要更新的 chunk
          return this.downloadUpdates(manifest.c);
        })
        .then(() => {
          // 应用更新
          return this.apply();
        })
        .then(() => {
          this.checking = false;
        });
    },

    // 下载更新 chunk
    downloadUpdates(chunks) {
      const promises = [];
      for (let chunkId in chunks) {
        if (chunks[chunkId]) {
          // 通过 JSONP 方式下载
          promises.push(
            new Promise((resolve) => {
              const script = document.createElement("script");
              script.src = `/${chunkId}.${this.currentHash}.hot-update.js`;
              script.onload = resolve;
              document.head.appendChild(script);
            })
          );
        }
      }
      return Promise.all(promises);
    },

    // 应用更新
    apply() {
      // 找出需要更新的模块
      // 调用 module.hot.accept 注册的回调
      // ...（具体实现）
    },
  };

  // 挂载到全局，供 WDS 客户端调用
  window.__HMR_RUNTIME__ = HMRRuntime;

  // 定义 JSONP 回调函数
  window.webpackHotUpdate = (chunkId, moreModules) => {
    // 将新模块注册到 webpack 的模块缓存中
    Object.assign(__webpack_require__.c, moreModules);
  };
})();

// ==========================================
// 第三部分：你的业务代码（被包裹过的）
// ==========================================
(function () {
  // 模块 ./src/utils.js
  // ===== HMR 包裹开始 =====
  if (module.hot) {
    module.hot.register("./src/utils.js");
  }

  // ===== 你的原始代码 =====
  function add(a, b) {
    return a + b;
  }
  module.exports = { add };

  // ===== HMR 包裹结束 =====
  if (module.hot) {
    module.hot.ready("./src/utils.js");
  }
})();

(function () {
  // 模块 ./src/index.js
  const { add } = __webpack_require__("./src/utils.js");

  console.log(add(1, 2));

  // ===== 你的 HMR 代码 =====
  if (module.hot) {
    // 这个 accept 方法来自 HMR Runtime 注入的 module.hot 对象
    module.hot.accept("./src/utils.js", () => {
      // 当 utils.js 更新时，这个回调会被执行
      console.log("utils.js 更新了！");
      // 注意：这里需要重新 require，才能拿到新模块
      const newUtils = __webpack_require__("./src/utils.js");
      console.log("新的结果：", newUtils.add(1, 2));
    });
  }
})();

// ==========================================
// 第四部分：module.hot API 的具体实现
// ==========================================
// 这个对象会被注入到每个模块的 module.hot 属性中
Object.defineProperty(module, "hot", {
  get() {
    return {
      register: (moduleId) => {
        // 注册模块 ID 到 HMR 系统
        console.log(`模块 ${moduleId} 已注册到 HMR`);
      },
      ready: (moduleId) => {
        // 标记模块已就绪
        console.log(`模块 ${moduleId} 已就绪`);
      },
      accept: (dependencies, callback) => {
        // 存储 accept 回调
        // 当依赖的模块更新时，会调用这个回调
        console.log(`注册了 ${dependencies} 的更新回调`);

        // 实际实现中会保存到 HMRRuntime 中
        HMRRuntime.acceptCallbacks[dependencies] = callback;
      },
    };
  },
});
```

#### 第二阶段：运行时（页面加载完成）

##### 当前状态

```javascript
// 浏览器中运行着 bundle.js
// 页面正常显示：console.log 输出 "3"
// HMR Runtime 和 WebSocket 连接都已就绪
// currentHash = 'abc123'（初始版本）
```

---

#### 第三阶段：修改了 utils.js

##### 时间线 T0：保存文件

```javascript
// 将 utils.js 修改为：
export function add(a, b) {
  return a + b + 10; // 新增 +10
}
```

##### 时间线 T1：webpack 增量编译

```javascript
// webpack 检测到文件变化
// 重新编译 utils.js 模块
// 生成新的 hash: 'def456'
// 生成更新文件：
//   - def456.hot-update.json (manifest)
//   - main.def456.hot-update.js (更新补丁)
```

##### 时间线 T2：WDS 发送 WebSocket 消息

```javascript
// WDS 通过 WebSocket 发送消息
socket.send(
  JSON.stringify({
    type: "hash",
    data: "def456", // 新版本号
  })
);

// 稍后（等内存文件系统就绪）
socket.send(
  JSON.stringify({
    type: "ok", // 可以请求更新了
  })
);
```

##### 时间线 T3：浏览器收到消息

```javascript
// WDS 客户端（bundle 中的第一部分）收到消息
socket.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "hash") {
    // 记录新版本号，但先不更新
    window.__HMR_HASH__ = "def456";
    console.log("收到新版本: def456");
  } else if (msg.type === "ok") {
    console.log("收到 ok 信号，开始检查更新");
    // 触发 HMR 检查
    window.__HMR_RUNTIME__.check();
  }
};
```

##### 时间线 T4：HMR Runtime.check() 执行

```javascript
// HMR Runtime 的 check 方法
check() {
  console.log('开始检查更新，当前版本:', this.currentHash);  // abc123

  // 请求 manifest
  fetch('/def456.hot-update.json')
    .then(res => res.json())
    .then(manifest => {
      console.log('收到 manifest:', manifest);
      // manifest 内容：
      // {
      //   "h": "def456",           // 新版本号
      //   "c": { "main": true }    // main chunk 需要更新
      // }

      // 下载更新 chunk
      return this.downloadUpdates(manifest.c);
    })
    .then(() => {
      // 所有补丁下载完成，开始应用
      return this.apply();
    });
}
```

##### 时间线 T5：下载 JSONP 补丁

```javascript
downloadUpdates(chunks) {
  // chunks = { "main": true }
  // 创建 script 标签下载补丁
  const script = document.createElement('script');
  script.src = '/main.def456.hot-update.js';
  document.head.appendChild(script);

  // main.def456.hot-update.js 的内容：
  window.webpackHotUpdate('main', {
    './src/utils.js': function(module, exports) {
      // 这是更新后的 utils.js 代码
      function add(a, b) {
        return a + b + 10;  // 新版本
      }
      exports.add = add;
    }
  });
}
```

##### 时间线 T6：JSONP 执行，注册新模块

```javascript
// main.def456.hot-update.js 加载后立即执行
// 调用 webpackHotUpdate 函数
window.webpackHotUpdate = (chunkId, moreModules) => {
  console.log("注册新模块:", Object.keys(moreModules)); // ['./src/utils.js']

  // 将新模块代码覆盖到 webpack 的模块缓存中
  // __webpack_require__.c 是模块缓存对象
  Object.assign(__webpack_require__.c, moreModules);

  // 此时，旧的 utils.js 模块已被新模块替换
  // 但页面还在使用旧的结果（因为模块还没重新执行）
};
```

##### 时间线 T7：HMR Runtime.apply() 执行

```javascript
apply() {
  console.log('开始应用更新');

  // 找出哪些模块更新了
  const updatedModules = ['./src/utils.js'];

  // 找出哪些模块依赖了这些更新的模块
  // 通过编译时记录的依赖关系图
  const dependentModules = ['./src/index.js'];  // index.js 依赖了 utils.js

  // 对每个依赖模块，检查是否有 accept 回调
  dependentModules.forEach(moduleId => {
    // 查找这个模块注册的 accept 回调
    const callback = this.acceptCallbacks[moduleId];
    if (callback) {
      // 调用回调，传入更新的依赖模块
      console.log(`执行 ${moduleId} 的 accept 回调`);
      callback(updatedModules);
    }
  });
}
```

##### 时间线 T8：accept 回调被执行

```javascript
// 在 ./src/index.js 中，你注册的回调
module.hot.accept("./src/utils.js", () => {
  // 这里被执行了！
  console.log("utils.js 更新了！");

  // 重新 require，获取新模块
  const newUtils = __webpack_require__("./src/utils.js");
  console.log("新的结果：", newUtils.add(1, 2)); // 输出 13
});

// 控制台输出：
// utils.js 更新了！
// 新的结果：13
```
