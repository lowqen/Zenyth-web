# 데스크톱 Z0 — 엔진 대화 골든 녹취

zenyth-desktop(Tauri 셸) 계획의 Z0 산출물이다. 결정 · 구조 · 기준선 수치는 gomoku-dev
`test-yixin/docs/개발_핸드북.md` §14(옛 계획서를 병합)에 있다. 단계 이름 «Z0 · Z1 …»은 이 저장소의
UI 개편 Z1 · Z2 · Z9와 다른 단계다. 그래서 코드 주석에서는 «데스크톱 Z1»처럼 쓴다.

## 왜 녹취하나

Z3에서 엔진 연결부를 `EngineTransport`로 나누고 네이티브 · 원격 엔진을 붙인다. 이때 지금의 데스크톱(Yixin.exe)이
엔진과 주고받는 줄을 그대로 재생해서, 새 전송 계층이 같은 상태 전이와 같은 화면 값을 내는지 확인한다.
특히 비동기 응답 페어링(`dbqueryseq`/`dbdoneseq`, 핸드북 불변 규칙 2)은 녹취 없이는 검증할 방법이 없다.

## 형식 (`golden/*.jsonl`)

한 줄이 하나의 사건이다.

```json
{ "t": 121, "dir": "gui>eng", "line": "START 15" }
```

| `dir`     | 뜻                                                  |
| --------- | --------------------------------------------------- |
| `gui>eng` | Yixin.exe가 엔진에 보낸 줄(녹취기가 받은 시각)      |
| `eng>gui` | 엔진이 보낸 줄                                      |
| `eng!err` | 엔진 stderr                                         |
| `exit`    | 엔진 종료 코드                                      |
| `note`    | 녹취기 자신의 기록(골든에 넣을 때는 지운다)         |

`t`는 녹취기 기동부터 잰 ms다. 재생 시험은 **순서**를 기준으로 삼고 시각은 지연 주입(VPN 흉내)의 참고값으로만 쓴다.

## 녹취기 (`recorder/`)

- `Tee.cs`는 GUI와 실제 엔진(`rapfi-real.exe`) 사이에 끼어 모든 줄을 남긴다. Windows에 기본으로 들어 있는
  .NET Framework `csc`로 빌드하므로 따로 설치할 것이 없다.
- GLib `gspawn`은 msvcrt `_spawnv`로 엔진을 띄운다. 그래서 파이프가 `STARTUPINFO.lpReserved2`(CRT fd 표)로만
  넘어오고, .NET의 `Console.OpenStandardInput()`은 이 파이프를 보지 못한다. `Tee.cs`가 그 표를 직접 읽는 이유다.
  Z3의 Rust 사이드카가 Yixin.exe 밑에서 시험될 일이 생기면 같은 함정을 만난다.
- `record.ps1`은 배포 폴더를 임시 복제본으로 옮기고 녹취기를 끼운 뒤 Yixin.exe를 띄운다. 운영 폴더와 운영
  DB는 건드리지 않는다.

```powershell
powershell -ExecutionPolicy Bypass -File desktop/baseline/recorder/record.ps1 -Name analysis-basic
powershell -ExecutionPolicy Bypass -File desktop/baseline/recorder/record.ps1 -Name server-db -Engine engine_bak.exe -WithDb
```

`engine.exe`는 로컬 Rapfi이고, `engine_bak.exe`는 Tailscale 서버 프록시다.

## 녹취 현황

| 파일 | 엔진 | 내용 |
| --- | --- | --- |
| `golden/startup-handshake.jsonl` | 로컬 Rapfi 0.43.01 | 기동 핸드셰이크 → DB 조회 3회 → 종료. 4회 녹취에서 보낸 줄이 모두 같았다 |
| `golden/analysis-basic.jsonl` | 로컬 Rapfi 0.43.01 | 5~6수 착수 · 분석 켜고 끄기 · 앞뒤 이동 · 분석 중 무르기(`yxstop` 3회) — 192초 |
| `golden/nbest.jsonl` | 로컬 Rapfi 0.43.01 | `yxnbest` 2회(3후보 · 2후보)와 `MESSAGE (k)` 후보 줄 — 96초 |
| `golden/db-edit.jsonl` | 로컬 Rapfi 0.43.01 | DB 복사본: 주석(`yxedittextdatabase`) · 주석 조회 · 한 칸 삭제 · 저장 — 73초. 칸 글자 · 값 편집은 빠졌다 |
| `golden/review.jsonl` | 로컬 Rapfi 0.43.01 | 19수 기보 게임 리뷰, 수당 1초(`yxnbest 2` 18회) — 90초 |
| `golden/prove.jsonl` | 로컬 Rapfi 0.43.01 | 국면 증명 1노드(`yxquerydatabaseone` → `yxnbest 1` → `yxedittvddatabase`) — 68초 |

녹취에서 확인한 사실(재생 시험이 고정해야 할 것):

- **DB 주석 응답은 여러 줄일 수 있다.** 따옴표 안의 줄바꿈이 그대로 와서 `MESSAGE DATABASE TEXT "…` 다음 줄이
  `MESSAGE` 머리 없이 이어진다(`db-edit`). 콘솔 `dbeditcomment` 경로는 명령 끝의 줄바꿈까지 주석에 넣어 보내고,
  엔진은 그 뒤에 NUL 한 바이트(`\u0000`)를 붙여 돌려준다. 웹 `engine-worker.ts`의 이어 붙이기가 이미 이것을
  처리한다 — 네이티브 전송도 같은 줄 조립을 거쳐야 한다.
- **Yixin.exe는 국면을 보낼 때마다 `start 15`를 다시 보낸다**(`review`에서 30회 중 29회가 바로 `yxboard` 앞).
  엔진은 매번 `OK`로 답한다. zenyth-desktop은 규칙 · 크기가 바뀔 때만 보낸다.
- 모든 녹취 첫머리에 `ERROR Failed to allocate 8388608 KB for transposition table.` — `config.toml`의 8GB 해시가
  RAM 3.8GB 기기에서 실패한다(엔진은 물러서서 계속 돈다).

### 남은 녹취

- `server-db`: 원격 서버(`-Engine engine_bak.exe`). 서버가 다시 켜진 뒤에 한다(2026-11-08 기준 Tailscale 오프라인).
- (선택) 칸 글자 · 값 편집: `dbeditlabel h9 A` · `dbeditval 100`이 `db-edit`에서 빠졌다.
