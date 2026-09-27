use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

#[napi(object)]
pub struct DownloadProgress {
    pub bytes: f64,
    pub total_bytes: f64,
}

pub type ProgressCallback =
    ThreadsafeFunction<DownloadProgress, (), DownloadProgress, Status, false>;

/// Fire-and-forget progress emission. Never blocks the download loop on the
/// JS event loop draining the callback; a full queue simply drops this tick.
pub fn emit_progress(callback: &Option<ProgressCallback>, bytes: f64, total_bytes: f64) {
    if let Some(cb) = callback {
        cb.call(
            DownloadProgress { bytes, total_bytes },
            ThreadsafeFunctionCallMode::NonBlocking,
        );
    }
}
