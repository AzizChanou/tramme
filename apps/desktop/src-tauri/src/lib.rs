// The desktop app: one window whose page is the built editor, served on the
// custom `tramme` protocol — the same handler answers the static assets
// (embedded from apps/editor/dist by Tauri) and the /api routes over the
// local storage, so the editor runs unmodified, like behind its Worker.

mod api;
pub mod format;
pub mod store;

use std::borrow::Cow;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::http::{Request, Response, StatusCode};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const SCHEME: &str = "tramme";

/// a .tramme the system handed to the app (a double-click), waiting for the
/// editor to import it
static PENDING: Mutex<Option<(String, PathBuf)>> = Mutex::new(None);

fn take_open_path(argv: &[String]) -> Option<(String, PathBuf)> {
    let arg = argv.iter().skip(1).find(|a| a.to_lowercase().ends_with(".tramme"))?;
    let p = PathBuf::from(arg);
    let name = p.file_name()?.to_string_lossy().into_owned();
    Some((name, p))
}

fn focus_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// ── the desktop app's commands, for the editor's settings ────

#[tauri::command]
fn desktop_state() -> serde_json::Value {
    serde_json::json!({ "home": store::home().to_string_lossy() })
}

/// the folder for the projects, picked natively; None when cancelled
#[tauri::command]
async fn desktop_pick_home(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app.dialog().file().blocking_pick_folder()?;
    picked.into_path().ok().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn desktop_set_home(home: String) -> Result<serde_json::Value, String> {
    let p = PathBuf::from(&home);
    if !p.is_absolute() {
        return Err("the folder must be an absolute path".into());
    }
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    store::set_configured_home(&home).map_err(|e| e.message)?;
    Ok(serde_json::json!({ "home": store::home().to_string_lossy() }))
}

// ── a .tramme opened from the system ─────────────────────────

/// the name of the archive waiting to be imported, if any
#[tauri::command]
fn desktop_pending_name() -> Option<String> {
    PENDING.lock().unwrap().as_ref().map(|(name, _)| name.clone())
}

/// the archive's bytes; reading them consumes the pending open
#[tauri::command]
fn desktop_pending_bytes() -> tauri::ipc::Response {
    let taken = PENDING.lock().unwrap().take();
    let bytes = taken.and_then(|(_, p)| std::fs::read(p).ok()).unwrap_or_default();
    tauri::ipc::Response::new(bytes)
}

pub fn run() {
    tauri::Builder::default()
        // a second launch (a double-click on a .tramme) hands its file here
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some((name, path)) = take_open_path(&argv) {
                app.emit("desktop-open", &name).ok();
                *PENDING.lock().unwrap() = Some((name, path));
                focus_main(app);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            desktop_state, desktop_pick_home, desktop_set_home, desktop_pending_name, desktop_pending_bytes
        ])
        .register_asynchronous_uri_scheme_protocol(SCHEME, |_ctx, request, responder| {
            // answered off the main thread: the storage does disk I/O
            let app = _ctx.app_handle().clone();
            std::thread::spawn(move || {
                responder.respond(handle(app, request));
            });
        })
        .setup(|app| {
            // a first launch started from a double-click on a .tramme
            let argv: Vec<String> = std::env::args().collect();
            if let Some((name, path)) = take_open_path(&argv) {
                *PENDING.lock().unwrap() = Some((name, path));
            }
            let url = format!("{SCHEME}://localhost/").parse().unwrap();
            let mut window = WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol(url))
                .title("tramme")
                .inner_size(1400.0, 880.0)
                .min_inner_size(640.0, 480.0)
                // the editor drops files itself (the home screen imports them)
                .disable_drag_drop_handler();
            // a test harness (TRAMME_CDP_PORT=9223) can drive the webview over CDP
            if let Ok(port) = std::env::var("TRAMME_CDP_PORT") {
                window = window.additional_browser_args(&format!("--remote-debugging-port={port}"));
            }
            window.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the tramme desktop app");
}

/// any request on the app origin: /api to the storage, everything else to the
/// embedded assets, with index.html for the editor's pages (/p/<id>)
fn handle(app: tauri::AppHandle, request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let path = request.uri().path().to_string();
    let response = if path == "/api" || path.starts_with("/api/") {
        api::route(request)
    } else {
        asset_response(&app, &path)
    };
    response.map(Cow::Owned)
}

fn asset_response(app: &tauri::AppHandle, path: &str) -> Response<Vec<u8>> {
    let name = path.trim_start_matches('/');
    let name = if name.is_empty() || is_editor_page(name) { "index.html" } else { name };
    let mime = asset_mime(name);
    match app.asset_resolver().get(name.to_string()) {
        Some(asset) => Response::builder()
            .status(StatusCode::OK)
            .header("content-type", mime)
            .header("cache-control", "no-cache")
            .body(asset.bytes)
            .unwrap(),
        // an unknown route without an extension is a page: the editor routes it
        None if !has_extension(name) => {
            let index = app.asset_resolver().get("index.html".to_string()).map(|a| a.bytes).unwrap_or_default();
            Response::builder()
                .status(StatusCode::OK)
                .header("content-type", "text/html; charset=utf-8")
                .header("cache-control", "no-cache")
                .body(index)
                .unwrap()
        }
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header("content-type", "text/plain; charset=utf-8")
            .body(b"not found".to_vec())
            .unwrap(),
    }
}

/// /p/<id> and the home page are the editor's, everything else is a file
fn is_editor_page(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("p/") else { return false };
    let id = rest.trim_end_matches('/');
    format::valid_id(id)
}

fn has_extension(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(_, e)| !e.is_empty() && !e.contains('/'))
}

fn asset_mime(name: &str) -> &'static str {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" | "webmanifest" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        "flac" => "audio/flac",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "txt" => "text/plain; charset=utf-8",
        "wasm" => "application/wasm",
        "tramme" | "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editor_pages_and_files() {
        assert!(is_editor_page("p/abc-123"));
        assert!(is_editor_page("p/abc-123/"));
        assert!(!is_editor_page("p/ab"));
        assert!(!is_editor_page("p/ABC"));
        assert!(!is_editor_page("assets/main.js"));
        assert!(has_extension("assets/main-abc.js"));
        assert!(has_extension("index.html"));
        assert!(!has_extension("p/abc-123"));
        assert!(!has_extension("sounds/some.folder/file"));
    }

    #[test]
    fn mime_of_the_assets() {
        assert_eq!(asset_mime("index.html"), "text/html; charset=utf-8");
        assert_eq!(asset_mime("assets/main-1.js"), "text/javascript; charset=utf-8");
        assert_eq!(asset_mime("examples/x.tramme"), "application/zip");
        assert_eq!(asset_mime("sounds/catalog.json"), "application/json; charset=utf-8");
    }
}
