// Prevents an additional console window on Windows in release.
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod commands;
mod db;
mod import;

use db::HistoryDb;
use std::sync::Arc;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            // Initialize SQLite history database
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            let db_path = app_dir.join("history.db");
            let history_db = Arc::new(
                HistoryDb::open(&db_path)
                    .expect("failed to open history database"),
            );
            app.manage(history_db);

            // System tray
            setup_tray(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_scenarios,
            commands::get_scenario,
            commands::run_scenario,
            commands::create_scenario,
            commands::update_scenario,
            commands::delete_scenario,
            commands::validate_yaml,
            commands::list_environments,
            commands::save_environment,
            commands::delete_environment,
            commands::import_postman,
            commands::import_curl,
            commands::import_openapi,
            commands::get_run_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Muon desktop app");
}

/// Configure the system tray icon and menu.
fn setup_tray(
    app: &tauri::App,
) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};
    use tauri::tray::TrayIconBuilder;
    use tauri::{Emitter, Manager};

    let show =
        MenuItemBuilder::with_id("show", "Show Muon").build(app)?;
    let quit =
        MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    let menu =
        MenuBuilder::new(app).items(&[&show, &quit]).build()?;

    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Muon API Platform")
        .on_menu_event(move |app, event| {
            match event.id().as_ref() {
                "show" => {
                    if let Some(w) = app.get_webview_window("main")
                    {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                "quit" => {
                    let _ = app.emit("app-quit", ());
                    app.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}
