// The tramme project format, version 1, as far as the desktop storage needs
// it: a Rust port of the stable parts of packages/project/src/format.ts
// (manifest, paths, mime, ids, a fresh project). The meaning of the document
// stays checked by the editor, where it runs — this side only parses JSON.

use rand::Rng;
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

pub const PROJECT_FORMAT: &str = "tramme-project/1";
pub const MANIFEST: &str = "tramme.json";
pub const DOCUMENT: &str = "document.tramme.json";
pub const CHAT: &str = ".tramme/chat.json";
pub const CHATS: &str = ".tramme/chats/";
pub const CHAT_INDEX: &str = ".tramme/chats/index.json";

/// limits for one project (packages/project/src/format.ts, LIMITS)
pub const LIMITS: Limits = Limits {
    file: 95 * 1024 * 1024,
    media: 4 * 1024 * 1024 * 1024u64,
    part: 32 * 1024 * 1024,
    archive: 2 * 1024 * 1024 * 1024u64,
    files: 2000,
};

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Limits {
    pub file: u64,
    pub media: u64,
    pub part: u64,
    pub archive: u64,
    pub files: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub format: String,
    pub id: String,
    pub name: String,
    pub created: String,
    pub modified: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
}

const ID: fn(&str) -> bool = |id| {
    let mut chars = id.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit() => {}
        _ => return false,
    }
    (3..=64).contains(&id.len())
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
};

pub fn valid_id(id: &str) -> bool {
    ID(id)
}

/// a conversation file, or the index of conversations
pub fn is_chat_path(path: &str) -> bool {
    if path == CHAT {
        return true;
    }
    if path == CHAT_INDEX {
        return true;
    }
    let Some(rest) = path.strip_prefix(CHATS) else { return false };
    let Some(name) = rest.strip_suffix(".json") else { return false };
    (1..=64).contains(&name.len())
        && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

const EXT: [(&str, &[&str]); 3] = [
    (
        "assets",
        &[
            "png", "jpg", "jpeg", "webp", "gif", "avif", "svg", "ttf", "otf", "woff", "woff2",
            "wav", "mp3", "ogg", "m4a", "flac", "mp4", "webm", "mov", "json", "js", "mjs",
        ],
    ),
    ("plugins", &["js", "mjs"]),
    ("renders", &["mp4", "webm", "mov", "gif", "png", "zip", "json", "svg", "wav"]),
];

pub fn mime_of(path: &str) -> &'static str {
    match extension(path).as_str() {
        "json" => "application/json; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        "flac" => "audio/flac",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

/// the extension as the TypeScript code sees it: lower case (mimeOf, /i regexes)
fn extension(path: &str) -> String {
    match path.rsplit_once('.') {
        Some((_, e)) if !e.is_empty() => e.to_lowercase(),
        _ => String::new(),
    }
}

/// why a path cannot be a file of a project, or None when it can
pub fn path_issue(path: &str) -> Option<String> {
    if path.is_empty() || path.len() > 300 {
        return Some("empty or too long path".into());
    }
    if path.starts_with('/') || path.contains('\\') || has_scheme(path) {
        return Some("absolute path not allowed".into());
    }
    let parts: Vec<&str> = path.split('/').collect();
    if parts.iter().any(|p| p.is_empty() || *p == "." || *p == "..") {
        return Some("invalid path".into());
    }
    if parts.iter().any(|p| {
        p.chars().any(|c| (c as u32) <= 0x1f || "<>:\"|?*".contains(c))
    }) {
        return Some("forbidden character in the path".into());
    }
    if path == MANIFEST || path == DOCUMENT || is_chat_path(path) {
        return None;
    }
    if is_thumbnail(path) {
        return None;
    }
    let Some((place, allowed)) = EXT.iter().find(|(p, _)| *p == parts[0]) else {
        return Some("location not allowed by the format (assets/, plugins/, renders/)".into());
    };
    if parts.len() < 2 {
        return Some("location not allowed by the format (assets/, plugins/, renders/)".into());
    }
    let ext = extension(path);
    if allowed.contains(&ext.as_str()) {
        None
    } else {
        Some(format!("extension .{ext} not allowed in {place}/"))
    }
}

fn is_thumbnail(path: &str) -> bool {
    matches!(path, "thumbnail.webp" | "thumbnail.png" | "thumbnail.jpg")
}

/// `/^[a-z]+:/i` — a scheme prefix makes a path absolute
fn has_scheme(path: &str) -> bool {
    match path.find(':') {
        Some(0) => false,
        Some(n) => path[..n].chars().all(|c| c.is_ascii_alphabetic()),
        None => false,
    }
}

/// a sound or a video of the project: large, sent in parts on the web
/// (`/^(assets|renders)\/.+\.(wav|…)$/i`) — the multipart uploads (which use it)
/// are not wired in the desktop app yet
#[allow(dead_code)]
pub fn is_media(path: &str) -> bool {
    let Some(rest) = path.strip_prefix("assets/").or_else(|| path.strip_prefix("renders/")) else {
        return false;
    };
    match rest.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => matches!(
            ext.to_lowercase().as_str(),
            "wav" | "mp3" | "ogg" | "m4a" | "flac" | "mp4" | "webm" | "mov"
        ),
        _ => false,
    }
}

/// the largest size admitted for a file at this path
#[allow(dead_code)]
pub fn max_size(path: &str) -> u64 {
    if is_media(path) { LIMITS.media } else { LIMITS.file }
}

/// a fresh id: readable from the name, unique enough for one person's projects
pub fn new_id(name: &str) -> String {
    let lowered: String = name
        .nfd()
        .filter(|c| {
            let u = *c as u32;
            !(0x0300..=0x036F).contains(&u)
        })
        .collect::<String>()
        .to_lowercase();
    let mut base: String = lowered
        .chars()
        .map(|c| if c.is_ascii_lowercase() || c.is_ascii_digit() { c } else { '-' })
        .collect();
    base = base.trim_matches('-').to_string();
    let base: String = base.chars().take(40).collect();
    let base = if base.chars().count() < 3 { "project" } else { base.as_str() };
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut rng = rand::thread_rng();
    let suffix: String = (0..6).map(|_| DIGITS[rng.gen_range(0..36)] as char).collect();
    format!("{base}-{suffix}")
}

/// manifest and document of a new, empty project (newProject in format.ts)
pub fn new_project(
    name: &str,
    width: i64,
    height: i64,
    fps: i64,
    duration: f64,
    id: &str,
) -> (Manifest, serde_json::Value) {
    let now = now_iso();
    let manifest = Manifest {
        format: PROJECT_FORMAT.into(),
        id: id.into(),
        name: name.into(),
        created: now.clone(),
        modified: now,
        width: Some(width),
        height: Some(height),
        duration: Some(duration),
        thumbnail: None,
        app: Some("tramme".into()),
    };
    let doc = serde_json::json!({
        "schema": "tramme/1",
        "meta": { "title": name },
        "tokens": {
            "background": { "type": "color", "value": "#0E0F12" },
            "text": { "type": "color", "value": "#F4F5F7" },
            "accent": { "type": "color", "value": "#2EC4B6" },
            "smooth": { "type": "ease", "value": [0.42, 0, 0.58, 1] },
            "snappy": { "type": "ease", "value": [0.16, 1, 0.3, 1] },
        },
        "assets": {},
        "root": "main",
        "compositions": {
            "main": {
                "name": name,
                "width": width,
                "height": height,
                "fps": fps,
                "duration": duration,
                "background": "@background",
                "motionBlur": { "samples": 8, "shutter": 0.5 },
                "layers": {},
                "order": [],
            },
        },
    });
    (manifest, doc)
}

/// the manifest as JSON, exactly like the Worker writes it
pub fn manifest_json(m: &Manifest) -> String {
    let mut s = serde_json::to_string_pretty(m).unwrap();
    s.push('\n');
    s
}

/// the manifest read back: today's format only (a legacy project is upgraded
/// by the editor when its archive is imported, never on disk here)
pub fn parse_manifest(data: &[u8]) -> Result<Manifest, String> {
    let text = std::str::from_utf8(data).map_err(|_| "manifest is not UTF-8".to_string())?;
    let m: Manifest = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if m.format != PROJECT_FORMAT {
        return Err(format!("unknown project format: {}", m.format));
    }
    if !valid_id(&m.id) {
        return Err("invalid project id".into());
    }
    if m.name.is_empty() || m.name.chars().count() > 200 {
        return Err("invalid project name".into());
    }
    Ok(m)
}

/// an ISO date like the editor's `new Date().toISOString()`
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// a file's modification date, as the API sends it
pub fn iso_of(mtime: std::time::SystemTime) -> String {
    let t: chrono::DateTime<chrono::Utc> = mtime.into();
    t.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_issue_matches_the_typescript_rules() {
        assert!(path_issue("").is_some());
        assert!(path_issue("/etc/passwd").is_some());
        assert!(path_issue("assets\\x.png").is_some());
        assert!(path_issue("https://x/y.png").is_some());
        assert!(path_issue("assets/../secret.png").is_some());
        assert!(path_issue("assets//x.png").is_some());
        assert!(path_issue("tramme.json").is_none());
        assert!(path_issue("document.tramme.json").is_none());
        assert!(path_issue(".tramme/chat.json").is_none());
        assert!(path_issue(".tramme/chats/abc-1.json").is_none());
        assert!(path_issue(".tramme/chats/BAD.json").is_some());
        assert!(path_issue("thumbnail.webp").is_none());
        assert!(path_issue("thumbnail.txt").is_some());
        assert!(path_issue("assets/images/x.png").is_none());
        assert!(path_issue("assets/x.exe").is_some());
        assert!(path_issue("plugins/tool.mjs").is_none());
        assert!(path_issue("plugins/tool.wasm").is_some());
        assert!(path_issue("renders/x.mp4").is_none());
        assert!(path_issue("renders/x.svg").is_none());
        assert!(path_issue("renders/renders/x.png").is_none());
        assert!(path_issue("elsewhere/x.png").is_some());
        assert!(path_issue("assets").is_some());
    }

    #[test]
    fn ids_read_from_the_name() {
        assert_eq!(new_id("Mon Projet Été!").starts_with("mon-projet-ete-"), true);
        assert_eq!(new_id("ab").starts_with("project-"), true);
        let id = new_id("x");
        assert!(valid_id(&id), "{id}");
    }

    #[test]
    fn valid_ids_only() {
        assert!(valid_id("abc"));
        assert!(valid_id("a1-b2"));
        assert!(!valid_id("ab"));
        assert!(!valid_id("Abc"));
        assert!(!valid_id("abc_def"));
        assert!(!valid_id("-abc"));
    }

    #[test]
    fn media_and_sizes() {
        assert!(is_media("assets/video/x.mp4"));
        assert!(is_media("assets/x.mp4"));
        assert!(is_media("renders/X.MP4"));
        assert!(!is_media("assets/.mp4"));
        assert!(!is_media("assets/images/x.png"));
        assert!(!is_media("assets/fonts/x.wav.txt"));
        assert_eq!(max_size("assets/images/x.png"), LIMITS.file);
        assert_eq!(max_size("assets/video/x.mp4"), LIMITS.media);
    }

    #[test]
    fn mime_of_the_known_extensions() {
        assert_eq!(mime_of("document.tramme.json"), "application/json; charset=utf-8");
        assert_eq!(mime_of("assets/images/x.svg"), "image/svg+xml");
        assert_eq!(mime_of("assets/fonts/x.woff2"), "font/woff2");
        assert_eq!(mime_of("x.unknown"), "application/octet-stream");
    }

    #[test]
    fn manifest_round_trip_keeps_optional_keys_out() {
        let m = serde_json::json!({
            "format": "tramme-project/1", "id": "abc-123", "name": "Test",
            "created": "2026-01-01T00:00:00.000Z", "modified": "2026-01-01T00:00:00.000Z",
        });
        let parsed = parse_manifest(m.to_string().as_bytes()).unwrap();
        assert_eq!(parsed.thumbnail, None);
        let back = manifest_json(&parsed);
        assert!(back.contains("\"format\": \"tramme-project/1\""));
        assert!(!back.contains("thumbnail"));
        assert!(parse_manifest(b"{}").is_err());
        assert!(parse_manifest(b"{\"format\":\"tramme-project/1\"}").is_err());
    }
}
