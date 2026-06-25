mod storage;

use storage::{AppStore, LinkPreview};
use tauri::{Manager, State};

#[derive(serde::Serialize)]
struct PathMetadata {
    size: u64,
    is_dir: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredClipboardAsset {
    source_path: String,
    size: u64,
}

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
fn write_workspace_export(path: String, workspace: serde_json::Value) -> Result<String, String> {
    let mut target = std::path::PathBuf::from(path);
    if target.extension().is_none() {
        target.set_extension("acanvas.json");
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let payload = serde_json::to_string_pretty(&workspace).map_err(|error| error.to_string())?;
    std::fs::write(&target, payload).map_err(|error| error.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn get_backup_dir(store: State<'_, AppStore>) -> Result<Option<String>, String> {
    store.get_backup_dir().map_err(|error| error.to_string())
}

#[tauri::command]
fn set_backup_dir(store: State<'_, AppStore>, path: String) -> Result<(), String> {
    store.set_backup_dir(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn backup_now(store: State<'_, AppStore>) -> Result<Option<String>, String> {
    store.sync_backup().map_err(|error| error.to_string())
}

#[tauri::command]
fn save_clipboard_asset(
    store: State<'_, AppStore>,
    file_name: String,
    mime_type: String,
    bytes: Vec<u8>,
) -> Result<StoredClipboardAsset, String> {
    let size = bytes.len() as u64;
    let path = store
        .save_clipboard_asset(file_name, mime_type, bytes)
        .map_err(|error| error.to_string())?;
    Ok(StoredClipboardAsset {
        source_path: path.to_string_lossy().to_string(),
        size,
    })
}

#[tauri::command]
fn path_metadata(path: String) -> Result<PathMetadata, String> {
    let target = std::path::PathBuf::from(path);
    let metadata = std::fs::metadata(target).map_err(|error| error.to_string())?;
    Ok(PathMetadata {
        size: metadata.len(),
        is_dir: metadata.is_dir(),
    })
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let target = std::path::PathBuf::from(path);
    if !target.exists() {
        return Err("Path does not exist".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        open::that_detached(target).map_err(|error| error.to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        return Err("Opening local paths is currently implemented for Windows only".to_string());
    }

    Ok(())
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    let target = std::path::PathBuf::from(path);
    if !target.exists() {
        return Err("Path does not exist".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg("/select,")
            .arg(target.as_os_str())
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        return Err("Revealing local paths is currently implemented for Windows only".to_string());
    }

    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            write_workspace_export,
            get_backup_dir,
            set_backup_dir,
            backup_now,
            save_clipboard_asset,
            path_metadata,
            open_path,
            reveal_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running ACANVAS");
}
