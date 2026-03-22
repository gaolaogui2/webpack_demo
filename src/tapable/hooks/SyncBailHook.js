import { Hook } from "./Hook";
import {} from "../factory";

class SyncBailHook extends Hook {
  constructor(...args) {
    super(...args);
    this._factory = new SyncHookCodeFactory();
  }

  call(...args) {}

  _compile() {
    return this._factory.create({
      type: "sync-bail",
      args: this._args,
      taps: this.taps,
      interceptors: this.interceptors, // 支持拦截器
    });
  }
}

export { SyncBailHook };
