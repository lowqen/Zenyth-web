import { create } from "zustand";

/**
 * 직접 복사하게 보여 주는 시트 — 앱 `ZenythSheet`(P4: 입력형 대화상자를 시트로)를 옮긴 것.
 *
 * 클립보드를 쓸 수 없는 곳(보안 맥락이 아닌 주소 · 권한 거부)에서 링크 · 국면 문자열을 보여 줄 때 쓴다.
 * 예전에는 `window.prompt` 였다 — 브라우저 기본 상자라 다크 테마에서 흰 상자로 튀고, 휴대폰에서는
 * 화면 가운데에서 키보드에 밀렸다. 시트는 아래에서 올라오고 글은 고른 채로 열린다.
 *
 * 모양은 앱과 같다: 손잡이 · 제목 · 내용 · 오른쪽 끝의 단추([닫기] 다음 [복사]). 무엇을 정하는 물음(지우기 ·
 * 덮어쓰기)은 앱처럼 시트가 아니라 화면을 멈추는 상자(`ConfirmBox`)로 남는다.
 */
type CopySheetState = {
  open: { title: string; text: string } | null;
  show: (title: string, text: string) => void;
  close: () => void;
};

export const useCopySheet = create<CopySheetState>((set) => ({
  open: null,
  show: (title, text) => set({ open: { title, text } }),
  close: () => set({ open: null }),
}));

/**
 * 클립보드에 넣고, 안 되면 시트로 보여 준다. 넣었으면 `true`.
 */
export async function copyOrShow(text: string, title: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    useCopySheet.getState().show(title, text);
    return false;
  }
}
