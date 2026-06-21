use rusqlite::{params, Connection};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct AppStore {
    db: Mutex<Connection>,
    app_dir: PathBuf,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LinkPreview {
    pub url: String,
    pub title: String,
    pub description: String,
    pub image_url: Option<String>,
}

impl AppStore {
    pub fn new(app_dir: PathBuf) -> rusqlite::Result<Self> {
        std::fs::create_dir_all(app_dir.join("assets")).ok();
        std::fs::create_dir_all(app_dir.join("thumbs")).ok();
        std::fs::create_dir_all(app_dir.join("backups")).ok();
        let connection = Connection::open(app_dir.join("acanvas.db"))?;
        migrate(&connection)?;
        Ok(Self {
            db: Mutex::new(connection),
            app_dir,
        })
    }

    pub fn load_workspace(&self) -> rusqlite::Result<serde_json::Value> {
        let db = self.db.lock().expect("database lock poisoned");
        let mut statement = db.prepare("select payload from workspace_snapshots order by created_at desc limit 1")?;
        let payload = statement.query_row([], |row| row.get::<_, String>(0));
        match payload {
            Ok(value) => Ok(serde_json::from_str(&value).unwrap_or_else(|_| json!({}))),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(json!({})),
            Err(error) => Err(error),
        }
    }

    pub fn save_workspace(&self, workspace: serde_json::Value) -> rusqlite::Result<()> {
        let db = self.db.lock().expect("database lock poisoned");
        db.execute(
            "insert into workspace_snapshots (id, payload, created_at) values (?1, ?2, datetime('now'))",
            params![uuid::Uuid::new_v4().to_string(), workspace.to_string()],
        )?;
        drop(db);
        self.sync_backup().map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        Ok(())
    }

    pub fn export_workspace(&self) -> std::io::Result<String> {
        let export_path = self
            .app_dir
            .join("backups")
            .join(format!("acanvas-{}.json", chrono::Utc::now().format("%Y-%m-%d-%H%M%S")));
        let payload = self
            .load_workspace()
            .unwrap_or_else(|_| json!({ "schema": "acanvas.workspace.v1" }));
        std::fs::write(&export_path, serde_json::to_string_pretty(&payload).unwrap_or_default())?;
        Ok(export_path.to_string_lossy().to_string())
    }

    pub fn get_backup_dir(&self) -> rusqlite::Result<Option<String>> {
        let db = self.db.lock().expect("database lock poisoned");
        let result = db.query_row(
            "select value from settings where key = 'backup_dir'",
            [],
            |row| row.get::<_, String>(0),
        );
        match result {
            Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
            Ok(_) | Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub fn set_backup_dir(&self, path: String) -> rusqlite::Result<()> {
        let backup_dir = PathBuf::from(path.trim());
        if !backup_dir.exists() {
            std::fs::create_dir_all(&backup_dir)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        }
        if !backup_dir.is_dir() {
            return Err(rusqlite::Error::InvalidPath(backup_dir));
        }
        let db = self.db.lock().expect("database lock poisoned");
        db.execute(
            "insert into settings (key, value) values ('backup_dir', ?1)
             on conflict(key) do update set value = excluded.value",
            params![backup_dir.to_string_lossy().to_string()],
        )?;
        drop(db);
        self.sync_backup().map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        Ok(())
    }

    pub fn sync_backup(&self) -> std::io::Result<Option<String>> {
        let backup_dir = match self.get_backup_dir().map_err(to_io_error)? {
            Some(value) => PathBuf::from(value),
            None => return Ok(None),
        };
        std::fs::create_dir_all(&backup_dir)?;
        let payload = self
            .load_workspace()
            .unwrap_or_else(|_| json!({ "schema": "acanvas.workspace.v1" }));
        let workspace_path = backup_dir.join("acanvas-workspace.json");
        std::fs::write(&workspace_path, serde_json::to_string_pretty(&payload).unwrap_or_default())?;
        sync_asset_backup(&backup_dir, &payload)?;
        Ok(Some(workspace_path.to_string_lossy().to_string()))
    }
}

fn migrate(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch(
        "
        create table if not exists workspace_snapshots (
            id text primary key,
            payload text not null,
            created_at text not null
        );

        create table if not exists boards (
            id text primary key,
            parent_board_id text,
            title text not null,
            icon text not null,
            color text not null,
            created_at text not null,
            updated_at text not null,
            sort_index integer not null default 0,
            trashed_at text
        );

        create table if not exists cards (
            id text primary key,
            board_id text not null,
            type text not null,
            x real not null,
            y real not null,
            width real not null,
            height real not null,
            z_index integer not null,
            style_json text not null,
            content_json text not null,
            created_at text not null,
            updated_at text not null,
            trashed_at text
        );

        create table if not exists assets (
            id text primary key,
            original_name text not null,
            mime_type text not null,
            size integer not null,
            sha256 text,
            relative_path text,
            thumbnail_path text,
            created_at text not null
        );

        create table if not exists column_items (
            column_card_id text not null,
            card_id text not null,
            sort_index integer not null,
            primary key (column_card_id, card_id)
        );

        create table if not exists settings (
            key text primary key,
            value text not null
        );

        create index if not exists idx_cards_board_id on cards(board_id);
        create index if not exists idx_boards_parent on boards(parent_board_id);
        ",
    )
}

fn sync_asset_backup(backup_dir: &Path, payload: &serde_json::Value) -> std::io::Result<()> {
    let assets_dir = backup_dir.join("assets");
    if assets_dir.exists() {
        std::fs::remove_dir_all(&assets_dir)?;
    }
    std::fs::create_dir_all(&assets_dir)?;
    let Some(assets) = payload.get("assets").and_then(|value| value.as_array()) else {
        return Ok(());
    };
    for asset in assets {
        let source_path = asset
            .get("sourcePath")
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty());
        let Some(source_path) = source_path else {
            continue;
        };
        let source = PathBuf::from(source_path);
        if !source.is_file() {
            continue;
        }
        let original_name = asset
            .get("originalName")
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
            .and_then(|value| Path::new(value).file_name())
            .and_then(|value| value.to_str())
            .unwrap_or("asset");
        let asset_id = asset
            .get("id")
            .and_then(|value| value.as_str())
            .unwrap_or("asset");
        let destination = assets_dir.join(format!("{}-{}", sanitize_file_name(asset_id), sanitize_file_name(original_name)));
        std::fs::copy(source, destination)?;
    }
    Ok(())
}

fn sanitize_file_name(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => ch,
        })
        .collect()
}

fn to_io_error(error: rusqlite::Error) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::Other, error.to_string())
}

pub fn fetch_link_preview(url: &str) -> Result<LinkPreview, Box<dyn std::error::Error>> {
    let body = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()?
        .get(url)
        .send()?
        .text()?;
    let document = Html::parse_document(&body);
    let title = select_meta(&document, "meta[property='og:title']")
        .or_else(|| select_text(&document, "title"))
        .unwrap_or_else(|| url.to_string());
    let description = select_meta(&document, "meta[property='og:description']")
        .or_else(|| select_meta(&document, "meta[name='description']"))
        .unwrap_or_default();
    let image_url = select_meta(&document, "meta[property='og:image']");

    Ok(LinkPreview {
        url: url.to_string(),
        title,
        description,
        image_url,
    })
}

fn select_meta(document: &Html, selector: &str) -> Option<String> {
    let selector = Selector::parse(selector).ok()?;
    document
        .select(&selector)
        .next()
        .and_then(|element| element.value().attr("content"))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn select_text(document: &Html, selector: &str) -> Option<String> {
    let selector = Selector::parse(selector).ok()?;
    document
        .select(&selector)
        .next()
        .map(|element| element.text().collect::<Vec<_>>().join(" ").trim().to_string())
        .filter(|value| !value.is_empty())
}
