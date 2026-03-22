class HookCodeFactory {
  constructor() {
    this.options = null;
    this._args = null;
  }

  create(options) {
    this.init(options);

    let fn;
    switch (this.options.type) {
      case "sync":
        fn = new Function(this.args(), this.header() + this.content());
        break;
      case "async":
        fn = new Function(
          this.args({ after: "_callback" }),
          this.header() + this.contentWithCallback(),
        );
        break;
      case "promise":
        fn = new Function(
          this.args(),
          this.header() + this.contentWithPromise(),
        );
        break;
    }

    // 重置状态
    this.options = null;
    return fn;
  }

  init(options) {
    this.options = options;
    this._args = options.args || [];
  }

  // 生成参数列表字符串
  args({ before, after } = {}) {
    let allArgs = this._args;
    if (before) allArgs = [before, ...allArgs];
    if (after) allArgs = [...allArgs, after];
    return allArgs.join(", ");
  }

  // 生成函数头部（拦截器、变量声明等）
  header() {
    let code = "";

    // 如果有拦截器，生成拦截器相关代码
    if (this.options.interceptors.length > 0) {
      code += "var _interceptors = this.interceptors;\n";
      code += this.getCallInterceptorCode();
    }

    // 获取所有回调函数
    code += `var _x = this._x = [${this.options.taps.map((t) => "fn").join(", ")}];\n`;

    return code;
  }

  // 生成 call 拦截器代码
  // 因为「拦截器」在设计上支持在运行时动态追加，所以在运行前无法确定具体的 intercept 的数量，这里就保留了有限的遍历
  getCallInterceptorCode() {
    const args = this.args();
    return `
      for (var _i = 0; _i < _interceptors.length; _i++) {
        var _interceptor = _interceptors[_i];
        if (_interceptor.call) {
          _interceptor.call(${args});
        }
      }
    `;
  }

  // 生成 tap 拦截器代码
  getTapInterceptorCode(tapIndex) {
    return `
      for (var _i = 0; _i < _interceptors.length; _i++) {
        var _interceptor = _interceptors[_i];
        if (_interceptor.tap) {
          _interceptor.tap(_x[${tapIndex}]);
        }
      }
    `;
  }

  // 串行调用所有 taps（同步钩子用）
  callTapsSeries() {
    let code = "";
    for (let i = 0; i < this.options.taps.length; i++) {
      // 添加 tap 拦截器
      if (this.options.interceptors.length > 0) {
        code += this.getTapInterceptorCode(i);
      }

      // 调用当前 tap
      code += `var _fn${i} = _x[${i}];\n`;
      code += `_fn${i}(${this.args()});\n`;
    }
    return code;
  }

  // 熔断式调用（SyncBailHook用）
  callTapsBail() {
    let code = "";
    for (let i = 0; i < this.options.taps.length; i++) {
      if (this.options.interceptors.length > 0) {
        code += this.getTapInterceptorCode(i);
      }

      code += `var _fn${i} = _x[${i}];\n`;
      code += `var _result${i} = _fn${i}(${this.args()});\n`;
      code += `if (_result${i} !== undefined) return _result${i};\n`;
    }
    return code;
  }

  // 瀑布式调用（SyncWaterfallHook用）
  callTapsWaterfall() {
    const args = this.args();
    let code = "";

    for (let i = 0; i < this.options.taps.length; i++) {
      if (this.options.interceptors.length > 0) {
        code += this.getTapInterceptorCode(i);
      }

      code += `var _fn${i} = _x[${i}];\n`;

      if (i === 0) {
        code += `var _result = _fn${i}(${args});\n`;
      } else {
        code += `_result = _fn${i}(_result);\n`;
      }
    }

    code += "return _result;\n";
    return code;
  }

  // 带回调的串行调用（AsyncSeriesHook用）
  callTapsSeriesWithCallback() {
    let code = "var _counter = " + this.options.taps.length + ";\n";
    code += "var _done = function() {\n";
    code += "  _callback();\n";
    code += "};\n";

    for (let i = this.options.taps.length - 1; i >= 0; i--) {
      if (this.options.interceptors.length > 0) {
        code += this.getTapInterceptorCode(i);
      }

      code += `var _fn${i} = _x[${i}];\n`;
      if (i === this.options.taps.length - 1) {
        code += `_fn${i}(${this.args()}, _done);\n`;
      } else {
        code += `_fn${i}(${this.args()}, function() {\n`;
      }
    }

    // 补全闭包括号
    for (let i = 1; i < this.options.taps.length; i++) {
      code += "});\n";
    }

    return code;
  }

  // 抽象方法，子类必须实现
  content() {
    throw new Error("Not implemented");
  }

  // 异步钩子用的回调风格
  contentWithCallback() {
    return this.callTapsSeriesWithCallback();
  }

  // Promise 钩子用的风格
  contentWithPromise() {
    // 简化的 Promise 版本
    return "return Promise.resolve().then(() => {\n" + this.content() + "});\n";
  }
}

export { HookCodeFactory };
