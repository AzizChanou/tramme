// The desktop app: one window whose page is the built editor, served on the
// custom `tramme` protocol — the same handler answers the static assets
// (embedded from apps/editor/dist by Tauri) and the /api routes over the
// local storage, so the editor runs unmodified, like behind its Worker.

mod api;
mod format;
mod store;

use std::borrow::Cow;
use tauri::http::{Request, Response, StatusCode};
use tauri::{WebviewUrl, WebviewWindowBuilder};

const SCHEME: &str = "tramme";

pub fn run() {
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol(SCHEME, |_ctx, request, responder| {
            // answered off the main thread: the storage does disk I/O
            let app = _ctx.app_handle().clone();
            std::thread::spawn(move || {
                responder.respond(handle(app, request));
            });
        })
        .setup(|app| {
            let url = format!("{SCHEME}://localhost/").parse().unwrap();
            let mut window = WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol(url))
                .title("tramme")
                .inner_size(1400.0, 880.0)
                .min_inner_size(640.0, 480.0);
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
