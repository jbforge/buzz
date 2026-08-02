//! At-a-glance usage for the AI subscriptions signed in on this machine.
//!
//! Each adapter reads the credential its provider's own CLI already stores
//! locally (Claude Code's keychain entry, Codex's `auth.json`) and calls the
//! same usage endpoint that CLI uses. Everything stays on-device: tokens are
//! read fresh on each fetch, never persisted by Buzz, and responses are
//! reduced to numbers before crossing the IPC boundary — account identifiers
//! such as the provider email are deliberately dropped.
//!
//! The Claude and Codex endpoints are undocumented (they back `/usage` in
//! Claude Code and `/status` in Codex). Adapters therefore fail soft: any
//! parse or transport error becomes a per-provider `error` status instead of
//! failing the snapshot.

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

const CLAUDE_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const OPENROUTER_CREDITS_URL: &str = "https://openrouter.ai/api/v1/credits";

/// Per-provider fetch outcome, from the widget's point of view.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderStatus {
    /// Usage was fetched; `windows` / `spend` are populated.
    Ok,
    /// No credential found, or the provider rejected it (sign in again).
    SignedOut,
    /// The provider offers no usage API; `dashboardUrl` is the fallback.
    Unsupported,
    /// Adapter needs opt-in configuration (e.g. an OpenRouter API key).
    NotConfigured,
    /// Transport or parse failure; the last good snapshot stays useful.
    Error,
}

/// One rate-limit window (e.g. Claude's 5-hour session, a weekly cap).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    /// Short human label: "5-hour", "Weekly".
    pub label: String,
    /// 0–100. May exceed 100 if the provider reports overage.
    pub used_percent: f64,
    /// Unix seconds when the window resets, when the provider reports it.
    pub resets_at: Option<i64>,
}

/// Monetary usage (extra-usage spend, prepaid credits).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSpend {
    /// Short human label: "Extra usage", "Credits".
    pub label: String,
    pub used: f64,
    pub limit: Option<f64>,
    /// ISO currency code, e.g. "USD".
    pub currency: String,
}

/// Usage summary for a single provider.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsage {
    /// Stable id: "claude" | "codex" | "openrouter" | "nous".
    pub id: String,
    /// Display name.
    pub name: String,
    pub status: ProviderStatus,
    /// Plan name when the provider reports one (e.g. "Plus").
    pub plan: Option<String>,
    pub windows: Vec<UsageWindow>,
    pub spend: Option<UsageSpend>,
    /// One-line hint for non-`ok` states.
    pub detail: Option<String>,
    /// Provider's own usage page, opened externally.
    pub dashboard_url: Option<String>,
}

/// Snapshot of all providers, returned to the sidebar card.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsageSnapshot {
    /// Unix seconds when this snapshot was fetched.
    pub fetched_at: i64,
    pub providers: Vec<ProviderUsage>,
}

/// Fetch usage for every known provider concurrently.
///
/// Always succeeds with a snapshot; per-provider failures are encoded in each
/// entry's `status` so one flaky endpoint never blanks the whole card.
#[tauri::command]
pub async fn fetch_provider_usage() -> Result<ProviderUsageSnapshot, String> {
    let (claude, codex, openrouter) =
        tokio::join!(fetch_claude(), fetch_codex(), fetch_openrouter());
    Ok(ProviderUsageSnapshot {
        fetched_at: chrono::Utc::now().timestamp(),
        providers: vec![claude, codex, openrouter, nous_usage()],
    })
}

fn provider_shell(id: &str, name: &str, dashboard_url: &str) -> ProviderUsage {
    ProviderUsage {
        id: id.to_string(),
        name: name.to_string(),
        status: ProviderStatus::Error,
        plan: None,
        windows: Vec::new(),
        spend: None,
        detail: None,
        dashboard_url: Some(dashboard_url.to_string()),
    }
}

enum FetchError {
    /// 401/403 — credential is missing, stale, or revoked.
    Unauthorized,
    Other(String),
}

async fn get_json(url: &str, headers: &[(&str, String)]) -> Result<Value, FetchError> {
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .build()
        .map_err(|error| FetchError::Other(format!("client build failed: {error}")))?;
    let mut request = client.get(url);
    for (key, value) in headers {
        request = request.header(*key, value);
    }
    let response = request
        .send()
        .await
        .map_err(|error| FetchError::Other(format!("request failed: {error}")))?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(FetchError::Unauthorized);
    }
    if !status.is_success() {
        return Err(FetchError::Other(format!("unexpected status {status}")));
    }
    response
        .json::<Value>()
        .await
        .map_err(|error| FetchError::Other(format!("invalid JSON: {error}")))
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

async fn fetch_claude() -> ProviderUsage {
    let mut usage = provider_shell("claude", "Claude", "https://claude.ai/settings/usage");
    let Some(token) = read_claude_access_token().await else {
        usage.status = ProviderStatus::SignedOut;
        usage.detail = Some("Sign in with Claude Code to see usage".to_string());
        return usage;
    };
    let headers = [
        ("Authorization", format!("Bearer {token}")),
        ("anthropic-beta", "oauth-2025-04-20".to_string()),
    ];
    match get_json(CLAUDE_USAGE_URL, &headers).await {
        Ok(value) => map_claude_usage(&value),
        Err(FetchError::Unauthorized) => {
            usage.status = ProviderStatus::SignedOut;
            usage.detail =
                Some("Claude session expired — use Claude Code to refresh it".to_string());
            usage
        }
        Err(FetchError::Other(detail)) => {
            usage.detail = Some(detail);
            usage
        }
    }
}

/// Newest Claude Code OAuth token on this machine.
///
/// Claude Code keeps the live token in the login keychain (service
/// "Claude Code-credentials") on macOS and mirrors an often-stale copy to
/// `~/.claude/.credentials.json`. Prefer whichever credential expires later.
async fn read_claude_access_token() -> Option<String> {
    let mut candidates: Vec<Value> = Vec::new();
    #[cfg(target_os = "macos")]
    if let Some(value) = read_claude_keychain_credentials().await {
        candidates.push(value);
    }
    if let Some(path) = dirs::home_dir().map(|home| home.join(".claude/.credentials.json")) {
        if let Ok(raw) = tokio::fs::read_to_string(path).await {
            if let Ok(value) = serde_json::from_str::<Value>(&raw) {
                candidates.push(value);
            }
        }
    }
    candidates
        .iter()
        .filter_map(|value| claude_credential_from_json(value))
        .max_by_key(|(_, expires_at)| expires_at.unwrap_or(i64::MIN))
        .map(|(token, _)| token)
}

#[cfg(target_os = "macos")]
async fn read_claude_keychain_credentials() -> Option<Value> {
    let output = tokio::process::Command::new("security")
        .args([
            "find-generic-password",
            "-s",
            "Claude Code-credentials",
            "-w",
        ])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice::<Value>(output.stdout.trim_ascii()).ok()
}

/// Extract `(access_token, expires_at_millis)` from a Claude Code
/// credentials JSON blob. Pure for testability.
fn claude_credential_from_json(value: &Value) -> Option<(String, Option<i64>)> {
    let oauth = value.get("claudeAiOauth")?;
    let token = oauth.get("accessToken")?.as_str()?;
    if token.is_empty() {
        return None;
    }
    Some((
        token.to_string(),
        oauth.get("expiresAt").and_then(Value::as_i64),
    ))
}

/// Map the `api/oauth/usage` response to a [`ProviderUsage`]. Pure.
fn map_claude_usage(value: &Value) -> ProviderUsage {
    let mut usage = provider_shell("claude", "Claude", "https://claude.ai/settings/usage");
    usage.status = ProviderStatus::Ok;
    for (key, label) in [("five_hour", "5-hour"), ("seven_day", "Weekly")] {
        let Some(window) = value.get(key).filter(|w| !w.is_null()) else {
            continue;
        };
        let Some(used_percent) = window.get("utilization").and_then(Value::as_f64) else {
            continue;
        };
        usage.windows.push(UsageWindow {
            label: label.to_string(),
            used_percent,
            resets_at: window
                .get("resets_at")
                .and_then(Value::as_str)
                .and_then(parse_rfc3339_to_unix),
        });
    }
    usage.spend = claude_extra_usage_spend(value.get("extra_usage"));
    if usage.windows.is_empty() && usage.spend.is_none() {
        usage.status = ProviderStatus::Error;
        usage.detail = Some("usage response had no recognizable fields".to_string());
    }
    usage
}

/// Claude reports extra-usage amounts in minor currency units
/// (`used_credits: 3447, decimal_places: 2` → $34.47). Pure.
fn claude_extra_usage_spend(extra: Option<&Value>) -> Option<UsageSpend> {
    let extra = extra?;
    if !extra
        .get("is_enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return None;
    }
    let scale = 10f64.powi(
        extra
            .get("decimal_places")
            .and_then(Value::as_i64)
            .unwrap_or(2) as i32,
    );
    let used = extra.get("used_credits").and_then(Value::as_f64)? / scale;
    Some(UsageSpend {
        label: "Extra usage".to_string(),
        used,
        limit: extra
            .get("monthly_limit")
            .and_then(Value::as_f64)
            .map(|limit| limit / scale),
        currency: extra
            .get("currency")
            .and_then(Value::as_str)
            .unwrap_or("USD")
            .to_string(),
    })
}

fn parse_rfc3339_to_unix(raw: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|parsed| parsed.timestamp())
}

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

async fn fetch_codex() -> ProviderUsage {
    let mut usage = provider_shell("codex", "Codex", "https://chatgpt.com/codex/settings/usage");
    let Some(token) = read_codex_access_token().await else {
        usage.status = ProviderStatus::SignedOut;
        usage.detail = Some("Sign in with the Codex CLI to see usage".to_string());
        return usage;
    };
    let headers = [("Authorization", format!("Bearer {token}"))];
    match get_json(CODEX_USAGE_URL, &headers).await {
        Ok(value) => map_codex_usage(&value),
        Err(FetchError::Unauthorized) => {
            usage.status = ProviderStatus::SignedOut;
            usage.detail = Some("Codex session expired — run the Codex CLI to refresh".to_string());
            usage
        }
        Err(FetchError::Other(detail)) => {
            usage.detail = Some(detail);
            usage
        }
    }
}

async fn read_codex_access_token() -> Option<String> {
    let path = std::env::var_os("CODEX_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".codex")))?
        .join("auth.json");
    let raw = tokio::fs::read_to_string(path).await.ok()?;
    let value = serde_json::from_str::<Value>(&raw).ok()?;
    let token = value.get("tokens")?.get("access_token")?.as_str()?;
    if token.is_empty() {
        return None;
    }
    Some(token.to_string())
}

/// Map the `wham/usage` response to a [`ProviderUsage`].
///
/// Only numeric rate-limit fields are lifted; the response's account fields
/// (email, user ids) are intentionally never copied. Pure.
fn map_codex_usage(value: &Value) -> ProviderUsage {
    let mut usage = provider_shell("codex", "Codex", "https://chatgpt.com/codex/settings/usage");
    usage.status = ProviderStatus::Ok;
    usage.plan = value
        .get("plan_type")
        .and_then(Value::as_str)
        .map(capitalize_first);
    if let Some(rate_limit) = value.get("rate_limit") {
        for key in ["primary_window", "secondary_window"] {
            let Some(window) = rate_limit.get(key).filter(|w| !w.is_null()) else {
                continue;
            };
            let Some(used_percent) = window.get("used_percent").and_then(Value::as_f64) else {
                continue;
            };
            usage.windows.push(UsageWindow {
                label: codex_window_label(
                    window.get("limit_window_seconds").and_then(Value::as_i64),
                ),
                used_percent,
                resets_at: window.get("reset_at").and_then(Value::as_i64),
            });
        }
    }
    if usage.windows.is_empty() {
        usage.status = ProviderStatus::Error;
        usage.detail = Some("usage response had no rate-limit windows".to_string());
    }
    usage
}

/// Codex windows are self-describing via `limit_window_seconds`; on Plus the
/// primary window is the weekly cap, on Pro a 5-hour window appears too. Pure.
fn codex_window_label(limit_window_seconds: Option<i64>) -> String {
    match limit_window_seconds {
        Some(seconds) if seconds <= 6 * 3600 => "5-hour".to_string(),
        Some(seconds) if seconds >= 6 * 86_400 => "Weekly".to_string(),
        Some(seconds) => format!("{}-hour", seconds / 3600),
        None => "Window".to_string(),
    }
}

fn capitalize_first(raw: &str) -> String {
    let mut chars = raw.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

// ---------------------------------------------------------------------------
// OpenRouter
// ---------------------------------------------------------------------------

async fn fetch_openrouter() -> ProviderUsage {
    let mut usage = provider_shell(
        "openrouter",
        "OpenRouter",
        "https://openrouter.ai/settings/credits",
    );
    let Some(key) = read_openrouter_api_key().await else {
        usage.status = ProviderStatus::NotConfigured;
        usage.detail =
            Some("Put an API key in ~/.config/buzz/openrouter-api-key to enable".to_string());
        return usage;
    };
    let headers = [("Authorization", format!("Bearer {key}"))];
    match get_json(OPENROUTER_CREDITS_URL, &headers).await {
        Ok(value) => map_openrouter_credits(&value),
        Err(FetchError::Unauthorized) => {
            usage.status = ProviderStatus::SignedOut;
            usage.detail = Some("OpenRouter rejected the configured API key".to_string());
            usage
        }
        Err(FetchError::Other(detail)) => {
            usage.detail = Some(detail);
            usage
        }
    }
}

/// OpenRouter is key-based (no local CLI to borrow from), so the key is
/// opt-in: `OPENROUTER_API_KEY` env var or `~/.config/buzz/openrouter-api-key`.
async fn read_openrouter_api_key() -> Option<String> {
    if let Ok(key) = std::env::var("OPENROUTER_API_KEY") {
        let key = key.trim().to_string();
        if !key.is_empty() {
            return Some(key);
        }
    }
    let path = dirs::home_dir()?.join(".config/buzz/openrouter-api-key");
    let raw = tokio::fs::read_to_string(path).await.ok()?;
    let key = raw.trim().to_string();
    if key.is_empty() {
        None
    } else {
        Some(key)
    }
}

/// Map `/api/v1/credits` (`{data: {total_credits, total_usage}}`). Pure.
fn map_openrouter_credits(value: &Value) -> ProviderUsage {
    let mut usage = provider_shell(
        "openrouter",
        "OpenRouter",
        "https://openrouter.ai/settings/credits",
    );
    let Some(data) = value.get("data") else {
        usage.detail = Some("credits response missing data".to_string());
        return usage;
    };
    let total_credits = data.get("total_credits").and_then(Value::as_f64);
    let Some(total_usage) = data.get("total_usage").and_then(Value::as_f64) else {
        usage.detail = Some("credits response missing totals".to_string());
        return usage;
    };
    usage.status = ProviderStatus::Ok;
    usage.spend = Some(UsageSpend {
        label: "Credits".to_string(),
        used: total_usage,
        limit: total_credits,
        currency: "USD".to_string(),
    });
    if let Some(total) = total_credits.filter(|total| *total > 0.0) {
        usage.windows.push(UsageWindow {
            label: "Credits".to_string(),
            used_percent: (total_usage / total) * 100.0,
            resets_at: None,
        });
    }
    usage
}

// ---------------------------------------------------------------------------
// Nous Portal
// ---------------------------------------------------------------------------

/// Nous Portal has no usage/credits API yet (open feature requests upstream),
/// so the card shows a link-out tile until one ships.
fn nous_usage() -> ProviderUsage {
    let mut usage = provider_shell(
        "nous",
        "Nous Portal",
        "https://portal.nousresearch.com/usage",
    );
    usage.status = ProviderStatus::Unsupported;
    usage.detail = Some("No usage API yet — opens the portal".to_string());
    usage
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn claude_credential_prefers_populated_token_with_expiry() {
        let value = json!({
            "claudeAiOauth": {"accessToken": "tok-a", "expiresAt": 1_785_000_000_000i64}
        });
        assert_eq!(
            claude_credential_from_json(&value),
            Some(("tok-a".to_string(), Some(1_785_000_000_000)))
        );
        assert_eq!(
            claude_credential_from_json(&json!({"claudeAiOauth": {}})),
            None
        );
        assert_eq!(
            claude_credential_from_json(&json!({"claudeAiOauth": {"accessToken": ""}})),
            None
        );
    }

    #[test]
    fn claude_usage_maps_windows_and_extra_usage() {
        let value = json!({
            "five_hour": {"utilization": 16.0, "resets_at": "2026-07-31T10:10:00+00:00"},
            "seven_day": {"utilization": 2.0, "resets_at": "2026-08-07T06:59:59+00:00"},
            "extra_usage": {
                "is_enabled": true,
                "monthly_limit": 20000,
                "used_credits": 3447.0,
                "currency": "USD",
                "decimal_places": 2
            }
        });
        let usage = map_claude_usage(&value);
        assert_eq!(usage.status, ProviderStatus::Ok);
        assert_eq!(usage.windows.len(), 2);
        assert_eq!(usage.windows[0].label, "5-hour");
        assert_eq!(usage.windows[0].used_percent, 16.0);
        assert!(usage.windows[0].resets_at.is_some());
        let spend = usage.spend.as_ref().unwrap();
        assert_eq!(spend.used, 34.47);
        assert_eq!(spend.limit, Some(200.0));
    }

    #[test]
    fn claude_disabled_extra_usage_is_dropped() {
        let extra = json!({"is_enabled": false, "used_credits": 100.0});
        assert_eq!(claude_extra_usage_spend(Some(&extra)), None);
    }

    #[test]
    fn codex_usage_maps_windows_and_never_carries_account_fields() {
        let value = json!({
            "email": "someone@example.com",
            "user_id": "user-123",
            "plan_type": "plus",
            "rate_limit": {
                "primary_window": {
                    "used_percent": 60,
                    "limit_window_seconds": 604_800,
                    "reset_at": 1_785_946_435i64
                },
                "secondary_window": null
            }
        });
        let usage = map_codex_usage(&value);
        assert_eq!(usage.status, ProviderStatus::Ok);
        assert_eq!(usage.plan.as_deref(), Some("Plus"));
        assert_eq!(usage.windows.len(), 1);
        assert_eq!(usage.windows[0].label, "Weekly");
        assert_eq!(usage.windows[0].resets_at, Some(1_785_946_435));
        let serialized = serde_json::to_string(&usage).unwrap();
        assert!(!serialized.contains("someone@example.com"));
        assert!(!serialized.contains("user-123"));
    }

    #[test]
    fn codex_window_labels_follow_window_length() {
        assert_eq!(codex_window_label(Some(18_000)), "5-hour");
        assert_eq!(codex_window_label(Some(604_800)), "Weekly");
        assert_eq!(codex_window_label(Some(43_200)), "12-hour");
        assert_eq!(codex_window_label(None), "Window");
    }

    #[test]
    fn codex_empty_rate_limits_report_error() {
        let usage = map_codex_usage(&json!({"rate_limit": {}}));
        assert_eq!(usage.status, ProviderStatus::Error);
    }

    #[test]
    fn openrouter_credits_map_to_spend_and_percent() {
        let value = json!({"data": {"total_credits": 50.0, "total_usage": 12.5}});
        let usage = map_openrouter_credits(&value);
        assert_eq!(usage.status, ProviderStatus::Ok);
        assert_eq!(usage.windows[0].used_percent, 25.0);
        let spend = usage.spend.as_ref().unwrap();
        assert_eq!(spend.used, 12.5);
        assert_eq!(spend.limit, Some(50.0));
    }

    /// Live smoke test against this machine's real credentials. Excluded from
    /// CI (network + local sign-in state); run manually with
    /// `cargo test -p buzz-desktop live_provider_usage -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn live_provider_usage_snapshot() {
        let snapshot = fetch_provider_usage().await.unwrap();
        println!("{}", serde_json::to_string_pretty(&snapshot).unwrap());
        assert_eq!(snapshot.providers.len(), 4);
    }

    #[test]
    fn openrouter_zero_credit_balance_skips_percent_window() {
        let value = json!({"data": {"total_credits": 0.0, "total_usage": 0.0}});
        let usage = map_openrouter_credits(&value);
        assert_eq!(usage.status, ProviderStatus::Ok);
        assert!(usage.windows.is_empty());
    }
}
