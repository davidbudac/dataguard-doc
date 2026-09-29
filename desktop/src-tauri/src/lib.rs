//! The desktop shell around the Data Guard workbench (`../app`, built into
//! `../../_site`). The page is the same one served at
//! https://dataguard.davidbudac.cz/; this crate exists for the four things a
//! webview does not do the way a browser does:
//!
//!  - saving a file (`save_file`): `<a download>` is a no-op here, so the page
//!    hands the bytes over and a native save dialog decides where they go;
//!  - printing (`print_page`): WKWebView ignores `window.print()`;
//!  - pop-out windows (`on_new_window`): the page calls `window.open` and then
//!    renders into the returned window's DOM, so the window must be created
//!    *as the opener's child* (`NewWindowResponse::Create`), not as a separate
//!    navigation;
//!  - links to the outside (`<a target=_blank>`, citations): the system browser.
//!
//! The page-side half is `app/src/ui/common/desktop.ts`; nothing else in the
//! page knows it is in a shell.

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

use percent_encoding::percent_decode_str;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

/// Hosts the page itself is served from: the bundled assets
/// (`tauri://localhost` on macOS, `http://tauri.localhost` on Windows) and the
/// Vite dev server. Navigating anywhere else is leaving the app.
fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "about" | "blob" | "data" | "ipc" | "asset" => true,
        "http" | "https" => matches!(
            url.host_str(),
            Some("localhost" | "127.0.0.1" | "tauri.localhost" | "ipc.localhost" | "asset.localhost")
        ),
        _ => false,
    }
}

/// Hand an outside address to the system browser. Only web addresses: a page
/// that could open `file:` or a custom scheme through here would be a way out
/// of the sandbox.
fn open_outside(app: &AppHandle, url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

/// `x-file-name` arrives percent-encoded; only its last path component is used,
/// and only as the dialog's suggestion.
fn suggested_name(raw: Option<&str>) -> String {
    let decoded = raw
        .map(|v| percent_decode_str(v).decode_utf8_lossy().into_owned())
        .unwrap_or_default();
    Path::new(&decoded)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .unwrap_or("download")
        .to_string()
}

/// Ask where to save, then write the request's raw body there. `Ok(false)` is
/// a cancelled dialog, which the page treats as "nothing was saved".
#[tauri::command]
async fn save_file(
    app: AppHandle,
    window: WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<bool, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("save_file expects a raw body".into());
    };
    let name = suggested_name(
        request
            .headers()
            .get("x-file-name")
            .and_then(|v| v.to_str().ok()),
    );
    let mut dialog = app.dialog().file().set_parent(&window).set_file_name(&name);
    if let Some(ext) = Path::new(&name).extension().and_then(|e| e.to_str()) {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext]);
    }
    // `blocking_*` must not run on the main thread; async commands do not.
    let Some(path) = dialog.blocking_save_file() else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(true)
}

/// The report's "Save as PDF" starts from the system print dialog.
#[tauri::command]
fn print_page(webview: WebviewWindow) -> Result<(), String> {
    // wry's native `print` exists on macOS only, where `window.print()` is
    // ignored; on Windows `window.print()` is the working path.
    #[cfg(target_os = "macos")]
    {
        webview.print().map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        webview.eval("window.print()").map_err(|e| e.to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Unique labels for pop-out windows; the page names its windows itself
    // (`dg-pop-timeline`) but a label may be used only once at a time.
    static POPUPS: AtomicUsize = AtomicUsize::new(0);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_file, print_page])
        .setup(|app| {
            // The window is built here, not from the config alone, because
            // `on_new_window` is a builder method; its size and title still
            // come from the "main" entry in tauri.conf.json (`create: false`).
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .expect("tauri.conf.json has no `main` window");
            let handle = app.handle().clone();
            let nav_handle = app.handle().clone();
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                .on_navigation(move |url| {
                    if is_app_url(url) {
                        true
                    } else {
                        open_outside(&nav_handle, url);
                        false
                    }
                })
                .on_new_window(move |url, features| {
                    if !is_app_url(&url) {
                        // <a target="_blank"> and window.open('https://...').
                        open_outside(&handle, &url);
                        return NewWindowResponse::Deny;
                    }
                    // window.open('', name, 'popup,...'): the pop-out. The page
                    // renders into this window's document from the opener, so
                    // it has to be created as the opener's child.
                    let n = POPUPS.fetch_add(1, Ordering::Relaxed);
                    match WebviewWindowBuilder::new(
                        &handle,
                        format!("dg-pop-{n}"),
                        WebviewUrl::External(url),
                    )
                    .window_features(features)
                    .title("Data Guard Workbench")
                    .build()
                    {
                        Ok(window) => NewWindowResponse::Create { window },
                        Err(_) => NewWindowResponse::Deny,
                    }
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Data Guard Workbench");
}
