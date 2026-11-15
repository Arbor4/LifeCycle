use std::collections::VecDeque;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use regex::Regex;

use crate::error::Result;

#[derive(Debug, Clone, serde::Serialize)]
pub struct LogLine {
    /// Byte offset just past this line in the log file; used as incremental cursor.
    pub cursor: u64,
    pub text: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LogPage {
    pub lines: Vec<LogLine>,
    pub next_cursor: u64,
}

#[derive(Debug)]
pub struct RingBuffer {
    cap: usize,
    lines: VecDeque<String>,
}

impl RingBuffer {
    pub fn new(cap: usize) -> Self {
        Self {
            cap: cap.max(1),
            lines: VecDeque::new(),
        }
    }

    pub fn push(&mut self, line: impl Into<String>) {
        if self.lines.len() == self.cap {
            self.lines.pop_front();
        }
        self.lines.push_back(line.into());
    }

    pub fn tail(&self, n: usize) -> Vec<String> {
        self.lines
            .iter()
            .skip(self.lines.len().saturating_sub(n))
            .cloned()
            .collect()
    }

    pub fn len(&self) -> usize {
        self.lines.len()
    }

    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }
}

/// Logs live in files written directly by child processes; the hub only reads.
#[derive(Debug, Clone)]
pub struct LogHub {
    dir: PathBuf,
}

impl LogHub {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    pub fn path(&self, profile: &str, source: &str) -> PathBuf {
        self.dir.join(format!("{profile}-{source}.log"))
    }

    /// Last `lines` lines of the file, optionally regex-filtered.
    pub fn tail(
        &self,
        profile: &str,
        source: &str,
        lines: usize,
        filter: Option<&Regex>,
    ) -> Result<LogPage> {
        let path = self.path(profile, source);
        let mut file = match std::fs::File::open(&path) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(LogPage {
                    lines: Vec::new(),
                    next_cursor: 0,
                });
            }
            Err(e) => return Err(e.into()),
        };
        let len = file.metadata()?.len();
        // Unfiltered tail only needs the end of the file; avoid reading megabytes.
        let (base, content) = match filter {
            None => {
                let window = (lines as u64).saturating_mul(256).min(len);
                let start = len - window;
                file.seek(SeekFrom::Start(start))?;
                let mut buf = String::new();
                file.read_to_string(&mut buf)?;
                let mut base = start;
                if start > 0 {
                    if let Some(i) = buf.find('\n') {
                        base += i as u64 + 1;
                        buf = buf[i + 1..].to_string();
                    }
                }
                (base, buf)
            }
            Some(_) => {
                let mut buf = String::new();
                file.read_to_string(&mut buf)?;
                (0, buf)
            }
        };
        let mut all = split_lines(&content, base);
        if let Some(re) = filter {
            all.retain(|l| re.is_match(&l.text));
        }
        let next_cursor = all.last().map(|l| l.cursor).unwrap_or(0);
        let start = all.len().saturating_sub(lines);
        Ok(LogPage {
            lines: all.split_off(start),
            next_cursor,
        })
    }

    /// Truncate the on-disk log file, returning its previous size. Child writers
    /// hold append-mode handles so later output lands at the new end; readers
    /// detect the truncation via `read_since` and restart from zero.
    pub fn clear(&self, profile: &str, source: &str) -> Result<u64> {
        let path = self.path(profile, source);
        let file = match std::fs::OpenOptions::new().write(true).open(&path) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(e) => return Err(e.into()),
        };
        let len = file.metadata()?.len();
        file.set_len(0)?;
        Ok(len)
    }

    /// Lines appended after `cursor`. A trailing partial line is left for the next read.
    pub fn read_since(
        &self,
        profile: &str,
        source: &str,
        cursor: u64,
        filter: Option<&Regex>,
    ) -> Result<LogPage> {
        let path = self.path(profile, source);
        let mut file = match std::fs::File::open(&path) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(LogPage {
                    lines: Vec::new(),
                    next_cursor: cursor,
                });
            }
            Err(e) => return Err(e.into()),
        };
        let len = file.metadata()?.len();
        if cursor >= len {
            return Ok(LogPage {
                lines: Vec::new(),
                // File truncated/rotated: restart from the beginning.
                next_cursor: if cursor > len { 0 } else { cursor },
            });
        }
        file.seek(SeekFrom::Start(cursor))?;
        let mut buf = String::new();
        file.read_to_string(&mut buf)?;
        let complete_end = buf.rfind('\n').map(|i| i + 1).unwrap_or(0);
        let mut lines = split_lines(&buf[..complete_end], cursor);
        if let Some(re) = filter {
            lines.retain(|l| re.is_match(&l.text));
        }
        Ok(LogPage {
            lines,
            next_cursor: cursor + complete_end as u64,
        })
    }
}

fn split_lines(content: &str, base: u64) -> Vec<LogLine> {
    let mut lines = Vec::new();
    let mut offset = base;
    for line in content.split_inclusive('\n') {
        offset += line.len() as u64;
        lines.push(LogLine {
            cursor: offset,
            text: line.trim_end_matches(['\n', '\r']).to_string(),
        });
    }
    lines
}

pub fn ensure_log_file(path: &Path) -> Result<std::fs::File> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    Ok(std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffer_evicts_oldest() {
        let mut ring = RingBuffer::new(3);
        for i in 0..5 {
            ring.push(format!("line{i}"));
        }
        assert_eq!(ring.len(), 3);
        assert_eq!(ring.tail(10), vec!["line2", "line3", "line4"]);
        assert_eq!(ring.tail(2), vec!["line3", "line4"]);
    }

    fn hub_with(content: &str) -> (tempfile::TempDir, LogHub) {
        let dir = tempfile::tempdir().unwrap();
        let hub = LogHub::new(dir.path());
        std::fs::write(hub.path("default", "run"), content).unwrap();
        (dir, hub)
    }

    #[test]
    fn tail_returns_last_lines_with_cursors() {
        let (_dir, hub) = hub_with("a\nbb\nccc\n");
        let page = hub.tail("default", "run", 2, None).unwrap();
        assert_eq!(page.lines.len(), 2);
        assert_eq!(page.lines[0].text, "bb");
        assert_eq!(page.lines[1].text, "ccc");
        assert_eq!(page.next_cursor, 9);
    }

    #[test]
    fn tail_filter_applies_before_limit() {
        let (_dir, hub) = hub_with("ok\nERROR one\nok\nERROR two\n");
        let re = Regex::new("ERROR").unwrap();
        let page = hub.tail("default", "run", 1, Some(&re)).unwrap();
        assert_eq!(page.lines.len(), 1);
        assert_eq!(page.lines[0].text, "ERROR two");
    }

    #[test]
    fn read_since_is_incremental() {
        let (dir, hub) = hub_with("a\nb\n");
        let page = hub.read_since("default", "run", 0, None).unwrap();
        assert_eq!(page.lines.len(), 2);
        let cursor = page.next_cursor;
        let empty = hub.read_since("default", "run", cursor, None).unwrap();
        assert!(empty.lines.is_empty());
        std::fs::write(dir.path().join("default-run.log"), "a\nb\nc\n").unwrap();
        let page = hub.read_since("default", "run", cursor, None).unwrap();
        assert_eq!(page.lines.len(), 1);
        assert_eq!(page.lines[0].text, "c");
    }

    #[test]
    fn read_since_skips_partial_trailing_line() {
        let (_dir, hub) = hub_with("a\npartial");
        let page = hub.read_since("default", "run", 0, None).unwrap();
        assert_eq!(page.lines.len(), 1);
        assert_eq!(page.next_cursor, 2);
    }

    #[test]
    fn missing_file_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let hub = LogHub::new(dir.path());
        assert!(hub.tail("default", "run", 10, None).unwrap().lines.is_empty());
        assert!(hub.read_since("default", "run", 0, None).unwrap().lines.is_empty());
    }

    #[test]
    fn clear_truncates_and_readers_restart() {
        use std::io::Write;
        let (dir, hub) = hub_with("a\nb\nc\n");
        let old = hub.read_since("default", "run", 0, None).unwrap().next_cursor;
        assert_eq!(hub.clear("default", "run").unwrap(), 6);
        assert_eq!(std::fs::metadata(dir.path().join("default-run.log")).unwrap().len(), 0);
        assert!(hub.tail("default", "run", 10, None).unwrap().lines.is_empty());
        let reset = hub.read_since("default", "run", old, None).unwrap();
        assert!(reset.lines.is_empty());
        assert_eq!(reset.next_cursor, 0);
        // append-mode writer (as spawned children hold) continues at new end
        let mut f = ensure_log_file(&hub.path("default", "run")).unwrap();
        f.write_all(b"new\n").unwrap();
        let page = hub.read_since("default", "run", 0, None).unwrap();
        assert_eq!(page.lines.len(), 1);
        assert_eq!(page.lines[0].text, "new");
        assert_eq!(hub.clear("default", "missing").unwrap(), 0);
    }
}