use std::time::Duration;

use tokio_util::sync::CancellationToken;

use crate::downloader::{attempt_once, cleanup_part_file, part_path_for, AttemptContext};
use crate::error::DownloaderError;
use crate::progress::ProgressCallback;

pub struct DownloadRequest {
    pub resource_url: String,
    pub destination_path: String,
    pub username: String,
    pub password: String,
    pub retries: u32,
    pub on_progress: Option<ProgressCallback>,
}

pub async fn run_download(
    req: DownloadRequest,
    token: CancellationToken,
) -> Result<(), DownloaderError> {
    validate(&req)?;

    let part_path = part_path_for(&req.destination_path);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| DownloaderError::InvalidConfig(format!("failed to build HTTP client: {e}")))?;

    let max_attempts = req.retries + 1;
    let mut attempt = 0u32;

    loop {
        attempt += 1;

        let ctx = AttemptContext {
            client: &client,
            resource_url: &req.resource_url,
            username: &req.username,
            password: &req.password,
            part_path: &part_path,
            on_progress: &req.on_progress,
        };

        match attempt_once(&ctx, &token).await {
            Ok(()) => {
                tokio::fs::rename(&part_path, &req.destination_path)
                    .await
                    .map_err(DownloaderError::from_io)?;
                return Ok(());
            }
            Err(DownloaderError::Cancelled) => {
                cleanup_part_file(&part_path).await;
                return Err(DownloaderError::Cancelled);
            }
            Err(e) if e.is_retryable() && attempt < max_attempts => {
                continue;
            }
            Err(e) => {
                cleanup_part_file(&part_path).await;
                return Err(e);
            }
        }
    }
}

fn validate(req: &DownloadRequest) -> Result<(), DownloaderError> {
    if req.resource_url.trim().is_empty() {
        return Err(DownloaderError::InvalidConfig(
            "resourceUrl must not be empty".into(),
        ));
    }
    reqwest::Url::parse(&req.resource_url)
        .map_err(|e| DownloaderError::InvalidConfig(format!("invalid resourceUrl: {e}")))?;
    if req.destination_path.trim().is_empty() {
        return Err(DownloaderError::InvalidConfig(
            "destinationPath must not be empty".into(),
        ));
    }
    if req.username.is_empty() {
        return Err(DownloaderError::InvalidConfig(
            "credentials.username must not be empty".into(),
        ));
    }
    Ok(())
}
