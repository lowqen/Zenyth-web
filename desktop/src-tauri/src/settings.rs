//! 데스크톱 `settings.txt` · `settings_dev.txt` 직접 읽기 · 쓰기(데스크톱 Z4).
//!
//! 해석 · 병합은 웹(`src/core/settings/desktop-settings.ts` 의 `parse` · `renderOver`)이 한다 — 위치 규약
//! (줄 삭제 금지 · 추가는 끝에만, 핸드북 규칙 4)을 아는 곳이 하나여야 한다. 셸은 두 파일 이름만 아는 파일 창구다.
//!
//! - 폴더가 비면 셸 실행 파일의 폴더(Yixin.exe 가 제 폴더의 settings.txt 를 읽는 것과 같은 규약).
//! - 쓰기는 같은 폴더의 임시 파일에 쓴 뒤 바꿔 넣는다 — 도중에 끊겨도 반쪽 파일이 남지 않는다.
//! - 다룰 수 있는 이름은 두 파일뿐이다(웹이 임의 경로를 쓰지 못하게).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;

const MAIN: &str = "settings.txt";
const DEV: &str = "settings_dev.txt";
/// 설정 파일은 2KB 남짓이다. 이보다 크면 설정 파일이 아니다.
const MAX_SIZE: u64 = 256 * 1024;

#[derive(Serialize)]
pub struct SettingsFiles {
    /// 실제로 쓴 폴더(절대 경로) — 화면에 보인다.
    dir: String,
    main: Option<String>,
    dev: Option<String>,
}

fn resolve_dir(dir: &str) -> Result<PathBuf, String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_default();
    let d = dir.trim();
    let p = if d.is_empty() {
        exe_dir
    } else {
        let p = PathBuf::from(d);
        if p.is_absolute() {
            p
        } else {
            exe_dir.join(p)
        }
    };
    if p.is_dir() {
        Ok(p)
    } else {
        Err(format!("폴더가 없습니다: {}", p.display()))
    }
}

fn read_opt(path: &Path) -> Result<Option<String>, String> {
    let meta = match fs::metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    if !meta.is_file() || meta.len() > MAX_SIZE {
        return Err(format!("설정 파일이 아닙니다: {}", path.display()));
    }
    let bytes = fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    // Yixin(GTK)은 UTF-8 로 쓴다. 다른 바이트는 대체 문자로 — 그 줄(글꼴 이름)은 웹이 바꾸지 않는 한 원문 그대로
    // 다시 쓰이지 않으므로(`renderOver` 는 값이 같은 줄을 건드리지 않는다), 읽기만으로 파일이 망가지지 않는다.
    Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
}

fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    let tmp = path.with_extension("txt.zenyth-tmp");
    let res = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)
    })();
    if let Err(e) = res {
        let _ = fs::remove_file(&tmp);
        return Err(format!("{}: {e}", path.display()));
    }
    Ok(())
}

#[tauri::command]
pub async fn settings_read(dir: String) -> Result<SettingsFiles, String> {
    let d = resolve_dir(&dir)?;
    Ok(SettingsFiles {
        main: read_opt(&d.join(MAIN))?,
        dev: read_opt(&d.join(DEV))?,
        dir: d.display().to_string(),
    })
}

/// 준 것만 쓴다(`None` 은 그 파일을 건드리지 않는다).
#[tauri::command]
pub async fn settings_write(
    dir: String,
    main: Option<String>,
    dev: Option<String>,
) -> Result<(), String> {
    let d = resolve_dir(&dir)?;
    if let Some(text) = main {
        write_atomic(&d.join(MAIN), &text)?;
    }
    if let Some(text) = dev {
        write_atomic(&d.join(DEV), &text)?;
    }
    Ok(())
}
