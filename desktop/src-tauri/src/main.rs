//! zenyth-desktop 셸(데스크톱 Z2).
//!
//! 이 프로세스가 하는 일은 창과 운영체제 사이의 것뿐이다 — 화면 · 판 · 엔진은 모두 웹(dist/)이 한다.
//! - 단일 인스턴스: 두 번째 실행은 기존 창을 앞으로 부르고, 넘겨받은 기보 파일을 그 창에 건넨다.
//! - 창 상태 기억(크기 · 위치 · 최대화). 보이기는 웹이 첫 화면을 그린 뒤에 한다(흰 화면 깜박임 방지).
//! - 파일 연결(.psq · .sav · .pos): 명령줄로 받은 파일을 읽어 웹에 넘긴다. 해석은 웹의 `openGameFile` 한 곳이다.
//!
//! 타이틀바 · 단축키는 웹 쪽(`src/app/desktop/`)에 있다.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
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
        .manage(Pending::default())
        .invoke_handler(tauri::generate_handler![take_open_files])
        .setup(|app| {
            let cwd = std::env::current_dir().unwrap_or_default();
            let files = read_game_files(std::env::args().skip(1), &cwd);
            *app.state::<Pending>().0.lock().unwrap_or_else(|e| e.into_inner()) = files;

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(SHOW_FALLBACK);
                if let Some(w) = handle.get_webview_window(MAIN) {
                    if !w.is_visible().unwrap_or(true) {
                        let _ = w.show();
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("zenyth-desktop 를 띄우지 못했습니다");
}
