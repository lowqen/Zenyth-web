import { IS_DESKTOP } from "./platform";
import { provideNativeBridge } from "../../engine/engine-transport";

/**
 * 데스크톱 Z3: 네이티브 엔진 다리의 약속을 **엔진 스토어가 생기기 전에** 끼워 둔다.
 *
 * 엔진 스토어는 만들어지는 순간 능력표(`detectCapabilities` — `native` 칸 포함)를 굳힌다. 그래서 `main.tsx` 는
 * 이 모듈을 설정 스토어(→ 엔진 스토어)보다 **앞서** import 한다. 다리 코드 자체는 동적 import 라 늦게 오지만,
 * 네이티브 기동이 그 약속을 기다린다. 웹에서는 아무것도 하지 않고, 웹 번들은 다리 조각을 받지 않는다.
 */
if (IS_DESKTOP) {
  provideNativeBridge(import("./nativeBridge").then((m) => m.createNativeBridge()));
}
