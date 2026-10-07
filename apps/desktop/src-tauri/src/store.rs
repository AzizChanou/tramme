// Projects on the local disk, with the semantics of the API (packages/api):
// every file of project <id> lives at <home>/projects/<id>/<path> — the
// mirror of the Worker's R2 prefix. The manifest is kept here (dates, size of
// the main composition); the editor writes the document and the other files.
// The shared libraries (plugins, sounds) live at <home>/library/<shelf>/<name>.

use crate::format::{self, Manifest, LIMITS, MANIFEST, DOCUMENT};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};

/// an error as the API answers it: its status and message
#[derive(Debug)]
pub struct HttpError {
    pub status: u16,
    pub message: String,
}

pub type Res<T> = Result<T, HttpError>;

pub fn http_err<T>(status: u16, message: impl Into<String>) -> Res<T> {
    Err(HttpError { status, message: message.into() })
}

/// where the projects live: a Tramme folder in the user's documents, or
/// TRAMME_HOME (a custom place, the tests)
pub fn home() -> PathBuf {
    if let Ok(h) = std::env::var("TRAMME_HOME") {
        if !h.trim().is_empty() {
            return PathBuf::from(h);
        }
    }
    let mut p = dirs::document_dir().expect("no documents folder on this machine");
    p.push("Tramme");
    p
}

pub struct Store {
    home: PathBuf,
}

/// a file of a project, as the API lists them
#[derive(Debug, Clone, Serialize)]
pub struct Stored {
    pub path: String,
    pub size: u64,
    pub etag: String,
    pub modified: String,
}

#[derive(Debug, Default, Deserialize)]
pub struct CreateBody {
    #[serde(default)]
    pub name: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub fps: Option<i64>,
    pub duration: Option<f64>,
    #[serde(default)]
    pub created: Option<String>,
    #[serde(default)]
    pub empty: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpdateBody {
    pub name: Option<String>,
    pub thumbnail: Option<Option<String>>,
}

#[derive(Debug, Default, Deserialize)]
pub struct DuplicateBody {
    #[serde(default)]
    pub name: Option<String>,
}

/// the files of a project, for the export archive
struct FileData {
    path: String,
    data: Vec<u8>,
}

/// a file read whole from the project folder
struct Walked {
    path: String,
    data: Vec<u8>,
    modified: String,
}

fn etag_of(data: &[u8]) -> String {
    let h = Sha256::digest(data);
    let hex: String = h[..8].iter().map(|b| format!("{b:02x}")).collect();
    format!("\"{hex}\"")
}

/// an etag header (If-Match, If-None-Match) against a quoted etag
pub fn etag_matches(header: &str, etag: &str) -> bool {
    header.split(',').any(|t| {
        let t = t.trim();
        if t == "*" {
            return true;
        }
        let t = t.strip_prefix("W/").unwrap_or(t);
        t.trim_matches('"') == etag.trim_matches('"')
    })
}

/// `bytes=a-b`, `bytes=a-`, `bytes=-n`; anything else reads whole
#[derive(Debug, Clone, Copy)]
pub enum Range {
    Offset { offset: u64, length: Option<u64> },
    Suffix(u64),
}

pub fn parse_range(header: &str) -> Option<Range> {
    let spec = header.trim().strip_prefix("bytes=")?.trim();
    if spec.contains(',') {
        return None;
    }
    let (start, end) = spec.split_once('-')?;
    if start.is_empty() {
        let suffix: u64 = end.trim().parse().ok()?;
        return Some(Range::Suffix(suffix));
    }
    let offset: u64 = start.trim().parse().ok()?;
    let length = match end.trim().parse::<u64>() {
        Ok(e) if e >= offset => Some(e - offset + 1),
        Ok(_) => return None,
        Err(_) => None,
    };
    Some(Range::Offset { offset, length })
}

impl Store {
    pub fn new() -> Store {
        Store { home: home() }
    }

    /// a store somewhere else (the tests)
    #[allow(dead_code)]
    pub fn with_home(home: PathBuf) -> Store {
        Store { home }
    }

    fn project_dir(&self, id: &str) -> PathBuf {
        self.home.join("projects").join(id)
    }

    /// `path` is checked (format::path_issue) before it reaches here
    fn file_path(&self, id: &str, path: &str) -> PathBuf {
        let mut p = self.project_dir(id);
        for part in path.split('/') {
            p.push(part);
        }
        p
    }

    pub fn check_id(&self, id: &str) -> Res<()> {
        if format::valid_id(id) {
            Ok(())
        } else {
            http_err(400, "invalid project id")
        }
    }

    pub fn check_path(&self, path: &str) -> Res<()> {
        match format::path_issue(path) {
            None => Ok(()),
            Some(bad) => http_err(400, format!("{path} : {bad}")),
        }
    }

    // ── files ────────────────────────────────────────────────────

    fn head(&self, id: &str, path: &str) -> Option<Stored> {
        let p = self.file_path(id, path);
        let meta = fs::metadata(&p).ok()?;
        if !meta.is_file() {
            return None;
        }
        Some(Stored {
            path: path.into(),
            size: meta.len(),
            etag: etag_of(&fs::read(&p).ok()?),
            modified: format::iso_of(meta.modified().ok()?),
        })
    }

    fn read(&self, id: &str, path: &str) -> Option<(Vec<u8>, Stored)> {
        let p = self.file_path(id, path);
        let data = fs::read(&p).ok()?;
        let meta = fs::metadata(&p).ok()?;
        let stored = Stored {
            path: path.into(),
            size: data.len() as u64,
            etag: etag_of(&data),
            modified: format::iso_of(meta.modified().ok()?),
        };
        Some((data, stored))
    }

    /// every file of a project, as `projects/<id>/<path>` lists them
    fn all_files(&self, id: &str) -> Vec<Stored> {
        self.walk_project(id)
            .into_iter()
            .map(|w| Stored {
                path: w.path,
                size: w.data.len() as u64,
                etag: etag_of(&w.data),
                modified: w.modified,
            })
            .collect()
    }

    fn all_file_data(&self, id: &str) -> Vec<FileData> {
        self.walk_project(id)
            .into_iter()
            .map(|w| FileData { path: w.path, data: w.data })
            .collect()
    }

    fn walk_project(&self, id: &str) -> Vec<Walked> {
        fn walk(dir: &Path, rel: &str, out: &mut Vec<Walked>) {
            let Ok(entries) = fs::read_dir(dir) else { return };
            for e in entries.flatten() {
                let name = e.file_name().to_string_lossy().into_owned();
                if name.starts_with(".tmp-") {
                    continue; // a write in flight, never a file of the project
                }
                let child_rel = if rel.is_empty() { name } else { format!("{rel}/{name}") };
                let child = e.path();
                if child.is_dir() {
                    walk(&child, &child_rel, out);
                } else if child.is_file() {
                    let Ok(data) = fs::read(&child) else { continue };
                    let modified = e
                        .metadata()
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .map(format::iso_of)
                        .unwrap_or_default();
                    out.push(Walked { path: child_rel, data, modified });
                }
            }
        }
        let mut out = Vec::new();
        walk(&self.project_dir(id), "", &mut out);
        out
    }

    fn put(&self, id: &str, path: &str, data: &[u8]) -> Res<Stored> {
        let p = self.file_path(id, path);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).map_err(io_err)?;
        }
        // write beside, then rename: a reader never sees a half-written file
        let name = p.file_name().unwrap_or_default().to_string_lossy().into_owned();
        let tmp = p.with_file_name(format!(".tmp-{name}"));
        {
            let mut f = fs::File::create(&tmp).map_err(io_err)?;
            f.write_all(data).map_err(io_err)?;
            f.sync_all().ok();
        }
        fs::rename(&tmp, &p).map_err(|e| {
            fs::remove_file(&tmp).ok();
            io_err(e)
        })?;
        Ok(Stored {
            path: path.into(),
            size: data.len() as u64,
            etag: etag_of(data),
            modified: format::now_iso(),
        })
    }

    // ── the manifest, kept here like the Worker keeps it ─────────

    pub fn read_manifest(&self, id: &str) -> Res<Manifest> {
        self.check_id(id)?;
        let data = match fs::read(self.file_path(id, MANIFEST)) {
            Ok(d) => d,
            Err(_) => return http_err(404, "project not found"),
        };
        match format::parse_manifest(&data) {
            Ok(m) => Ok(m),
            Err(e) => {
                eprintln!("desktop: unreadable manifest of {id}: {e}");
                http_err(500, "unreadable project manifest")
            }
        }
    }

    fn write_manifest(&self, m: &Manifest) -> Res<()> {
        let text = format::manifest_json(m);
        let dir = self.project_dir(&m.id);
        fs::create_dir_all(&dir).map_err(io_err)?;
        fs::write(dir.join(MANIFEST), text).map_err(io_err)
    }

    fn free_id(&self, name: &str) -> String {
        loop {
            let id = format::new_id(name);
            if !self.project_dir(&id).exists() {
                return id;
            }
        }
    }

    fn touch(&self, m: &mut Manifest) -> Res<()> {
        m.modified = format::now_iso();
        self.write_manifest(m)
    }

    // ── projects ─────────────────────────────────────────────────

    pub fn list_projects(&self) -> Res<Vec<Manifest>> {
        let dir = self.home.join("projects");
        let mut out = Vec::new();
        if dir.is_dir() {
            for e in fs::read_dir(&dir).map_err(io_err)? {
                let Ok(e) = e else { continue };
                if !e.path().is_dir() {
                    continue;
                }
                let id = e.file_name().to_string_lossy().into_owned();
                if !format::valid_id(&id) {
                    continue;
                }
                match self.read_manifest(&id) {
                    Ok(m) => out.push(m),
                    Err(_) => { /* a project without a readable manifest is not listed */ }
                }
            }
        }
        out.sort_by(|a, b| b.modified.cmp(&a.modified));
        Ok(out)
    }

    pub fn create_project(&self, body: CreateBody) -> Res<Manifest> {
        let name = body.name.unwrap_or_default().trim().to_string();
        if name.is_empty() || name.chars().count() > 200 {
            return http_err(400, "project name required (200 characters at most)");
        }
        let int = |v: Option<i64>, d: i64, max: i64| match v {
            Some(v) if (1..=max).contains(&v) => v,
            _ => d,
        };
        let width = int(body.width, 1920, 8192);
        let height = int(body.height, 1080, 8192);
        let fps = int(body.fps, 30, 240);
        let duration = match body.duration {
            Some(d) if d > 0.0 && d <= 3600.0 => d,
            _ => 5.0,
        };
        let id = self.free_id(&name);
        let (mut manifest, doc) = format::new_project(&name, width, height, fps, duration, &id);
        if let Some(created) = body.created.filter(|c| chrono::DateTime::parse_from_rfc3339(c).is_ok()) {
            manifest.created = created;
        }
        if !body.empty {
            let text = serde_json::to_string_pretty(&doc).unwrap() + "\n";
            self.put(&id, DOCUMENT, text.as_bytes())?;
        }
        self.write_manifest(&manifest)?;
        Ok(manifest)
    }

    pub fn project_info(&self, id: &str) -> Res<(Manifest, Vec<Stored>)> {
        let manifest = self.read_manifest(id)?;
        Ok((manifest, self.all_files(id)))
    }

    pub fn update_project(&self, id: &str, body: UpdateBody) -> Res<Manifest> {
        let mut m = self.read_manifest(id)?;
        if let Some(name) = body.name {
            let name = name.trim().to_string();
            if name.is_empty() || name.chars().count() > 200 {
                return http_err(400, "invalid name");
            }
            m.name = name;
        }
        match body.thumbnail {
            Some(None) => m.thumbnail = None,
            Some(Some(t)) => {
                if !matches!(t.as_str(), "thumbnail.webp" | "thumbnail.png" | "thumbnail.jpg") {
                    return http_err(400, "thumbnail: thumbnail.webp, .png or .jpg");
                }
                m.thumbnail = Some(t);
            }
            None => {}
        }
        self.touch(&mut m)?;
        Ok(m)
    }

    pub fn delete_project(&self, id: &str) -> Res<usize> {
        let _ = self.read_manifest(id)?;
        let files = self.all_files(id).len();
        fs::remove_dir_all(self.project_dir(id)).map_err(io_err)?;
        Ok(files)
    }

    pub fn duplicate_project(&self, id: &str, body: DuplicateBody) -> Res<Manifest> {
        let src = self.read_manifest(id)?;
        let name = body
            .name
            .unwrap_or_else(|| format!("{} (copy)", src.name))
            .trim()
            .chars()
            .take(200)
            .collect::<String>();
        let now = format::now_iso();
        let m = Manifest {
            format: src.format.clone(),
            id: self.free_id(&name),
            name,
            created: now.clone(),
            modified: now,
            width: src.width,
            height: src.height,
            duration: src.duration,
            thumbnail: src.thumbnail.clone(),
            app: src.app.clone(),
        };
        for f in self.all_file_data(id) {
            if f.path == MANIFEST || f.path.starts_with("renders/") || format::is_chat_path(&f.path) {
                continue;
            }
            self.put(&m.id, &f.path, &f.data)?;
        }
        self.write_manifest(&m)?;
        Ok(m)
    }

    /// the project as a .tramme archive: a zip of its files, renders/ left out,
    /// media stored as they are (already compressed)
    pub fn export_project(&self, id: &str) -> Res<(String, Vec<u8>)> {
        let m = self.read_manifest(id)?;
        let files: Vec<FileData> = self
            .all_file_data(id)
            .into_iter()
            .filter(|f| !f.path.starts_with("renders/"))
            .collect();
        let buffer = zip_files(&files).map_err(|e| HttpError { status: 500, message: format!("export failed: {e}") })?;
        let bad = |c: char| (c as u32) <= 0x1f || "\\/:*?\"<>|".contains(c);
        let file = format!("{}.tramme", m.name.replace(bad, "-"));
        Ok((file, buffer))
    }

    // ── files of a project ───────────────────────────────────────

    pub fn get_file(&self, id: &str, path: &str) -> Res<(Vec<u8>, Stored)> {
        self.check_id(id)?;
        self.check_path(path)?;
        match self.read(id, path) {
            Some(r) => Ok(r),
            None => http_err(404, format!("file not found: {path}")),
        }
    }

    pub fn put_file(&self, id: &str, path: &str, data: &[u8], if_match: Option<&str>) -> Res<(Stored, String)> {
        let mut m = self.read_manifest(id)?;
        self.check_path(path)?;
        if path == MANIFEST {
            return http_err(403, "the manifest is kept by the server");
        }
        if data.len() as u64 > LIMITS.file {
            return http_err(413, "file too large");
        }
        // the document drives the manifest's size of the main composition;
        // its full schema stays checked by the editor, where it runs
        if path == DOCUMENT {
            let text = std::str::from_utf8(data).map_err(|_| HttpError { status: 422, message: "UTF-8 text expected".into() })?;
            let doc: serde_json::Value = serde_json::from_str(text)
                .map_err(|e| HttpError { status: 422, message: format!("unreadable document: {e}") })?;
            if let Some(root) = doc.get("root").and_then(|r| r.as_str()) {
                if let Some(c) = doc.pointer(&format!("/compositions/{root}")) {
                    m.width = c.get("width").and_then(|v| v.as_i64());
                    m.height = c.get("height").and_then(|v| v.as_i64());
                    m.duration = c.get("duration").and_then(|v| v.as_f64());
                }
            }
        } else if format::is_chat_path(path) {
            let text = std::str::from_utf8(data).map_err(|_| HttpError { status: 422, message: "UTF-8 text expected".into() })?;
            serde_json::from_str::<serde::de::IgnoredAny>(text)
                .map_err(|_| HttpError { status: 422, message: "unreadable JSON".into() })?;
        }
        // If-Match: refuse to overwrite a version this client has not seen (another window)
        if let Some(header) = if_match {
            let fresh = self.head(id, path).map(|s| s.etag).unwrap_or_default();
            if !etag_matches(header, &fresh) {
                return http_err(412, "the file changed elsewhere since it was opened");
            }
        }
        let stored = self.put(id, path, data)?;
        let mut modified = stored.modified.clone();
        if !path.starts_with("renders/") {
            self.touch(&mut m)?;
            modified = m.modified.clone();
        }
        Ok((stored, modified))
    }

    pub fn delete_file(&self, id: &str, path: &str) -> Res<()> {
        let mut m = self.read_manifest(id)?;
        self.check_path(path)?;
        if path == MANIFEST || path == DOCUMENT {
            return http_err(403, "the manifest and the document cannot be deleted");
        }
        let p = self.file_path(id, path);
        if p.is_file() {
            fs::remove_file(p).map_err(io_err)?;
        }
        if m.thumbnail.as_deref() == Some(path) {
            m.thumbnail = None;
        }
        self.touch(&mut m)
    }

    // ── the shared libraries (plugins, sounds) ───────────────────

    fn shelf_dir(&self, shelf: &str) -> PathBuf {
        self.home.join("library").join(shelf)
    }

    /// the description kept beside a sound (x-tramme-entry): one JSON file for
    /// the shelf, outside its folder so listings stay the files themselves
    fn entries_path(&self, shelf: &str) -> PathBuf {
        self.home.join("library").join(format!(".entries-{shelf}.json"))
    }

    fn read_entries(&self, shelf: &str) -> serde_json::Map<String, serde_json::Value> {
        fs::read(self.entries_path(shelf))
            .ok()
            .and_then(|d| serde_json::from_slice(&d).ok())
            .unwrap_or_default()
    }

    fn write_entries(&self, shelf: &str, entries: &serde_json::Map<String, serde_json::Value>) -> Res<()> {
        let p = self.entries_path(shelf);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).map_err(io_err)?;
        }
        fs::write(p, serde_json::to_string(entries).unwrap()).map_err(io_err)
    }

    pub fn shelf_list(&self, shelf: &str) -> Res<Vec<serde_json::Value>> {
        let described = shelf == "sounds";
        let entries = if described { self.read_entries(shelf) } else { Default::default() };
        let mut out = Vec::new();
        let dir = self.shelf_dir(shelf);
        if dir.is_dir() {
            for e in fs::read_dir(&dir).map_err(io_err)? {
                let Ok(e) = e else { continue };
                if !e.path().is_file() {
                    continue;
                }
                let name = e.file_name().to_string_lossy().into_owned();
                let Ok(meta) = e.metadata() else { continue };
                let mut item = json!({
                    "name": name,
                    "size": meta.len(),
                    "modified": format::iso_of(meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH)),
                });
                if described {
                    if let Some(entry) = entries.get(&name) {
                        item.as_object_mut().unwrap().insert("entry".into(), entry.clone());
                    }
                }
                out.push(item);
            }
        }
        out.sort_by(|a, b| {
            let an = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let bn = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
            an.cmp(bn)
        });
        Ok(out)
    }

    pub fn shelf_get(&self, shelf: &str, name: &str) -> Res<Vec<u8>> {
        match fs::read(self.shelf_dir(shelf).join(name)) {
            Ok(d) => Ok(d),
            Err(_) => http_err(404, format!("no {} \"{name}\" in the library", shelf_item(shelf))),
        }
    }

    pub fn shelf_put(&self, shelf: &str, name: &str, data: &[u8], entry: Option<&str>) -> Res<u64> {
        let dir = self.shelf_dir(shelf);
        fs::create_dir_all(&dir).map_err(io_err)?;
        fs::write(dir.join(name), data).map_err(io_err)?;
        if shelf == "sounds" {
            let mut entries = self.read_entries(shelf);
            match entry {
                Some(e) => {
                    entries.insert(name.into(), serde_json::from_str(e).unwrap_or(json!(null)));
                }
                None => {
                    entries.remove(name);
                }
            }
            self.write_entries(shelf, &entries)?;
        }
        Ok(data.len() as u64)
    }

    pub fn shelf_delete(&self, shelf: &str, name: &str) -> Res<()> {
        let p = self.shelf_dir(shelf).join(name);
        if p.is_file() {
            fs::remove_file(p).map_err(io_err)?;
        }
        if shelf == "sounds" {
            let mut entries = self.read_entries(shelf);
            entries.remove(name);
            self.write_entries(shelf, &entries)?;
        }
        Ok(())
    }
}

fn shelf_item(shelf: &str) -> &'static str {
    if shelf == "sounds" { "sound" } else { "plugin" }
}

fn io_err(e: std::io::Error) -> HttpError {
    eprintln!("desktop: storage error: {e}");
    HttpError { status: 500, message: "storage error".into() }
}

/// the media extensions keep their bytes in the archive (already compressed)
fn stored_uncompressed(path: &str) -> bool {
    matches!(
        path.rsplit_once('.').map(|(_, e)| e.to_lowercase()).as_deref(),
        Some("png" | "jpg" | "jpeg" | "webp" | "gif" | "avif" | "mp3" | "ogg" | "m4a" | "mp4" | "webm" | "mov" | "woff" | "woff2")
    )
}

fn zip_files(files: &[FileData]) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    use std::io::Cursor;
    use zip::CompressionMethod;
    use zip::ZipWriter;
    use zip::write::SimpleFileOptions;

    let mut w = ZipWriter::new(Cursor::new(Vec::new()));
    for f in files {
        let method = if stored_uncompressed(&f.path) { CompressionMethod::Stored } else { CompressionMethod::Deflated };
        w.start_file(f.path.as_str(), SimpleFileOptions::default().compression_method(method))?;
        w.write_all(&f.data)?;
    }
    Ok(w.finish()?.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (Store, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        (Store::with_home(dir.path().to_path_buf()), dir)
    }

    fn create(store: &Store) -> Manifest {
        store
            .create_project(CreateBody {
                name: Some("Testé".into()),
                ..Default::default()
            })
            .unwrap()
    }

    #[test]
    fn create_then_list_then_info() {
        let (store, _dir) = store();
        let m = create(&store);
        assert_eq!(m.name, "Testé");
        assert!(format::valid_id(&m.id));
        assert_eq!(store.list_projects().unwrap().len(), 1);
        let (m2, files) = store.project_info(&m.id).unwrap();
        assert_eq!(m2.id, m.id);
        assert_eq!(m2.width, Some(1920));
        assert!(files.iter().any(|f| f.path == DOCUMENT));
        assert!(files.iter().any(|f| f.path == MANIFEST));
    }

    #[test]
    fn document_write_updates_the_manifest_size() {
        let (store, _dir) = store();
        let m = create(&store);
        let doc = json!({
            "schema": "tramme/1", "meta": {}, "tokens": {}, "assets": {},
            "root": "main",
            "compositions": { "main": { "name": "x", "width": 640, "height": 360, "fps": 24, "duration": 2.5, "layers": {}, "order": [] } },
        });
        let (stored, _) = store.put_file(&m.id, DOCUMENT, serde_json::to_string(&doc).unwrap().as_bytes(), None).unwrap();
        assert!(!stored.etag.is_empty());
        let m2 = store.read_manifest(&m.id).unwrap();
        assert_eq!((m2.width, m2.height, m2.duration), (Some(640), Some(360), Some(2.5)));
    }

    #[test]
    fn if_match_guards_a_write() {
        let (store, _dir) = store();
        let m = create(&store);
        let (s1, _) = store.put_file(&m.id, "assets/images/a.png", b"one", None).unwrap();
        // a write with the etag just read goes through
        let (s2, _) = store.put_file(&m.id, "assets/images/a.png", b"two", Some(&s1.etag)).unwrap();
        assert_ne!(s1.etag, s2.etag);
        // a write with an older etag is refused
        let e = store.put_file(&m.id, "assets/images/a.png", b"three", Some(&s1.etag)).unwrap_err();
        assert_eq!(e.status, 412);
        assert_eq!(store.get_file(&m.id, "assets/images/a.png").unwrap().0, b"two");
    }

    #[test]
    fn etag_headers_match() {
        assert!(etag_matches("\"abc\"", "\"abc\""));
        assert!(etag_matches("*", "\"abc\""));
        assert!(etag_matches("W/\"abc\", \"def\"", "\"abc\""));
        assert!(!etag_matches("\"abd\"", "\"abc\""));
        assert!(parse_range("bytes=0-99").is_some());
        assert!(parse_range("bytes=-500").is_some());
        assert!(parse_range("bytes=100-").is_some());
        assert!(parse_range("bytes=5-2").is_none());
    }

    #[test]
    fn manifest_and_document_are_protected() {
        let (store, _dir) = store();
        let m = create(&store);
        assert_eq!(store.put_file(&m.id, MANIFEST, b"{}", None).unwrap_err().status, 403);
        assert_eq!(store.delete_file(&m.id, DOCUMENT).unwrap_err().status, 403);
        assert_eq!(store.delete_file(&m.id, MANIFEST).unwrap_err().status, 403);
    }

    #[test]
    fn duplicate_copies_but_not_renders_and_chats() {
        let (store, _dir) = store();
        let m = create(&store);
        store.put_file(&m.id, "assets/images/a.png", b"img", None).unwrap();
        store.put_file(&m.id, "renders/out.mp4", b"video", None).unwrap();
        store.put_file(&m.id, ".tramme/chats/c1.json", b"{}", None).unwrap();
        let copy = store.duplicate_project(&m.id, DuplicateBody::default()).unwrap();
        assert_ne!(copy.id, m.id);
        assert!(copy.name.contains("copy"));
        let (_, files) = store.project_info(&copy.id).unwrap();
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert!(paths.contains(&"assets/images/a.png"));
        assert!(!paths.contains(&"renders/out.mp4"));
        assert!(!paths.contains(&".tramme/chats/c1.json"));
    }

    #[test]
    fn export_zips_the_project_without_renders() {
        let (store, _dir) = store();
        let m = create(&store);
        store.put_file(&m.id, "assets/images/a.png", b"img", None).unwrap();
        store.put_file(&m.id, "renders/out.mp4", b"video", None).unwrap();
        let (file, bytes) = store.export_project(&m.id).unwrap();
        assert_eq!(file, "Testé.tramme");
        assert!(bytes.len() > 100);
        // a zip starts with the local file header signature
        assert_eq!(&bytes[..4], &[0x50, 0x4b, 0x03, 0x04]);
    }

    #[test]
    fn shelves_keep_their_sounds_and_entries() {
        let (store, _dir) = store();
        assert_eq!(store.shelf_list("sounds").unwrap().len(), 0);
        store.shelf_put("sounds", "click.wav", b"audio", Some(r#"{"kind":"sfx"}"#)).unwrap();
        let list = store.shelf_list("sounds").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].get("name").unwrap(), "click.wav");
        assert_eq!(list[0].get("entry").unwrap().get("kind").unwrap(), "sfx");
        assert_eq!(store.shelf_get("sounds", "click.wav").unwrap(), b"audio");
        store.shelf_delete("sounds", "click.wav").unwrap();
        assert_eq!(store.shelf_list("sounds").unwrap().len(), 0);
        assert!(store.shelf_get("sounds", "click.wav").is_err());
    }

    #[test]
    fn delete_project_removes_everything() {
        let (store, _dir) = store();
        let m = create(&store);
        store.put_file(&m.id, "assets/images/a.png", b"img", None).unwrap();
        assert_eq!(store.delete_project(&m.id).unwrap(), 3);
        assert_eq!(store.delete_project(&m.id).unwrap_err().status, 404);
        assert!(store.list_projects().unwrap().is_empty());
    }

    #[test]
    fn update_rename_and_thumbnail() {
        let (store, _dir) = store();
        let m = create(&store);
        store.put_file(&m.id, "thumbnail.webp", b"pic", None).unwrap();
        let m2 = store.update_project(&m.id, UpdateBody { name: Some("Autre".into()), thumbnail: Some(Some("thumbnail.webp".into())) }).unwrap();
        assert_eq!(m2.name, "Autre");
        assert_eq!(m2.thumbnail.as_deref(), Some("thumbnail.webp"));
        assert_eq!(store.update_project(&m.id, UpdateBody { name: None, thumbnail: Some(Some("other.webp".into())) }).unwrap_err().status, 400);
        let m3 = store.update_project(&m.id, UpdateBody { name: None, thumbnail: Some(None) }).unwrap();
        assert_eq!(m3.thumbnail, None);
    }
}
