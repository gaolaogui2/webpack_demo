import { Hook } from "./Hook";
import { SyncHookCodeFactory } from "../factory";

class SyncHook extends Hook {
  constructor(...args) {
    super(...args);
    this._factory = new SyncHookCodeFactory();
  }

  call(...args) {
    this._call(...args);
    return undefined;
  }
  _compile() {
    // 使用自己的 _factory
    return this._factory.create({
      type: "sync",
      taps: this.taps,
      args: this._args,
      interceptors: this.interceptors,
    });
  }
}

export { SyncHook };
