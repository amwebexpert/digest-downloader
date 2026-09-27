use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

use crate::auth::build_authorization_header;
use crate::error::DownloaderError;
use crate::progress::{emit_progress, ProgressCallback};

pub struct AttemptContext<'a> {
    pub client: &'a reqwest::Client,
    pub resource_url: &'a str,
    pub username: &'a str,
    pub password: &'a str,
    pub part_path: &'a Path,
    pub on_progress: &'a Option<ProgressCallback>,
}

pub fn part_path_for(destination_path: &str) -> PathBuf {
    PathBuf::from(format!("{destination_path}.part"))
}

/// Performs one full attempt: unauthenticated probe -> digest challenge ->
/// authenticated streamed GET -> write to the `.part` sibling file.
/// Every network await races against `token.cancelled()`.
pub async fn attempt_once(
    ctx: &AttemptContext<'_>,
    token: &CancellationToken,
) -> Result<(), DownloaderError> {
    let probe = tokio::select! {
        biased;
        _ = token.cancelled() => return Err(DownloaderError::Cancelled),
        res = ctx.client.get(ctx.resource_url).send() => res,
    };

    let probe_resp = probe.map_err(classify_reqwest_error)?;

    if probe_resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        let www_authenticate = probe_resp
            .headers()
            .get(reqwest::header::WWW_AUTHENTICATE)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| DownloaderError::AuthError("missing WWW-Authenticate header".into()))?
            .to_string();

        let uri = request_uri(ctx.resource_url)?;
        let authorization =
            build_authorization_header(&www_authenticate, ctx.username, ctx.password, "GET", &uri)?;

        let authed = tokio::select! {
            biased;
            _ = token.cancelled() => return Err(DownloaderError::Cancelled),
            res = ctx
                .client
                .get(ctx.resource_url)
                .header(reqwest::header::AUTHORIZATION, authorization)
                .send() => res,
        };

        let response = authed.map_err(classify_reqwest_error)?;
        return stream_to_file(response, ctx, token).await;
    }

    if probe_resp.status().is_success() {
        return stream_to_file(probe_resp, ctx, token).await;
    }

    Err(status_to_error(probe_resp.status(), ctx.resource_url))
}

async fn stream_to_file(
    response: reqwest::Response,
    ctx: &AttemptContext<'_>,
    token: &CancellationToken,
) -> Result<(), DownloaderError> {
    let status = response.status();
    if !status.is_success() {
        return Err(status_to_error(status, ctx.resource_url));
    }

    let total_bytes: f64 = response
        .content_length()
        .map(|len| len as f64)
        .unwrap_or(-1.0);

    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(ctx.part_path)
        .await
        .map_err(DownloaderError::from_io)?;

    let mut written: f64 = 0.0;
    let mut stream = response.bytes_stream();

    loop {
        let next = tokio::select! {
            biased;
            _ = token.cancelled() => return Err(DownloaderError::Cancelled),
            chunk = stream.next() => chunk,
        };

        match next {
            None => break,
            Some(Ok(bytes)) => {
                file.write_all(&bytes)
                    .await
                    .map_err(DownloaderError::from_io)?;
                written += bytes.len() as f64;
                emit_progress(ctx.on_progress, written, total_bytes);
            }
            Some(Err(e)) => return Err(classify_reqwest_error(e)),
        }
    }

    file.flush().await.map_err(DownloaderError::from_io)?;
    Ok(())
}

fn request_uri(resource_url: &str) -> Result<String, DownloaderError> {
    let parsed = reqwest::Url::parse(resource_url)
        .map_err(|e| DownloaderError::InvalidConfig(format!("invalid resourceUrl: {e}")))?;
    let mut uri = parsed.path().to_string();
    if uri.is_empty() {
        uri = "/".to_string();
    }
    if let Some(query) = parsed.query() {
        uri.push('?');
        uri.push_str(query);
    }
    Ok(uri)
}

fn status_to_error(status: reqwest::StatusCode, url: &str) -> DownloaderError {
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        DownloaderError::AuthError(format!("authentication rejected with status {status}"))
    } else {
        DownloaderError::HttpError {
            status: status.as_u16(),
            url: url.to_string(),
        }
    }
}

fn classify_reqwest_error(err: reqwest::Error) -> DownloaderError {
    if err.is_timeout() {
        DownloaderError::TimeoutError(err.to_string())
    } else if err.is_connect() {
        DownloaderError::NetworkError(err.to_string())
    } else if let Some(status) = err.status() {
        status_to_error(status, err.url().map(|u| u.as_str()).unwrap_or_default())
    } else {
        DownloaderError::NetworkError(err.to_string())
    }
}

pub async fn cleanup_part_file(part_path: &Path) {
    let _ = tokio::fs::remove_file(part_path).await;
}
