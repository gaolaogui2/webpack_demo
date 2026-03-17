import { Hook } from "./Hook";

class SyncHook extends Hook {
  constructor(...args) {
    super(...args);
  }
  _compile() {
    const taps = this.taps;
    const args = this._args;
    const intercepts = this.intercepts;

    let code = `use strict;\n`;
  }
}

export { SyncHook };
