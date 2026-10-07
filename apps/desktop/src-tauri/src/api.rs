// The /api routes of the desktop app, answered in the custom protocol handler
// on the same origin as the editor: the storage over the local folders
// (store.rs), a static /api/config, and a clean refusal for what needs a
// server (the providers, the transcription, multipart uploads).

use crate::store::{self, Store};
use serde_json::json;
use tauri::http::header::{HeaderName, HeaderValue};
use tauri::http::{Request, Response, StatusCode};

pub type Body = Response<Vec<u8>>;

fn json_response(status: u16, data: &serde_json::Value) -> Body {
    Response::builder()
        .status(StatusCode::from_u16(status).unwrap())
        .header("content-type", "application/json; charset=utf-8")
        .header("cache-control", "no-store")
        .body(serde_json::to_vec(data).unwrap())
        .unwrap()
}

fn error_response(e: store::HttpError) -> Body {
    json_response(e.status, &json!({ "error": e.message }))
}

fn ok_json(data: serde_json::Value) -> Body {
    json_response(200, &data)
}

fn request_json<T: serde::de::DeserializeOwned>(req: &Request<Vec<u8>>) -> Result<T, store::HttpError> {
    serde_json::from_slice::<T>(&req.body())
        .map_err(|_| store::HttpError { status: 400, message: "unreadable JSON body".into() })
}

fn header<'a>(req: &'a Request<Vec<u8>>, name: &str) -> Option<&'a str> {
    req.headers().get(name).and_then(|v| v.to_str().ok())
}

fn decode_segments(parts: &[String]) -> Vec<String> {
    parts
        .iter()
        .map(|p| percent_encoding::percent_decode_str(p).decode_utf8_lossy().into_owned())
        .collect()
}

/// the configuration of this server, like the Worker's /api/config
fn config() -> serde_json::Value {
    json!({
        "mode": "private",
        "format": crate::format::PROJECT_FORMAT,
        "limits": crate::format::LIMITS,
        "claude": { "server": false },
        "transcribe": false,
    })
}

/// one /api request, answered or failed as JSON
pub fn route(req: Request<Vec<u8>>) -> Body {
    let parts: Vec<String> = req
        .uri()
        .path()
        .strip_prefix("/api/")
        .unwrap_or_default()
        .split('/')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    match route_inner(&parts, req) {
        Ok(r) => r,
        Err(e) => error_response(e),
    }
}

fn route_inner(parts: &[String], req: Request<Vec<u8>>) -> Result<Body, store::HttpError> {
    let method = req.method().as_str();
    let store = Store::new();
    let p0 = parts.first().map(|s| s.as_str()).unwrap_or("");
    match (p0, method) {
        ("config", "GET") => Ok(ok_json(config())),
        ("projects", _) => projects(&store, parts, req),
        ("library", _) => shelf(&store, "plugins", parts, req),
        ("sounds", _) => shelf(&store, "sounds", parts, req),
        // everything the Worker served for the assistant and the providers:
        // not available in the desktop proof of concept (a next step)
        ("claude" | "llm" | "models" | "generate" | "generate-image" | "keys" | "transcribe", _) => Ok(json_response(
            501,
            &json!({ "error": "not available in the desktop app yet: the providers and the transcription come with the local keys" }),
        )),
        _ => Ok(json_response(404, &json!({ "error": format!("unknown route: {method} /api/{}", parts.join("/")) }))),
    }
}

fn projects(store: &Store, parts: &[String], req: Request<Vec<u8>>) -> Result<Body, store::HttpError> {
    let method = req.method().as_str();
    let id = parts.get(1).map(|s| s.as_str()).unwrap_or("");
    let sub = parts.get(2).map(|s| s.as_str()).unwrap_or("");
    if id.is_empty() {
        return match method {
            "GET" => Ok(ok_json(serde_json::to_value(store.list_projects()?).unwrap())),
            "POST" => {
                let body: store::CreateBody = request_json(&req)?;
                Ok(json_response(201, &serde_json::to_value(store.create_project(body)?).unwrap()))
            }
            _ => Ok(json_response(405, &json!({ "error": format!("unknown route: {method} /api/projects") }))),
        };
    }
    if sub.is_empty() {
        return match method {
            "GET" => {
                let (manifest, files) = store.project_info(id)?;
                Ok(ok_json(json!({ "manifest": manifest, "files": files })))
            }
            "PATCH" => {
                let body: store::UpdateBody = request_json(&req)?;
                Ok(ok_json(serde_json::to_value(store.update_project(id, body)?).unwrap()))
            }
            "DELETE" => {
                let files = store.delete_project(id)?;
                Ok(ok_json(json!({ "deleted": id, "files": files })))
            }
            _ => Ok(json_response(405, &json!({ "error": format!("unknown route: {method} /api/projects/{id}") }))),
        };
    }
    match (sub, method) {
        ("duplicate", "POST") => {
            let body: store::DuplicateBody = request_json(&req).unwrap_or(store::DuplicateBody { name: None });
            Ok(json_response(201, &serde_json::to_value(store.duplicate_project(id, body)?).unwrap()))
        }
        ("export", "GET") => {
            let (file, bytes) = store.export_project(id)?;
            let ascii: String = file.chars().map(|c| if (c as u32) >= 0x20 && (c as u32) <= 0x7e { c } else { '_' }).collect();
            let value = HeaderValue::from_str(&format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{}", encode_uri_component(&file)))
                .map_err(|_| store::HttpError { status: 500, message: "bad filename".into() })?;
            Response::builder()
                .status(StatusCode::OK)
                .header("content-type", "application/zip")
                .header("content-disposition", value)
                .header("cache-control", "no-store")
                .body(bytes)
                .map_err(|_| store::HttpError { status: 500, message: "response error".into() })
        }
        ("uploads", _) => Ok(json_response(501, &json!({ "error": "multipart uploads are not available in the desktop app yet" }))),
        ("files", _) if parts.len() > 3 => file(store, id, &parts[3..], req),
        _ => Ok(json_response(404, &json!({ "error": format!("unknown route: {method} /api/projects/{id}/{sub}") }))),
    }
}

fn file(store: &Store, id: &str, raw_path: &[String], req: Request<Vec<u8>>) -> Result<Body, store::HttpError> {
    let path = decode_segments(raw_path).join("/");
    let method = req.method().as_str();
    match method {
        "GET" | "HEAD" => {
            let (data, stored) = store.get_file(id, &path)?;
            if let Some(inm) = header(&req, "if-none-match") {
                if store::etag_matches(inm, &stored.etag) {
                    return not_modified(&stored);
                }
            }
            file_response(&stored, data, header(&req, "range"), method == "HEAD")
        }
        "PUT" => {
            let (stored, modified) = store.put_file(id, &path, req.body(), header(&req, "if-match"))?;
            Ok(ok_json(json!({ "path": stored.path, "size": stored.size, "etag": stored.etag, "modified": modified }))
                .with_header("etag", &stored.etag))
        }
        "DELETE" => {
            store.delete_file(id, &path)?;
            Ok(ok_json(json!({ "deleted": path })))
        }
        _ => Ok(json_response(405, &json!({ "error": format!("unknown route: {method} /api/projects/{id}/files") }))),
    }
}

/// the plugin library and the sound library, as the Worker answers them from
/// the shelves (library/plugins/<name>, library/sounds/<name>)
fn shelf(store: &Store, shelf: &str, parts: &[String], req: Request<Vec<u8>>) -> Result<Body, store::HttpError> {
    let method = req.method().as_str();
    let raw = parts.get(1).map(|s| s.as_str()).unwrap_or("");
    if raw.is_empty() {
        if method != "GET" {
            return Ok(json_response(405, &json!({ "error": format!("unknown route: {method} /api/{shelf}") })));
        }
        return Ok(ok_json(serde_json::to_value(store.shelf_list(shelf)?).unwrap()));
    }
    let name = decode_name(shelf, raw)?;
    match method {
        "GET" | "HEAD" => {
            let data = store.shelf_get(shelf, &name)?;
            Response::builder()
                .status(StatusCode::OK)
                .header("content-type", shelf_type(shelf, &name))
                .header("cache-control", "no-store")
                .body(data)
                .map_err(response_err)
        }
        "PUT" => {
            let entry = if shelf == "sounds" { header(&req, "x-tramme-entry").map(|s| s.to_string()) } else { None };
            let size = store.shelf_put(shelf, &name, req.body(), entry.as_deref())?;
            Ok(ok_json(json!({ "name": name, "size": size })))
        }
        "DELETE" => {
            store.shelf_delete(shelf, &name)?;
            Ok(ok_json(json!({ "deleted": name })))
        }
        _ => Ok(json_response(405, &json!({ "error": format!("unknown route: {method} /api/{shelf}") }))),
    }
}

/// a name of the shelf: lower case letters, digits, - and _, then its extension
fn decode_name(shelf: &str, raw: &str) -> Result<String, store::HttpError> {
    let name = percent_encoding::percent_decode_str(raw).decode_utf8_lossy().into_owned();
    let exts = if shelf == "sounds" { "wav|mp3|ogg|m4a|flac|webm|opus" } else { "js|mjs" };
    let ok = {
        let mut chars = name.chars();
        let valid_start = matches!(chars.next(), Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit());
        let (stem, ext) = name.rsplit_once('.').map(|(a, b)| (a, b.to_lowercase())).unwrap_or(("", String::new()));
        valid_start
            && !stem.is_empty()
            && stem.chars().count() <= 63
            && stem.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
            && exts.split('|').any(|e| e == ext)
    };
    if ok {
        Ok(name)
    } else {
        let what = if shelf == "sounds" { "sound" } else { "plugin" };
        store::http_err(400, format!("invalid {what} name \"{name}\": lower case letters, digits, - and _, then its extension"))
    }
}

fn shelf_type(shelf: &str, name: &str) -> &'static str {
    if shelf == "plugins" {
        return "text/javascript; charset=utf-8";
    }
    match crate::format::mime_of(name) {
        "audio/wav" | "audio/mpeg" | "audio/ogg" | "audio/mp4" | "audio/flac" => crate::format::mime_of(name),
        _ => "application/octet-stream",
    }
}

// ── answers for a file ───────────────────────────────────────

fn file_response(stored: &store::Stored, data: Vec<u8>, range: Option<&str>, head_only: bool) -> Result<Body, store::HttpError> {
    const CSP: &str = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self' data:; sandbox";
    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header("content-type", crate::format::mime_of(&stored.path))
        .header("etag", stored.etag.as_str())
        .header("cache-control", "no-cache")
        .header("accept-ranges", "bytes")
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", CSP);
    let body = match range.and_then(store::parse_range) {
        Some(r) => match slice(&data, r) {
            Some((start, length)) => {
                builder = builder
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header("content-range", format!("bytes {start}-{end}/{}", stored.size, end = start + length - 1));
                data[start..start + length].to_vec()
            }
            None => {
                builder = builder.status(StatusCode::RANGE_NOT_SATISFIABLE).header("content-range", format!("bytes */{}", stored.size));
                Vec::new()
            }
        },
        None => {
            builder = builder.header("content-length", stored.size);
            data
        }
    };
    let body = if head_only { Vec::new() } else { body };
    builder.body(body).map_err(response_err)
}

fn not_modified(stored: &store::Stored) -> Result<Body, store::HttpError> {
    Response::builder()
        .status(StatusCode::NOT_MODIFIED)
        .header("content-type", crate::format::mime_of(&stored.path))
        .header("etag", stored.etag.as_str())
        .header("cache-control", "no-cache")
        .header("accept-ranges", "bytes")
        .header("x-content-type-options", "nosniff")
        .body(Vec::new())
        .map_err(response_err)
}

/// a range against the whole file, or None when it does not fit
fn slice(data: &[u8], range: store::Range) -> Option<(usize, usize)> {
    let size = data.len();
    match range {
        store::Range::Suffix(n) => {
            let n = (n as usize).min(size);
            Some((size - n, n))
        }
        store::Range::Offset { offset, length } => {
            let offset = offset as usize;
            if offset >= size {
                return None;
            }
            let length = length.map(|l| l as usize).unwrap_or(size - offset).min(size - offset);
            Some((offset, length))
        }
    }
}

fn response_err(_: tauri::http::Error) -> store::HttpError {
    store::HttpError { status: 500, message: "response error".into() }
}

fn encode_uri_component(s: &str) -> String {
    const SET: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
        .remove(b'*')
        .remove(b'-')
        .remove(b'.')
        .remove(b'_')
        .add(b'!');
    percent_encoding::utf8_percent_encode(s, SET).to_string()
}

/// a small helper so any built response can gain one more header
trait WithHeader {
    fn with_header(self, name: &str, value: &str) -> Body;
}

impl WithHeader for Body {
    fn with_header(mut self, name: &str, value: &str) -> Body {
        if let (Ok(n), Ok(v)) = (name.parse::<HeaderName>(), HeaderValue::from_str(value)) {
            self.headers_mut().insert(n, v);
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uri_component_encoding() {
        assert_eq!(encode_uri_component("Mon Projet.tramme"), "Mon%20Projet.tramme");
        assert_eq!(encode_uri_component("a/b:c"), "a%2Fb%3Ac");
    }

    #[test]
    fn shelf_names_validated() {
        assert_eq!(decode_name("plugins", "tool.js").unwrap(), "tool.js");
        assert_eq!(decode_name("sounds", "click-1.wav").unwrap(), "click-1.wav");
        assert!(decode_name("plugins", "Tool.js").is_err());
        assert!(decode_name("plugins", "a.exe").is_err());
        assert!(decode_name("sounds", "a.wav.exe").is_err());
    }

    #[test]
    fn ranges_slice_files() {
        let data: Vec<u8> = (0..100u8).collect();
        let (start, len) = slice(&data, store::parse_range("bytes=10-19").unwrap()).unwrap();
        assert_eq!((start, len), (10, 10));
        let (start, len) = slice(&data, store::parse_range("bytes=90-").unwrap()).unwrap();
        assert_eq!((start, len), (90, 10));
        let (start, len) = slice(&data, store::parse_range("bytes=-10").unwrap()).unwrap();
        assert_eq!((start, len), (90, 10));
        assert!(slice(&data, store::parse_range("bytes=200-").unwrap()).is_none());
    }
}
