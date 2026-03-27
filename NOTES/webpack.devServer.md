# DevServer 对 Webpack 进行二次封装来实现本地服务和 HMR

```js
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

    // 在这里挂载 middleware
    this.middleware = require("webpack-dev-middleware")(compiler, {
      publicPath: this.compiler.options.output.publicPath,
      // ...
    });

    // 设置 express 使用这个中间件
    this.app.use(this.middleware);
  }

  start() {
    // 这里开始监听
    this.watching = this.compiler.watch(this.watchOptions, (err, stats) => {
      this.sendStats(stats);
    });

    // 启动 express
    this.listen();
  }
}
```
