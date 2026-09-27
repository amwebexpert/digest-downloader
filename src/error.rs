#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DownloaderErrorCode {
    HttpError,
    AuthError,
    NetworkError,
    TimeoutError,
    FilesystemError,
    Cancelled,
    InvalidConfig,
}

impl AsRef<str> for DownloaderErrorCode {
    fn as_ref(&self) -> &str {
        match self {
            Self::HttpError => "HttpError",
            Self::AuthError => "AuthError",
            Self::NetworkError => "NetworkError",
            Self::TimeoutError => "TimeoutError",
            Self::FilesystemError => "FilesystemError",
            Self::Cancelled => "Cancelled",
            Self::InvalidConfig => "InvalidConfig",
        }
    }
}

#[derive(thiserror::Error, Debug)]
pub enum DownloaderError {
    #[error("HTTP error: {status} for {url}")]
    HttpError { status: u16, url: String },
    #[error("Authentication failed: {0}")]
    AuthError(String),
    #[error("Network error: {0}")]
    NetworkError(String),
    #[error("Request timed out: {0}")]
    TimeoutError(String),
    #[error("Filesystem error: {0}")]
    FilesystemError(String),
    #[error("Download cancelled")]
    Cancelled,
    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),
}

impl DownloaderError {
    pub fn is_retryable(&self) -> bool {
        match self {
            DownloaderError::NetworkError(_) => true,
            DownloaderError::TimeoutError(_) => true,
            DownloaderError::HttpError { status, .. } => *status >= 500,
            _ => false,
        }
    }

    pub fn code(&self) -> DownloaderErrorCode {
        match self {
            DownloaderError::HttpError { .. } => DownloaderErrorCode::HttpError,
            DownloaderError::AuthError(_) => DownloaderErrorCode::AuthError,
            DownloaderError::NetworkError(_) => DownloaderErrorCode::NetworkError,
            DownloaderError::TimeoutError(_) => DownloaderErrorCode::TimeoutError,
            DownloaderError::FilesystemError(_) => DownloaderErrorCode::FilesystemError,
            DownloaderError::Cancelled => DownloaderErrorCode::Cancelled,
            DownloaderError::InvalidConfig(_) => DownloaderErrorCode::InvalidConfig,
        }
    }

    pub fn from_io(err: std::io::Error) -> Self {
        DownloaderError::FilesystemError(err.to_string())
    }
}

/// Encodes the error code into the message as a `CODE: message` prefix.
/// napi-rs's stable, cross-version-safe error surface is `Error<Status>`
/// (message + generic status); a custom generic `Error<S>` status type is a
/// newer, less battle-tested corner of the macro API. Encoding the code as a
/// parseable prefix and re-splitting it in the hand-written `index.ts`
/// wrapper (see `errorFromNative`) gives JS callers a stable `err.code`
/// string without depending on that unstable surface.
impl From<DownloaderError> for napi::Error {
    fn from(e: DownloaderError) -> Self {
        napi::Error::from_reason(format!("{}: {}", e.code().as_ref(), e))
    }
}
