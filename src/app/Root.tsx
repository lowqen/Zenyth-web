import { RouterProvider } from "react-router-dom";
import { useLang } from "../i18n/i18n";
import { router } from "./routes";
import { TourScreen, WelcomeScreen, WhatsNewWindow } from "./Onboarding";

/**
 * 언어가 바뀌면 화면을 뿌리부터 다시 그린다(`key`) — 문구는 그릴 때 `t()` 로 만들어지므로 컴포넌트마다
 * 언어를 구독하지 않아도 된다. 판 · 엔진 · 설정은 React 밖 스토어라 그대로 남는다.
 */
export function Root() {
  const lang = useLang((s) => s.lang);
  return (
    <>
      <RouterProvider key={lang} router={router} />
      {/* Z8: 처음 온 사람의 환영 · 둘러보기 · 새로워진 점 — 셸 밖에서 화면 전체를 덮는다. */}
      <WelcomeScreen />
      <TourScreen />
      <WhatsNewWindow />
    </>
  );
}
