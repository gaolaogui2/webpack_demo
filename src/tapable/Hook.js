class Hook {
  _args; // 参数名数组
  _call = null; // 编译后的函数缓存
  taps = []; // 存储注册的回调
  interceptors = []; // 存储拦截器
  constructor(...args) {
    this._args = args;
  }

  intercept(interceptor) {
    this.interceptors.push(interceptor);
  }

  tap(name, fn) {
    this.taps.push({
      name,
      fn,
      type: "sync",
    });
    // 清掉缓存
    this._call = null;
  }

  call(...args) {
    // 懒编译
    if (!this._call) {
      this._call = this._compile();
    }
    return this._call(...args);
  }

  _compile() {
    // 必须由子类实现
    // 这里会把当前所有 tap 硬编码到执行函数体中
    throw new Error("must be generate for sub hook");
  }
}

export { Hook };
