import { HookCodeFactory } from "./Factory";

class SyncHookCodeFactory extends HookCodeFactory {
  content() {
    return this.callTapsSeries(); // 生成顺序执行的代码
  }
}

export { SyncHookCodeFactory };
