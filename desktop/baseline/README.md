# 데스크톱 Z0 — 엔진 대화 골든 녹취

zenyth-desktop(Tauri 셸) 계획의 Z0 산출물이다. 계획 전체와 기준선 수치는 gomoku-dev
`test-yixin/docs/Zenyth_데스크톱_리디자인_계획.md`에 있다. 단계 이름 «Z0 · Z1 …»은 이 저장소의
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

| 파일                             | 엔진               | 내용                                                                 |
| -------------------------------- | ------------------ | -------------------------------------------------------------------- |
| `golden/startup-handshake.jsonl` | 로컬 Rapfi 0.43.01 | 기동 핸드셰이크 → DB 조회 3회 → 종료. 4회 녹취에서 보낸 줄이 모두 같았다 |

### 녹취 시나리오 (남은 것)

GUI를 손으로 조작해야 해서 아직 녹취하지 못했다. 위 스크립트로 하나씩 남긴다.

1. `analysis-basic`: 착수 5수, 분석 켜기/끄기, 앞뒤 이동(`yxstop` · `yxboard` · `INFO PV` 흐름)
2. `nbest`: 다중 후보(`yxnbest`)
3. `db-edit`: DB 기록 · 주석 · 칸 글자 · 삭제(`-WithDb` 복사본으로)
4. `review`: 30수 기보 Game Review(`YXNBEST 2` 반복)
5. `prove`: 증명 1회(`yxnbest k` / `YXSEARCHDEFEND`)
6. `server-db`: 원격 서버(`-Engine engine_bak.exe`). 서버가 다시 켜진 뒤에 한다(2026-11-08 기준 Tailscale 오프라인)
