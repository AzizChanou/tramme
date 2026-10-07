// The storage of the desktop app over HTTP, for the storage contract suite
// (apps/desktop/test): the same raw bucket the /api routes answer from, as a
// little server a test can spawn. Not part of the app; test harness only.
//
// Parameters travel in the query (percent-encoded), file bytes in the body,
// object metadata back in the X-Tramme-Meta header.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use tramme_desktop_lib::store::{self, Store};

fn main() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    println!("PORT={}", listener.local_addr().unwrap().port());
    let _ = std::io::stdout().flush();
    let store: Arc<RwLock<Store>> = Arc::new(RwLock::new(Store::new()));
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else { continue };
        let store = store.clone();
        std::thread::spawn(move || {
            let _ = handle(&mut stream, &store);
        });
    }
}

/// a query value, percent-decoded
fn param(params: &[(String, String)], name: &str) -> String {
    params.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone()).unwrap_or_default()
}

fn handle(stream: &mut TcpStream, store: &RwLock<Store>) -> std::io::Result<()> {
    let Some((target, body)) = read_request(stream)? else { return Ok(()) };
    let (route, query) = match target.split_once('?') {
        Some((r, q)) => (r.to_string(), q),
        None => (target.clone(), ""),
    };
    let params: Vec<(String, String)> = query
        .split('&')
        .filter(|kv| !kv.is_empty())
        .filter_map(|kv| {
            let (k, v) = kv.split_once('=')?;
            let decode = |s: &str| percent_encoding::percent_decode_str(s).decode_utf8_lossy().into_owned();
            Some((decode(k), decode(v)))
        })
        .collect();
    let json: serde_json::Value = if body.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null)
    };
    let get = |k: &str| json.get(k).cloned().unwrap_or(serde_json::Value::Null);
    let s = store.read().expect("store lock");
    match route.as_str() {
        "/health" => respond(stream, 200, None, b"ok"),
        "/reset" => {
            drop(s);
            let home = PathBuf::from(get("home").as_str().unwrap_or_default());
            std::fs::create_dir_all(&home).ok();
            *store.write().expect("store lock") = Store::with_home(home);
            respond(stream, 200, None, b"ok")
        }
        "/head" => {
            let key = param(&params, "key");
            match s.raw_head(&key) {
                Some(o) => respond(stream, 200, Some(&meta_json(&key, &o, None)), b""),
                None => respond(stream, 404, None, b""),
            }
        }
        "/get" => {
            let key = param(&params, "key");
            match s.raw_get(&key) {
                Ok((data, o)) => respond(stream, 200, Some(&meta_json(&key, &o, None)), &data),
                Err(e) => respond(stream, e.status, Some(&serde_json::json!({ "error": e.message })), b""),
            }
        }
        "/put" => {
            let key = param(&params, "key");
            let custom: Option<serde_json::Map<String, serde_json::Value>> =
                param(&params, "custom").parse::<serde_json::Value>().ok().and_then(|v| v.as_object().cloned());
            match s.raw_put(&key, &body, None, custom.as_ref()) {
                Ok(Some(o)) => respond(stream, 200, Some(&meta_json(&key, &o, None)), b""),
                Ok(None) => respond(stream, 412, None, b""),
                Err(e) => respond(stream, e.status, None, b""),
            }
        }
        "/delete" => match s.raw_delete(&strings_of(&get("keys"))) {
            Ok(()) => respond(stream, 204, None, b""),
            Err(e) => respond(stream, e.status, None, b""),
        },
        "/list" => {
            let prefix = get("prefix").as_str().map(String::from).unwrap_or_default();
            let delimiter = get("delimiter").as_str().map(String::from);
            match s.raw_list(&prefix, delimiter.as_deref()) {
                Ok(listing) => {
                    let objects = listing
                        .objects
                        .iter()
                        .map(|o| meta_json(&o.key, &stored_of(o), o.custom.as_ref()))
                        .collect::<Vec<_>>();
                    let out = serde_json::json!({ "objects": objects, "delimitedPrefixes": listing.delimited_prefixes, "truncated": false });
                    respond(stream, 200, None, out.to_string().as_bytes())
                }
                Err(e) => respond(stream, e.status, None, b""),
            }
        }
        "/multipart/create" => match s.upload_start(&param(&params, "key")) {
            Ok(id) => respond(stream, 200, None, serde_json::json!({ "uploadId": id }).to_string().as_bytes()),
            Err(e) => respond(stream, e.status, None, b""),
        },
        "/multipart/part" => {
            let key = param(&params, "key");
            let id = param(&params, "uploadId");
            let n: u32 = param(&params, "partNumber").parse().unwrap_or(0);
            match s.upload_part(&key, &id, n, &body) {
                Ok(etag) => respond(stream, 200, None, serde_json::json!({ "partNumber": n, "etag": etag }).to_string().as_bytes()),
                Err(e) => respond(stream, e.status, None, b""),
            }
        }
        "/multipart/complete" => {
            let key = param(&params, "key");
            let id = param(&params, "uploadId");
            let parts: Vec<(u32, String)> = get("parts")
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|p| {
                            let arr = p.as_array()?;
                            Some((arr.first()?.as_u64()? as u32, arr.get(1)?.as_str()?.to_string()))
                        })
                        .collect()
                })
                .unwrap_or_default();
            match s.upload_complete(&key, &id, &parts) {
                Ok(o) => respond(stream, 200, Some(&meta_json(&key, &o, None)), b""),
                Err(e) => respond(stream, e.status, Some(&serde_json::json!({ "error": e.message })), b""),
            }
        }
        "/multipart/abort" => match s.upload_abort(&param(&params, "key"), &param(&params, "uploadId")) {
            Ok(()) => respond(stream, 204, None, b""),
            Err(e) => respond(stream, e.status, None, b""),
        },
        _ => respond(stream, 404, None, b"unknown route"),
    }
}

fn strings_of(v: &serde_json::Value) -> Vec<String> {
    match v {
        serde_json::Value::String(s) => vec![s.clone()],
        serde_json::Value::Array(a) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
        _ => Vec::new(),
    }
}

fn stored_of(o: &store::RawObject) -> store::Stored {
    store::Stored { path: o.key.clone(), size: o.size, etag: o.etag.clone(), modified: o.modified.clone() }
}

fn meta_json(key: &str, o: &store::Stored, custom: Option<&serde_json::Map<String, serde_json::Value>>) -> serde_json::Value {
    let mut m = serde_json::json!({ "key": key, "size": o.size, "etag": o.etag, "uploaded": o.modified });
    if let Some(custom) = custom.filter(|c| !c.is_empty()) {
        m.as_object_mut().unwrap().insert("custom".into(), custom.clone().into());
    }
    m
}

/// one request: its target (path?query) and its body (Connection: close)
fn read_request(stream: &mut TcpStream) -> std::io::Result<Option<(String, Vec<u8>)>> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let head_end = loop {
        if let Some(i) = find(&buf, b"\r\n\r\n") {
            break i;
        }
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            return Ok(None);
        }
        buf.extend_from_slice(&chunk[..n]);
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let content_length = lines
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.trim().eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.trim().parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < content_length {
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(content_length);
    let Some(target) = request_line.split_whitespace().nth(1) else { return Ok(None) };
    Ok(Some((target.to_string(), body)))
}

fn respond(stream: &mut TcpStream, status: u16, meta: Option<&serde_json::Value>, body: &[u8]) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        409 => "Conflict",
        412 => "Precondition Failed",
        _ => "Error",
    };
    let mut head = format!("HTTP/1.1 {status} {reason}\r\nConnection: close\r\nContent-Length: {}\r\n", body.len());
    if let Some(m) = meta {
        const SET: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC;
        head.push_str(&format!("X-Tramme-Meta: {}\r\n", percent_encoding::utf8_percent_encode(&m.to_string(), SET)));
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes())?;
    if status != 204 {
        stream.write_all(body)?;
    }
    stream.flush()
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}
