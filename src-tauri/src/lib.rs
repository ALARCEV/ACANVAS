mod storage;

use storage::{AppStore, LinkPreview};
use tauri::{Manager, State};

#[tauri::command]
fn load_workspace(store: State<'_, AppStore>) -> Result<serde_json::Value, String> {
    store.load_workspace().map_err(|error| error.to_string())
}

#[tauri::command]
fn save_workspace(store: State<'_, AppStore>, workspace: serde_json::Value) -> Result<(), String> {
    store.save_workspace(workspace).map_err(|error| error.to_string())
}

#[tauri::command]
fn fetch_link_preview(url: String) -> Result<LinkPreview, String> {
    storage::fetch_link_preview(&url).map_err(|error| error.to_string())
}

#[tauri::command]
fn export_workspace(store: State<'_, AppStore>) -> Result<String, String> {
    store.export_workspace().map_err(|error| error.to_string())
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let target = std::path::PathBuf::from(path);
    if !target.exists() {
        return Err("Path does not exist".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(target)
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        return Err("Opening local paths is currently implemented for Windows only".to_string());
    }

    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("Unable to resolve app data dir: {error}"))?;
            std::fs::create_dir_all(&app_dir)?;
            app.manage(AppStore::new(app_dir)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_workspace,
            save_workspace,
            fetch_link_preview,
            export_workspace,
            open_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running ACANVAS");
}
