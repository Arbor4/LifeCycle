use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;

use crate::process::now_ms;

const CAP: usize = 200;
const MAX_PAYLOAD: usize = 6000;

#[derive(Debug, Clone, Serialize)]
pub struct CallRecord {
    pub id: u64,
    pub ts: u64,
    /// "ui" (HTTP console) or "mcp" (AI client)
    pub source: String,
    pub tool: String,
    pub duration_ms: u64,
    pub exit_code: i32,
    pub input: Value,
    pub output: Value,
}

/// Shared ring buffer of tool calls (request + response) used by both the HTTP
/// console and the MCP server, so the UI can show what AI sent and received.
pub struct CallLog {
    inner: Mutex<VecDeque<CallRecord>>,
    seq: AtomicU64,
}

impl Default for CallLog {
    fn default() -> Self {
        Self::new()
    }
}

fn bounded(v: Value) -> Value {
    let text = serde_json::to_string(&v).unwrap_or_default();
    if text.len() <= MAX_PAYLOAD {
        return v;
    }
    let mut cut = MAX_PAYLOAD;
    while cut > 0 && !text.is_char_boundary(cut) {
        cut -= 1;
    }
    Value::String(format!(
        "{}… [truncated, {} bytes total]",
        &text[..cut],
        text.len()
    ))
}

impl CallLog {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(VecDeque::new()),
            seq: AtomicU64::new(0),
        }
    }

    pub fn push(
        &self,
        source: &str,
        tool: &str,
        duration_ms: u64,
        exit_code: i32,
        input: Value,
        output: Value,
    ) {
        let record = CallRecord {
            id: self.seq.fetch_add(1, Ordering::Relaxed) + 1,
            ts: now_ms(),
            source: source.to_string(),
            tool: tool.to_string(),
            duration_ms,
            exit_code,
            input: bounded(input),
            output: bounded(output),
        };
        let mut guard = self.inner.lock().unwrap();
        if guard.len() >= CAP {
            guard.pop_front();
        }
        guard.push_back(record);
    }

    /// Oldest first; callers reverse for display.
    pub fn list(&self) -> Vec<CallRecord> {
        self.inner.lock().unwrap().iter().cloned().collect()
    }
}