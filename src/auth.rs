use crate::error::DownloaderError;

/// Computes the `Authorization` header value for a digest-auth challenge
/// returned by the server on the unauthenticated probe request.
pub fn build_authorization_header(
    www_authenticate: &str,
    username: &str,
    password: &str,
    method: &str,
    uri: &str,
) -> Result<String, DownloaderError> {
    let mut prompt = digest_auth::parse(www_authenticate)
        .map_err(|e| DownloaderError::AuthError(format!("invalid digest challenge: {e}")))?;

    let context = digest_auth::AuthContext::new_with_method(
        username,
        password,
        uri,
        Option::<&[u8]>::None,
        digest_auth::HttpMethod::from(method),
    );

    let answer = prompt.respond(&context).map_err(|e| {
        DownloaderError::AuthError(format!("failed to compute digest response: {e}"))
    })?;

    Ok(answer.to_header_string())
}
