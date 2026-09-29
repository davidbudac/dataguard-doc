// The two commands the page calls are listed here so that Tauri generates a
// permission for each (`allow-save-file`, `allow-print-page`) and the
// capability in capabilities/default.json can name exactly those, instead of
// every command being open to every window by default.
fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["save_file", "print_page"]),
        ),
    )
    .expect("failed to run tauri-build");
}
