// The way out of the desktop app to the providers (the desktop_fetch command).
// The page answers the provider routes itself (packages/api providersAnswer)
// with a stand-in for each key, "tramme-key:<provider>" or
// "tramme-key:custom:<id>"; the request leaves from here, where the stand-ins
// of its headers become the keys of the keychain — toward that provider's own
// address only. The answer streams back over a channel: its head, its body in
// chunks, its end. No CORS out here: Z.AI and the custom providers are reached
// like the others.

use crate::keys::{origin, KeyStore};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// a request of the page, as fetch would send it
#[derive(Debug, Deserialize)]
pub struct Outbound {
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    /// the body, in base64
    #[serde(default)]
    pub body: Option<String>,
}

/// what the page hears of its request, in this order: head, chunks, then end or error
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Event {
    Head { status: u16, headers: Vec<(String, String)> },
    Chunk { data: String },
    End,
    Error { message: String },
}

/// the requests under way, by the page's id: one taken out of here is given up
static RUNNING: Mutex<Vec<u32>> = Mutex::new(Vec::new());

fn running(id: u32) -> bool {
    RUNNING.lock().unwrap().contains(&id)
}

/// the page gave up on a request (its AbortSignal, or its body left unread)
pub fn abort(id: u32) {
    RUNNING.lock().unwrap().retain(|r| *r != id);
}

/// the headers that belong to one connection, not to the request or the answer
const HOP: [&str; 6] = ["host", "content-length", "connection", "transfer-encoding", "accept-encoding", "content-encoding"];

fn stand_in() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"tramme-key:(custom:[a-z0-9][a-z0-9-]{0,31}|[a-z]+)").unwrap())
}

/// the headers with the keys in place of their stand-ins; whether any was put
fn with_keys(url: &str, headers: Vec<(String, String)>, keys: &KeyStore) -> Result<(Vec<(String, String)>, bool), String> {
    let target = origin(url).ok_or_else(|| format!("not an http(s) address: {url}"))?;
    let mut keyed = false;
    let mut out = Vec::with_capacity(headers.len());
    for (name, value) in headers {
        if HOP.contains(&name.to_ascii_lowercase().as_str()) {
            continue;
        }
        let mut filled = String::with_capacity(value.len());
        let mut last = 0;
        for c in stand_in().captures_iter(&value) {
            let (whole, slot) = (c.get(0).unwrap(), &c[1]);
            if keys.origin_of(slot).as_deref() != Some(target.as_str()) {
                return Err(format!("the {slot} key goes to its own provider only, not to {target}"));
            }
            let key = keys.key(slot).ok_or_else(|| format!("no {slot} key: connect it in Settings, Providers"))?;
            filled.push_str(&value[last..whole.start()]);
            filled.push_str(&key);
            last = whole.end();
            keyed = true;
        }
        filled.push_str(&value[last..]);
        out.push((name, filled));
    }
    Ok((out, keyed))
}

fn agent(keyed: bool) -> &'static ureq::Agent {
    static KEYED: OnceLock<ureq::Agent> = OnceLock::new();
    static PLAIN: OnceLock<ureq::Agent> = OnceLock::new();
    let build = |redirects| {
        ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(30))
            // a model may think a long while before its first word
            .timeout_read(Duration::from_secs(600))
            .redirects(redirects)
            .build()
    };
    // a request carrying a key never follows a redirect elsewhere
    if keyed { KEYED.get_or_init(|| build(0)) } else { PLAIN.get_or_init(|| build(5)) }
}

/// sends one request and streams its answer to `send` (false: the page is gone)
pub fn run(id: u32, out: Outbound, keys: &KeyStore, send: impl Fn(Event) -> bool) {
    RUNNING.lock().unwrap().push(id);
    if let Err(message) = go(id, out, keys, &send) {
        send(Event::Error { message });
    }
    abort(id);
}

fn go(id: u32, out: Outbound, keys: &KeyStore, send: &impl Fn(Event) -> bool) -> Result<(), String> {
    let (headers, keyed) = with_keys(&out.url, out.headers, keys)?;
    let body = match out.body {
        Some(b) => Some(B64.decode(b).map_err(|_| "unreadable body".to_string())?),
        None => None,
    };
    let mut req = agent(keyed).request(&out.method, &out.url);
    for (name, value) in &headers {
        req = req.set(name, value);
    }
    let sent = match body {
        Some(b) => req.send_bytes(&b),
        None => req.call(),
    };
    let res = match sent {
        Ok(r) | Err(ureq::Error::Status(_, r)) => r,
        Err(ureq::Error::Transport(t)) => return Err(t.to_string()),
    };
    let head: Vec<(String, String)> = res
        .headers_names()
        .into_iter()
        .filter(|n| !HOP.contains(&n.to_ascii_lowercase().as_str()))
        .filter_map(|n| res.header(&n).map(|v| (n.clone(), v.to_string())))
        .collect();
    if !send(Event::Head { status: res.status(), headers: head }) {
        return Ok(());
    }
    let mut reader = res.into_reader();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        if !running(id) {
            return Ok(());
        }
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        if !send(Event::Chunk { data: B64.encode(&buf[..n]) }) {
            return Ok(());
        }
    }
    send(Event::End);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::tests::memory_store;

    fn h(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect()
    }

    #[test]
    fn stand_ins_become_keys_toward_their_provider() {
        let dir = tempfile::tempdir().unwrap();
        let keys = memory_store(&dir);
        keys.route("PUT", &["openai".into()], br#"{"key":"sk-1"}"#).unwrap();
        let (out, keyed) = with_keys(
            "https://api.openai.com/v1/chat/completions",
            h(&[("authorization", "Bearer tramme-key:openai"), ("content-type", "application/json"), ("Content-Length", "3")]),
            &keys,
        )
        .unwrap();
        assert!(keyed);
        assert_eq!(out, h(&[("authorization", "Bearer sk-1"), ("content-type", "application/json")]));
    }

    #[test]
    fn a_key_never_goes_elsewhere() {
        let dir = tempfile::tempdir().unwrap();
        let keys = memory_store(&dir);
        keys.route("PUT", &["openai".into()], br#"{"key":"sk-1"}"#).unwrap();
        for url in ["https://evil.example/v1", "https://api.openai.com.evil.example/", "http://api.openai.com/v1", "https://api.openai.com@evil.example/"] {
            let e = with_keys(url, h(&[("authorization", "Bearer tramme-key:openai")]), &keys).unwrap_err();
            assert!(e.contains("its own provider only"), "{url}: {e}");
        }
        let e = with_keys("https://api.anthropic.com/v1/messages", h(&[("x-api-key", "tramme-key:anthropic")]), &keys).unwrap_err();
        assert!(e.contains("no anthropic key"));
        assert!(with_keys("file:///etc/passwd", vec![], &keys).is_err());
    }

    #[test]
    fn custom_providers_take_their_key_to_their_address() {
        let dir = tempfile::tempdir().unwrap();
        let keys = memory_store(&dir);
        keys.route("PUT", &["custom".into(), "lab".into()], br#"{"label":"Lab","base":"http://localhost:8080/v1","key":"k-lab"}"#).unwrap();
        let (out, _) = with_keys("http://localhost:8080/v1/models", h(&[("authorization", "Bearer tramme-key:custom:lab")]), &keys).unwrap();
        assert_eq!(out, h(&[("authorization", "Bearer k-lab")]));
        assert!(with_keys("http://localhost:9090/v1/models", h(&[("authorization", "Bearer tramme-key:custom:lab")]), &keys).is_err());
    }

    #[test]
    fn requests_without_a_key_go_as_they_are() {
        let dir = tempfile::tempdir().unwrap();
        let keys = memory_store(&dir);
        let (out, keyed) = with_keys("https://cdn.example/picture.png", h(&[("accept", "image/*")]), &keys).unwrap();
        assert!(!keyed);
        assert_eq!(out, h(&[("accept", "image/*")]));
    }
}
