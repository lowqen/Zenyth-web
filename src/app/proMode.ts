import { useSettingsStore } from "../features/settings/settingsStore";

/**
 * 고급 사용자 모드 — 앱 «고급 사용자 모드»(`pro.enabled`, 기본 꺼짐)와 같은 것.
 *
 * 앱에서는 설정의 기존 «고급 설정» 스위치가 이 모드가 됐다. 웹도 같은 저장값(`showAdvanced`)을 그대로 쓴다 —
 * 그래서 이미 고급 설정을 켜 둔 사람은 업데이트 뒤에도 DB 탭 · 콘솔 입력줄이 그대로 보이고, 옮길 저장값이 없다.
 *
 * 꺼져 있으면: 레일 · 하단 탭에 DB 가 없고(주소로 열면 화면은 열린다), 보드 «로그» 칸은 읽기만(콘솔 입력줄 없음 —
 * 라이브러리 계획 §0 «위험한 쓰기만 모드 뒤»), 설정은 자주 쓰는 설정만(데스크톱 설정 파일 등 고급 줄 없음).
 */
export function useProMode(): boolean {
  return useSettingsStore((s) => s.showAdvanced);
}
