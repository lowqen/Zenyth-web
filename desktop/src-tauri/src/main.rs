//! zenyth-desktop 셸(데스크톱 Z2).
//!
//! 이 프로세스가 하는 일은 창과 운영체제 사이의 것뿐이다 — 화면 · 판 · 엔진은 모두 웹(dist/)이 한다.
//! - 단일 인스턴스: 두 번째 실행은 기존 창을 앞으로 부르고, 넘겨받은 기보 파일을 그 창에 건넨다.
//! - 창 상태 기억(크기 · 위치 · 최대화). 보이기는 웹이 첫 화면을 그린 뒤에 한다(흰 화면 깜박임 방지).
//! - 파일 연결(.psq · .sav · .pos): 명령줄로 받은 파일을 읽어 웹에 넘긴다. 해석은 웹의 `openGameFile` 한 곳이다.
//!
//! - 네이티브 엔진(데스크톱 Z3): 로컬 Rapfi 프로세스 · 원격 TCP 세션 — `engine.rs`.
//! - settings.txt · settings_dev.txt 직접 읽기 · 쓰기(데스크톱 Z4) — `settings.rs`.
//! - 기동 시각 기록 `boot_marks`(데스크톱 Z6) — `scripts/perf-shell.ts` 가 읽는다.
//! - 자동 업데이트(데스크톱 Z7): `tauri-plugin-updater` — 확인 · 설치는 웹(`src/app/desktop/updater.ts`)이 부른다.
//!   설치판(NSIS)을 띄우기 직전에 엔진 프로세스를 닫는다 — 살아 있으면 `engine/` 의 exe 를 덮어쓰지 못한다.
//!   포터블판(zip, 셸 옆 `portable.txt`)은 `is_portable` 로 알리고, 웹이 설치 대신 안내만 한다.
//!
//! 타이틀바 · 단축키는 웹 쪽(`src/app/desktop/`)에 있다.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;
mod settings;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_window_state::StateFlags;

/// 웹 `core/model/game-file.ts` 의 `GAME_FILE_FORMATS` 와 같은 목록.
const GAME_EXTS: [&str; 3] = ["psq", "sav", "pos"];
/// 기보는 수 KB 다. 이보다 큰 파일은 기보가 아니므로 읽지 않는다(잘못 연결된 큰 파일로 웹뷰를 막지 않게).
const MAX_GAME_FILE: u64 = 1 << 20;
/// 웹이 끝내 `show` 를 부르지 못해도(번들 오류 등) 창은 뜬다 — 빈 창이라도 닫을 수 있어야 한다.
const SHOW_FALLBACK: Duration = Duration::from_secs(5);

const MAIN: &str = "main";
const OPEN_FILES_EVENT: &str = "desktop://open-files";

#[derive(Clone, Serialize)]
struct OpenFile {
    name: String,
    bytes: Vec<u8>,
}

/// 기동 시각 기록(데스크톱 Z6) — `main` 진입을 0 으로 한 밀리초. 웹의 성능 측정(scripts/perf.ts · 계획서 §9.10)이
/// `boot_marks` 로 읽어 «프로세스 → 셸 준비 → 웹 내비 시작 → 창 표시»를 나눠 본다.
static BOOT: OnceLock<(Instant, u64)> = OnceLock::new();

#[derive(Default)]
struct BootMarks(Mutex<Vec<(String, u64)>>);

#[derive(Serialize)]
struct BootReport {
    /// `main` 진입 시각(유닉스 밀리초) — 웹 `performance.timeOrigin` 과 맞대 본다.
    main_epoch_ms: u64,
    marks: Vec<(String, u64)>,
}

fn mark(app: &AppHandle, name: &str) {
    let Some((t0, _)) = BOOT.get() else { return };
    let ms = t0.elapsed().as_millis() as u64;
    if let Some(m) = app.try_state::<BootMarks>() {
        m.0.lock().unwrap_or_else(|e| e.into_inner()).push((name.to_owned(), ms));
    }
}

#[tauri::command]
fn boot_marks(marks: tauri::State<'_, BootMarks>) -> BootReport {
    BootReport {
        main_epoch_ms: BOOT.get().map(|b| b.1).unwrap_or(0),
        marks: marks.0.lock().unwrap_or_else(|e| e.into_inner()).clone(),
    }
}

/// 첫 실행의 명령줄 파일 — 웹이 준비되면 `take_open_files` 로 가져간다(이벤트는 듣기 전에 지나가 버린다).
#[derive(Default)]
struct Pending(Mutex<Vec<OpenFile>>);

fn read_game_files<I: IntoIterator<Item = String>>(args: I, cwd: &Path) -> Vec<OpenFile> {
    args.into_iter()
        .filter_map(|arg| {
            let path = PathBuf::from(&arg);
            let path = if path.is_absolute() { path } else { cwd.join(path) };
            let ext = path.extension()?.to_str()?.to_ascii_lowercase();
            if !GAME_EXTS.contains(&ext.as_str()) {
                return None;
            }
            let meta = std::fs::metadata(&path).ok()?;
            if !meta.is_file() || meta.len() > MAX_GAME_FILE {
                return None;
            }
            let bytes = std::fs::read(&path).ok()?;
            let name = path.file_name()?.to_string_lossy().into_owned();
            Some(OpenFile { name, bytes })
        })
        .collect()
}

/// 포터블판 표지 — zip 에만 들어 있다(desktop.yml «포터블 zip»).
const PORTABLE_MARK: &str = "portable.txt";

/// 포터블판인가. 자동 업데이트는 설치판(NSIS)을 %LOCALAPPDATA% 에 까므로, 포터블 폴더를 고치지 못하고 사본을
/// 하나 더 만든다 — 그래서 웹은 포터블판에서 새 버전을 알리기만 한다.
#[tauri::command]
fn is_portable() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join(PORTABLE_MARK)))
        .is_some_and(|p| p.is_file())
}

#[tauri::command]
fn take_open_files(pending: tauri::State<'_, Pending>) -> Vec<OpenFile> {
    std::mem::take(&mut *pending.0.lock().unwrap_or_else(|e| e.into_inner()))
}

fn bring_to_front(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn main() {
    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let _ = BOOT.set((Instant::now(), epoch));
    tauri::Builder::default()
        // 단일 인스턴스는 가장 먼저 — 두 번째 프로세스가 다른 플러그인을 띄우기 전에 끝나야 한다.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            bring_to_front(app);
            let files = read_game_files(argv.into_iter().skip(1), Path::new(&cwd));
            if !files.is_empty() {
                let _ = app.emit_to(MAIN, OPEN_FILES_EVENT, files);
            }
        }))
        // 보이기 · 장식은 기억하지 않는다: 보이기는 웹이 정하고, 장식은 언제나 커스텀 타이틀바다.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE & !StateFlags::DECORATIONS)
                .build(),
        )
        // 설정 ▸ 엔진의 «찾아보기…»(엔진 실행 파일 고르기) — 열기 대화 상자만 허용한다(capabilities).
        .plugin(tauri_plugin_dialog::init())
        .manage(Pending::default())
        .manage(BootMarks::default())
        .manage(engine::Engines::default())
        .invoke_handler(tauri::generate_handler![
            take_open_files,
            boot_marks,
            is_portable,
            engine::engine_builds,
            engine::engine_open,
            engine::engine_write,
            engine::engine_close,
            engine::engines_shutdown,
            settings::settings_read,
            settings::settings_write
        ])
        .on_page_load(|webview, payload| {
            let name = match payload.event() {
                PageLoadEvent::Started => "page-start",
                PageLoadEvent::Finished => "page-finish",
            };
            mark(webview.app_handle(), name);
        })
        .setup(|app| {
            mark(app.handle(), "setup");
            // 업데이터 플러그인 Builder 에는 «끝나기 전» 갈고리가 없다(UpdaterBuilder 에만 있고 JS 경로는 그것을
            // 쓰지 않는다) — 설치 직전 엔진 닫기는 웹이 `engines_shutdown` 으로 부른다(updater.ts).
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            let cwd = std::env::current_dir().unwrap_or_default();
            let files = read_game_files(std::env::args().skip(1), &cwd);
            *app.state::<Pending>().0.lock().unwrap_or_else(|e| e.into_inner()) = files;

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(SHOW_FALLBACK);
                if let Some(w) = handle.get_webview_window(MAIN) {
                    if !w.is_visible().unwrap_or(true) {
                        mark(&handle, "show-fallback");
                        let _ = w.show();
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("zenyth-desktop 를 띄우지 못했습니다")
        .run(|app, event| {
            // 창을 닫으면 엔진 프로세스도 함께 — 웹이 `END` 를 보낼 틈이 없었어도 고아로 남기지 않는다.
            if let tauri::RunEvent::Exit = event {
                app.state::<engine::Engines>().close_all();
            }
        });
}
