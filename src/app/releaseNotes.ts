import { msg } from "../i18n/i18n";

/**
 * «새로워진 점»의 글(Z8 — 앱 `assets/whatsnew/<versionCode>.txt` 와 같은 모양): 환영 한 문장, 그리고 제목 붙은
 * 짧은 묶음. 사전 열쇠라 그릴 때 `t()` 를 거친다. `release` 가 `firstVisit.ts` 의 `RELEASE` 와 같아야 한다
 * (`firstVisit.test.ts`) — 번호만 올리고 글을 잊는 일이 없게.
 */
export interface ReleaseNotes {
  release: number;
  intro: string;
  groups: readonly { title: string; items: readonly string[] }[];
}

export const RELEASE_NOTES: ReleaseNotes = {
  release: 20261101,
  intro: msg("Zenyth 앱과 같은 모습으로 새로 단장했습니다."),
  groups: [
    {
      title: msg("새 모습"),
      items: [
        msg("보라 강조와 테두리 없는 카드, 큰 제목과 넉넉한 줄"),
        msg("판은 앱과 같은 메이플 나무색, 다크 테마에는 검은 배경도"),
        msg("설정은 목록에서 하위 화면으로, 검색은 모든 항목까지 찾습니다"),
        msg("기본은 다섯 탭입니다. DB 탭은 설정의 고급 사용자 모드에서 켭니다"),
      ],
    },
    {
      title: msg("보드"),
      items: [
        msg("가운데 ▶ 버튼 묶음과 최선수 한 줄 요약"),
        msg("휴대폰에서는 판이 고정되고 카드는 아래 시트로 올라옵니다"),
        msg("형세 그래프를 새로 그렸고, 국면 카드에서 국면 문자열 · 판 이미지를 내보냅니다"),
      ],
    },
    {
      title: msg("연구 · 정석"),
      items: [
        msg("실전 대국 데이터 안내가 오프닝 · 랭킹 맨 위로 왔습니다"),
        msg("코스 카드에 레벨 배지와 진행 막대, 레슨의 살펴보기 · 학습은 미끄러지는 탭"),
      ],
    },
    {
      title: msg("이름"),
      items: [
        msg("RapfiWeb 의 새 이름은 Zenyth Web 입니다. 설정 ▸ 정보에서 둘러보기를 열 수 있습니다"),
      ],
    },
  ],
};
