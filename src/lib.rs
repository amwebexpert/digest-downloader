#![deny(clippy::all)]

mod auth;
mod downloader;
mod error;
mod progress;
mod retry;

use std::sync::Mutex;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::ThreadsafeFunction;
use napi_derive::napi;
use tokio_util::sync::CancellationToken;

pub use progress::DownloadProgress;

#[napi(object)]
pub struct Credentials {
    pub username: String,
    pub password: String,
}

#[napi(object)]
pub struct DownloadOptions {
    pub credentials: Credentials,
    pub resource_url: String,
    pub destination_path: String,
    pub retries: Option<u32>,
}

#[napi]
pub struct Downloader {
    cancel_token: Mutex<Option<CancellationToken>>,
}

#[napi]
impl Downloader {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            cancel_token: Mutex::new(None),
        }
    }

    // `on_progress` is a plain fn parameter, not a `DownloadOptions` field:
    // `#[napi(object)]` requires every field to round-trip both directions
    // (ToNapiValue + FromNapiValue), but `ThreadsafeFunction` only has
    // `FromNapiValue`. As a bare parameter only that direction is needed,
    // and it's unconditionally `Send`, so it can cross the `.await` below.
    // Written out in full (not via the `progress::ProgressCallback` alias)
    // because napi-rs's TS codegen reads the literal type tokens here —
    // through a type alias it would emit an undefined `ProgressCallback`
    // reference in the generated `.d.ts` instead of the real function type.
    // The hand-written `index.ts` wrapper re-assembles the single-object
    // public `DownloadOptions` API by splitting `onProgress` out before
    // calling this binding.
    #[napi]
    pub async fn download(
        &self,
        options: DownloadOptions,
        on_progress: Option<
            ThreadsafeFunction<DownloadProgress, (), DownloadProgress, Status, false>,
        >,
    ) -> Result<()> {
        {
            let mut guard = self.cancel_token.lock().unwrap();
            if guard.is_some() {
                return Err(error::DownloaderError::InvalidConfig(
                    "a download is already in progress on this Downloader instance".into(),
                )
                .into());
            }
            *guard = Some(CancellationToken::new());
        }

        let token = self
            .cancel_token
            .lock()
            .unwrap()
            .as_ref()
            .expect("token was just set")
            .clone();

        let request = retry::DownloadRequest {
            resource_url: options.resource_url,
            destination_path: options.destination_path,
            username: options.credentials.username,
            password: options.credentials.password,
            retries: options.retries.unwrap_or(2),
            on_progress,
        };

        let result = retry::run_download(request, token).await;

        *self.cancel_token.lock().unwrap() = None;

        result.map_err(Into::into)
    }

    #[napi]
    pub fn cancel(&self) {
        if let Some(token) = self.cancel_token.lock().unwrap().as_ref() {
            token.cancel();
        }
    }
}

impl Default for Downloader {
    fn default() -> Self {
        Self::new()
    }
}
