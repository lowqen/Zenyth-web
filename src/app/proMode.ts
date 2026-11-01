import { useSettingsStore } from "../features/settings/settingsStore";

/**
 * 고급 사용자 모드 — 앱 «고급 사용자 모드»(`pro.enabled`, 기본 꺼짐)와 같은 것.
 *
 * 앱에서는 설정의 기존 «고급 설정» 스위치가 이 모드가 됐다. 웹도 같은 저장값(`showAdvanced`)을 그대로 쓴다 —
 * 그래서 이미 고급 설정을 켜 둔 사람은 업데이트 뒤에도 DB 탭 · 엔진 콘솔이 그대로 보이고, 옮길 저장값이 없다.
 *
 * 꺼져 있으면: 레일 · 하단 탭에 DB 가 없고(주소로 열면 화면은 열린다), 엔진 화면은 상태만(콘솔 없음), 설정은
 * 자주 쓰는 설정만(데스크톱 설정 파일 등 고급 줄 없음).
 */
export function useProMode(): boolean {
  return useSettingsStore((s) => s.showAdvanced);
}
