//! 네이티브 엔진 세션(데스크톱 Z3).
//!
//! 웹의 `NativeTransport`(`src/engine/engine-transport.ts`)가 이 세 명령으로 엔진과 줄을 주고받는다.
//! - `engine_open`  로컬 Rapfi 프로세스(사이드카)를 띄우거나 원격 Rapfi 의 TCP 에 붙는다. 세션 번호를 돌려준다.
//! - `engine_write` 명령 한 덩어리(여러 줄 블록이면 개행으로 이은 것)를 쓰고 끝에 개행을 붙인다.
//! - `engine_close` 세션을 닫는다(프로세스를 죽이거나 연결을 끊는다).
//!
//! 엔진이 낸 줄은 **16ms 프레임 단위로 묶어** 세션의 `Channel` 로 보낸다(계획 §6 «IPC» — `main.c` 의 10ms 배치
//! 플러시와 같은 발상). 탐색 중 엔진은 초당 수백 줄을 내므로 줄마다 IPC 를 하면 웹뷰가 그만큼 깨어난다.
//! 줄을 걸러 내지는 않는다 — 해석 · 집계 · 10Hz 스냅샷은 웹 워커의 일이고, 여러 줄 DB 주석처럼 앞뒤 줄이 이어지는
//! 응답이 있어 셸이 줄을 버리면 조립이 깨진다.
//!
//! **글자 인코딩(로컬만)**: Windows Rapfi 는 제 콘솔의 코드 페이지를 본다 — 입력을 그 코드 페이지에서 UTF-8 로,
//! 출력을 UTF-8 에서 그 코드 페이지로 바꾼다(DB 안에는 UTF-8 로 남는다). 셸은 콘솔이 없어 엔진이 숨은 새 콘솔을
//! 받고, 그 코드 페이지는 시스템 OEM(한국어 Windows 949)이다. UTF-8 을 그대로 쓰면 한글 주석이 «?» 섞인 바이트로
//! 깨진다. 2026-11-08 실측(0.43.01, `CreateNoWindow`): UTF-8 로 쓰면 깨지고, OEM 949 로 쓰고 읽으면 왕복되며, 그렇게
//! 쓴 주석을 UTF-8 콘솔 쪽에서 조회해도 같은 글자가 나온다(DB 는 UTF-8). 그래서 로컬 세션은 OEM 코드 페이지로
//! 쓰고 읽는다(`Codec`). OEM 에 없는 글자(949 밖의 문자)는 엔진 설계상 어차피 건널 수 없다. 원격(리눅스 서버)은 변환이 없으므로 UTF-8 그대로다.
//!
//! 세션 논리(탐색 줄 세우기 · 정지 · 정착 대기 · 감시견 · DB 응답 페어링)는 셸에 두지 않는다 — WASM 엔진과 같은
//! 워커 코드가 그대로 맡는다. 셸은 «줄을 나르는 파이프»일 뿐이다.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

/// 줄 묶음의 간격 — 한 화면 프레임.
const FRAME: Duration = Duration::from_millis(16);
/// 원격 연결 한도. Tailscale 이 꺼져 있으면 이름 풀이나 연결이 여기서 끝난다.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
/// 표준 출력이 닫힌 뒤 프로세스의 종료 코드를 기다리는 한도.
const EXIT_WAIT: Duration = Duration::from_secs(2);
/// Windows: 콘솔 앱(Rapfi)을 띄울 때 검은 창을 만들지 않는다. 셸은 `windows_subsystem = "windows"` 라 콘솔이 없다.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 웹 `NativeEngineSpec`(`src/engine/engine-types.ts`)과 같은 모양.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum EngineSpec {
    /// `path` 가 비면 셸 옆의 `engine/rapfi.exe` → `rapfi.exe` 순으로 찾는다.
    Local { path: String },
    Remote { host: String, port: u16 },
}

/// 웹 `NativeEvent`(`src/engine/engine-transport.ts`)와 같은 모양.
#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum EngineEvent {
    Lines { lines: Vec<String> },
    Exit { code: Option<i32>, error: Option<String> },
}

/// 엔진과 주고받는 바이트의 인코딩.
#[derive(Clone, Copy)]
enum Codec {
    Utf8,
    /// Windows 코드 페이지(OEM). 65001 이면 UTF-8 과 같다.
    #[cfg_attr(not(windows), allow(dead_code))]
    CodePage(u32),
}

impl Codec {
    /// 로컬 엔진 — 숨은 새 콘솔의 코드 페이지(= 시스템 OEM).
    fn local() -> Self {
        #[cfg(windows)]
        {
            Codec::CodePage(cp::oem())
        }
        #[cfg(not(windows))]
        {
            Codec::Utf8
        }
    }

    fn encode(self, s: &str) -> Vec<u8> {
        match self {
            Codec::Utf8 => s.as_bytes().to_vec(),
            #[cfg(windows)]
            Codec::CodePage(c) => cp::encode(c, s),
            #[cfg(not(windows))]
            Codec::CodePage(_) => s.as_bytes().to_vec(),
        }
    }

    fn decode(self, b: &[u8]) -> String {
        match self {
            Codec::Utf8 => String::from_utf8_lossy(b).into_owned(),
            #[cfg(windows)]
            Codec::CodePage(c) => cp::decode(c, b),
            #[cfg(not(windows))]
            Codec::CodePage(_) => String::from_utf8_lossy(b).into_owned(),
        }
    }
}

/// Windows 코드 페이지 변환 — kernel32 두 함수만 쓴다(새 의존성 없이).
#[cfg(windows)]
mod cp {
    use std::ptr::{null, null_mut};

    const CP_UTF8: u32 = 65001;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetOEMCP() -> u32;
        fn MultiByteToWideChar(
            code_page: u32,
            flags: u32,
            src: *const u8,
            src_len: i32,
            dst: *mut u16,
            dst_len: i32,
        ) -> i32;
        fn WideCharToMultiByte(
            code_page: u32,
            flags: u32,
            src: *const u16,
            src_len: i32,
            dst: *mut u8,
            dst_len: i32,
            default_char: *const u8,
            used_default: *mut i32,
        ) -> i32;
    }

    pub fn oem() -> u32 {
        // SAFETY: 인자 없는 조회.
        unsafe { GetOEMCP() }
    }

    pub fn encode(cp: u32, s: &str) -> Vec<u8> {
        if cp == CP_UTF8 || s.is_ascii() {
            return s.as_bytes().to_vec();
        }
        let wide: Vec<u16> = s.encode_utf16().collect();
        let Ok(len) = i32::try_from(wide.len()) else {
            return s.as_bytes().to_vec();
        };
        // SAFETY: 길이를 명시한 버퍼만 넘긴다. 첫 호출은 크기만 잰다.
        unsafe {
            let n = WideCharToMultiByte(cp, 0, wide.as_ptr(), len, null_mut(), 0, null(), null_mut());
            if n <= 0 {
                return s.as_bytes().to_vec();
            }
            let mut out = vec![0u8; n as usize];
            let n = WideCharToMultiByte(cp, 0, wide.as_ptr(), len, out.as_mut_ptr(), n, null(), null_mut());
            out.truncate(n.max(0) as usize);
            out
        }
    }

    pub fn decode(cp: u32, b: &[u8]) -> String {
        if cp == CP_UTF8 || b.is_ascii() {
            return String::from_utf8_lossy(b).into_owned();
        }
        let Ok(len) = i32::try_from(b.len()) else {
            return String::from_utf8_lossy(b).into_owned();
        };
        // SAFETY: 위와 같다.
        unsafe {
            let n = MultiByteToWideChar(cp, 0, b.as_ptr(), len, null_mut(), 0);
            if n <= 0 {
                return String::from_utf8_lossy(b).into_owned();
            }
            let mut w = vec![0u16; n as usize];
            let n = MultiByteToWideChar(cp, 0, b.as_ptr(), len, w.as_mut_ptr(), n);
            w.truncate(n.max(0) as usize);
            String::from_utf16_lossy(&w)
        }
    }
}

enum Conn {
    Child(Child),
    Tcp(TcpStream),
}

struct Session {
    writer: Mutex<Box<dyn Write + Send>>,
    codec: Codec,
    conn: Mutex<Conn>,
    /// 우리가 닫았는가 — 그러면 끝은 고장이 아니다.
    closed: AtomicBool,
    /// 엔진이 낸 줄 중 아직 보내지 않은 것.
    pending: Mutex<Vec<String>>,
    /// 아직 읽고 있는 출력 스트림 수(로컬: stdout · stderr, 원격: 소켓 하나).
    readers: AtomicUsize,
}

impl Session {
    fn kill(&self) {
        self.closed.store(true, Ordering::SeqCst);
        match &mut *lock(&self.conn) {
            Conn::Child(c) => {
                let _ = c.kill();
            }
            Conn::Tcp(s) => {
                let _ = s.shutdown(Shutdown::Both);
            }
        }
    }

    /// 출력이 모두 닫힌 뒤의 끝 — 종료 코드와, 우리가 닫은 게 아니면 그 까닭.
    fn outcome(&self) -> (Option<i32>, Option<String>) {
        let closed = self.closed.load(Ordering::SeqCst);
        let mut code = None;
        let mut is_child = false;
        let deadline = Instant::now() + EXIT_WAIT;
        loop {
            match &mut *lock(&self.conn) {
                Conn::Tcp(_) => break,
                Conn::Child(c) => {
                    is_child = true;
                    if let Ok(Some(status)) = c.try_wait() {
                        code = status.code();
                        break;
                    }
                }
            }
            if Instant::now() >= deadline {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        if closed {
            return (code, None);
        }
        let error = if is_child {
            match code {
                Some(0) => None,
                Some(c) => Some(format!("엔진 프로세스가 종료했습니다 (코드 {c})")),
                None => Some("엔진 프로세스의 출력이 닫혔습니다".to_string()),
            }
        } else {
            Some("원격 엔진과의 연결이 끊겼습니다".to_string())
        };
        (code, error)
    }
}

/// 열린 세션들. `main.rs` 가 상태로 둔다.
#[derive(Default)]
pub struct Engines {
    next: AtomicU32,
    map: Mutex<HashMap<u32, Arc<Session>>>,
}

impl Engines {
    fn get(&self, id: u32) -> Option<Arc<Session>> {
        lock(&self.map).get(&id).cloned()
    }

    fn remove(&self, id: u32) -> Option<Arc<Session>> {
        lock(&self.map).remove(&id)
    }

    /// 셸이 끝날 때 — 남은 엔진 프로세스를 고아로 두지 않는다.
    pub fn close_all(&self) {
        let all: Vec<_> = lock(&self.map).drain().map(|(_, s)| s).collect();
        for s in all {
            s.kill();
        }
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// 로컬 엔진 실행 파일 — 지정한 경로, 아니면 셸 옆의 기본 위치.
fn resolve_local(path: &str) -> Result<PathBuf, String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_default();
    if !path.trim().is_empty() {
        let p = PathBuf::from(path.trim());
        let p = if p.is_absolute() { p } else { exe_dir.join(p) };
        return if p.is_file() {
            Ok(p)
        } else {
            Err(format!("파일이 없습니다: {}", p.display()))
        };
    }
    let tried = [exe_dir.join("engine").join("rapfi.exe"), exe_dir.join("rapfi.exe")];
    tried.iter().find(|p| p.is_file()).cloned().ok_or_else(|| {
        let list: Vec<String> = tried.iter().map(|p| p.display().to_string()).collect();
        format!("엔진 실행 파일을 찾지 못했습니다: {}", list.join(" · "))
    })
}

fn connect(host: &str, port: u16) -> Result<TcpStream, String> {
    let addrs: Vec<_> = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("{host} 이름을 풀지 못했습니다: {e}"))?
        .collect();
    let mut last = format!("{host}:{port} 의 주소가 없습니다");
    for a in addrs {
        match TcpStream::connect_timeout(&a, CONNECT_TIMEOUT) {
            Ok(s) => return Ok(s),
            Err(e) => last = format!("{a}: {e}"),
        }
    }
    Err(last)
}

/// 출력 스트림 하나를 줄로 읽어 `pending` 에 쌓는다. 개행 · CR 은 뗀다. UTF-8 이 아닌 바이트는 대체 문자로.
fn read_lines(r: Box<dyn Read + Send>, session: Arc<Session>) {
    let mut r = BufReader::new(r);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match r.read_until(b'\n', &mut buf) {
            Ok(0) => break,
            Ok(_) => {
                while matches!(buf.last(), Some(b'\n' | b'\r')) {
                    buf.pop();
                }
                let line = session.codec.decode(&buf);
                lock(&session.pending).push(line);
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    session.readers.fetch_sub(1, Ordering::SeqCst);
}

/// 프레임마다 쌓인 줄을 묶어 보낸다. 출력이 모두 닫히면 남은 줄과 끝을 보내고 세션을 치운다.
fn pump(app: AppHandle, id: u32, session: Arc<Session>, channel: Channel<EngineEvent>) {
    loop {
        thread::sleep(FRAME);
        let done = session.readers.load(Ordering::SeqCst) == 0;
        let lines = std::mem::take(&mut *lock(&session.pending));
        if !lines.is_empty() && channel.send(EngineEvent::Lines { lines }).is_err() {
            // 웹뷰가 사라졌다(새로 고침 등) — 엔진을 남겨 둘 까닭이 없다.
            session.kill();
        }
        if done {
            let rest = std::mem::take(&mut *lock(&session.pending));
            if !rest.is_empty() {
                let _ = channel.send(EngineEvent::Lines { lines: rest });
            }
            let (code, error) = session.outcome();
            let _ = channel.send(EngineEvent::Exit { code, error });
            app.state::<Engines>().remove(id);
            return;
        }
    }
}

#[tauri::command]
pub async fn engine_open(
    app: AppHandle,
    engines: State<'_, Engines>,
    spec: EngineSpec,
    on_event: Channel<EngineEvent>,
) -> Result<u32, String> {
    let codec = match spec {
        EngineSpec::Local { .. } => Codec::local(),
        EngineSpec::Remote { .. } => Codec::Utf8,
    };
    let (writer, conn, readers): (Box<dyn Write + Send>, Conn, Vec<Box<dyn Read + Send>>) =
        match spec {
            EngineSpec::Local { path } => {
                let exe = resolve_local(&path)?;
                let dir = exe.parent().map(|d| d.to_path_buf()).unwrap_or_default();
                let mut cmd = Command::new(&exe);
                // 엔진은 작업 폴더에서 config.toml · 가중치 · rapfi.db 를 찾는다.
                cmd.current_dir(&dir)
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    cmd.creation_flags(CREATE_NO_WINDOW);
                }
                let mut child = cmd.spawn().map_err(|e| format!("{}: {e}", exe.display()))?;
                let stdin = child.stdin.take().ok_or("표준 입력을 열지 못했습니다")?;
                let stdout = child.stdout.take().ok_or("표준 출력을 열지 못했습니다")?;
                let stderr = child.stderr.take().ok_or("표준 오류를 열지 못했습니다")?;
                (
                    Box::new(stdin),
                    Conn::Child(child),
                    vec![Box::new(stdout), Box::new(stderr)],
                )
            }
            EngineSpec::Remote { host, port } => {
                let stream = tauri::async_runtime::spawn_blocking(move || connect(&host, port))
                    .await
                    .map_err(|e| e.to_string())??;
                let _ = stream.set_nodelay(true);
                let reader = stream.try_clone().map_err(|e| e.to_string())?;
                let writer = stream.try_clone().map_err(|e| e.to_string())?;
                (Box::new(writer), Conn::Tcp(stream), vec![Box::new(reader)])
            }
        };

    let session = Arc::new(Session {
        writer: Mutex::new(writer),
        codec,
        conn: Mutex::new(conn),
        closed: AtomicBool::new(false),
        pending: Mutex::new(Vec::new()),
        readers: AtomicUsize::new(readers.len()),
    });
    let id = engines.next.fetch_add(1, Ordering::SeqCst) + 1;
    lock(&engines.map).insert(id, session.clone());
    for r in readers {
        let s = session.clone();
        thread::spawn(move || read_lines(r, s));
    }
    thread::spawn(move || pump(app, id, session, on_event));
    Ok(id)
}

#[tauri::command]
pub async fn engine_write(engines: State<'_, Engines>, id: u32, text: String) -> Result<(), String> {
    let session = engines.get(id).ok_or("엔진 세션이 닫혔습니다")?;
    let bytes = session.codec.encode(&text);
    let mut w = lock(&session.writer);
    w.write_all(&bytes)
        .and_then(|_| w.write_all(b"\n"))
        .and_then(|_| w.flush())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn engine_close(engines: State<'_, Engines>, id: u32) -> Result<(), String> {
    // 지도에서는 끝(`pump`)이 치운다 — 여기서는 죽이기만 해서 남은 줄과 끝이 웹에 닿게 한다.
    if let Some(s) = engines.get(id) {
        s.kill();
    }
    Ok(())
}
