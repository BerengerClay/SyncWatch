use tauri::{
    webview::WebviewBuilder,
    window::WindowBuilder,
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewUrl,
};
use tauri_plugin_opener;
use url::Url;
use serde::Deserialize;
use std::fs;

// --- CONFIGURATION ---
const WIN_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0";
const SIDEBAR_WIDTH: f64 = 350.0;
const DEV_URL: &str = "http://localhost:1420";

#[derive(Deserialize, serde::Serialize)]
struct PluginConfig {
    name: String,
    url_pattern: String,
    script_filename: String,
    #[serde(default)]
    homepage: String,
    #[serde(default)]
    color: String,
}

/// Chargeur de Plugins : Assemble Base + Script Site + Init
fn get_plugin_script_for_url(url: &str) -> String {
    let paths_to_try = vec!["plugins", "src-tauri/plugins", "../plugins"];
    let (mut plugins_json, mut core_script, mut base_script, mut root_path) = (None, None, None, None);

    for path in paths_to_try {
        let manifest = format!("{}/plugins.json", path);
        let core = format!("{}/core.js", path);
        let base = format!("{}/base.js", path);
        
        if let Ok(m) = fs::read_to_string(&manifest) {
            if let Ok(c) = fs::read_to_string(&core) {
                if let Ok(b) = fs::read_to_string(&base) {
                    plugins_json = Some(m);
                    core_script = Some(c);
                    base_script = Some(b);
                    root_path = Some(path.to_string());
                    break;
                }
            }
        }
    }

    if plugins_json.is_none() || core_script.is_none() || base_script.is_none() {
        return "".to_string();
    }

    let plugins: Vec<PluginConfig> = serde_json::from_str(&plugins_json.unwrap()).unwrap_or_default();
    let core = core_script.unwrap();
    let base = base_script.unwrap();
    let root = root_path.unwrap();

    for plugin in plugins {
        if url.contains(&plugin.url_pattern) {
            let p_path = format!("{}/{}", root, plugin.script_filename);
            let p_script = fs::read_to_string(&p_path).unwrap_or_default();
            // L'ordre est CRITIQUE : Core -> Base -> Plugin -> Initialisation
            return format!("{}\n{}\n{}\nif(window.SW_PLUGIN) window.SW_PLUGIN.init();", core, base, p_script);
        }
    }

    // Fallback HTML5
    format!("{}\n{}\nwindow.SW_PLUGIN = new BaseSyncPlugin();\nwindow.SW_PLUGIN.init();", core, base)
}

// --- COMMANDES TAURI ---

#[tauri::command]
async fn playback_control(
    app: AppHandle,
    command: String,
    data: serde_json::Value, // 🚀 PASSERELLE UNIVERSELLE : Accepte tout (bool, int, string, object)
) -> Result<(), String> {
    if let Some(player) = app.get_webview("player") {
        // On transforme l'ordre en JS. data.to_string() convertit le JSON en texte valide pour le JS.
        let js = format!("if(window.syncWatchControl) window.syncWatchControl('{}', {});", command, data);
        let _ = player.eval(&js);
    }
    Ok(())
}

#[tauri::command]
fn playback_report(app: AppHandle, payload: serde_json::Value) {
    if let Some(window) = app.get_window("main") {
        // Envoie les données (incluant le sidebarCode au début) à la Sidebar React
        let _ = window.emit("player-update", payload);
    }
}

#[tauri::command]
async fn get_plugins() -> Result<Vec<PluginConfig>, String> {
    let paths_to_try = vec!["plugins", "src-tauri/plugins", "../plugins"];
    for path in paths_to_try {
        let manifest = format!("{}/plugins.json", path);
        if let Ok(m) = fs::read_to_string(&manifest) {
            let plugins: Vec<PluginConfig> = serde_json::from_str(&m).map_err(|e| e.to_string())?;
            return Ok(plugins);
        }
    }
    Ok(vec![])
}

#[tauri::command]
fn heartbeat() {}

#[tauri::command]
async fn set_view_mode(app: AppHandle, mode: String, url: Option<String>) -> Result<(), String> {
    let native_window = app.get_window("main").ok_or("Window error")?;

    match mode.as_str() {
        "HOME" | "GROUP" => {
            if let Some(player) = app.get_webview("player") { let _ = player.close(); }
            update_layout(&app); // Repasse en plein écran
        }
        "WATCH" => {
            if let Some(target_url) = url {
                let parsed = Url::parse(&target_url).map_err(|e| e.to_string())?;
                let full_script = get_plugin_script_for_url(&target_url);

                let app_clone = app.clone();
                let builder = WebviewBuilder::new("player", WebviewUrl::External(parsed));
                
                // Shim pour window.open : le SDK Google plante si window.open renvoie null.
                // On renvoie un objet factice pour que le SDK continue son exécution.
                let shim = r#"
                    (function() {
                        const oldOpen = window.open;
                        window.open = function() {
                            const win = oldOpen.apply(this, arguments);
                            if (!win && arguments.length > 0) {
                                console.log('[SyncWatch] Popup interceptée, retour du shim pour compatibilité SDK');
                                return { closed: false, close: () => {}, focus: () => {}, postMessage: () => {}, location: { href: arguments[0] } };
                            }
                            return win;
                        };
                    })();
                "#;

                let builder = builder
                    .user_agent(WIN_UA)
                    .initialization_script(&format!("{}\n{}", shim, full_script))
                    .on_new_window(move |url, _features| {
                        // 🌍 Ouvre les popups dans une nouvelle fenêtre native Tauri avec le bon User Agent
                        let label = format!("popup-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());
                        let _ = tauri::webview::WebviewWindowBuilder::new(&app_clone, label, WebviewUrl::External(url))
                            .title("Authentification")
                            .user_agent(WIN_UA)
                            .inner_size(600.0, 700.0)
                            .build();
                        tauri::webview::NewWindowResponse::Deny
                    });

                let _player = native_window
                    .add_child(builder, Position::Logical(LogicalPosition::new(SIDEBAR_WIDTH, 0.0)), Size::Logical(LogicalSize::new(100.0, 100.0)))
                    .map_err(|e| e.to_string())?;

                update_layout(&app);
            }
        }
        _ => {}
    }
    Ok(())
}

// --- ENGINE & RUN ---

fn update_layout(app: &AppHandle) {
    if let Some(window) = app.get_window("main") {
        let physical = window.inner_size().unwrap();
        let logical = physical.to_logical::<f64>(window.scale_factor().unwrap_or(1.0));
        
        if let Some(sidebar) = app.get_webview("sidebar") {
            if let Some(player) = app.get_webview("player") {
                let _ = sidebar.set_bounds(tauri::Rect {
                    position: Position::Logical(LogicalPosition::new(0.0, 0.0)),
                    size: Size::Logical(LogicalSize::new(SIDEBAR_WIDTH, logical.height)),
                });
                let _ = player.set_bounds(tauri::Rect {
                    position: Position::Logical(LogicalPosition::new(SIDEBAR_WIDTH, 0.0)),
                    size: Size::Logical(LogicalSize::new((logical.width - SIDEBAR_WIDTH).max(0.0), logical.height)),
                });
            } else {
                let _ = sidebar.set_bounds(tauri::Rect {
                    position: Position::Logical(LogicalPosition::new(0.0, 0.0)),
                    size: Size::Logical(LogicalSize::new(logical.width, logical.height)),
                });
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let window = WindowBuilder::new(app, "main")
                .title("SyncWatch Pro")
                .inner_size(1280.0, 720.0)
                .build()?;

            let sidebar_url = if cfg!(debug_assertions) { 
                WebviewUrl::External(Url::parse(DEV_URL).unwrap()) 
            } else { 
                WebviewUrl::App("index.html".into()) 
            };

            let _sidebar = window.add_child(
                WebviewBuilder::new("sidebar", sidebar_url).user_agent(WIN_UA),
                Position::Logical(LogicalPosition::new(0.0, 0.0)),
                Size::Logical(LogicalSize::new(SIDEBAR_WIDTH, 720.0)),
            )?;

            let handle = app.app_handle().clone();
            window.on_window_event(move |e| if let tauri::WindowEvent::Resized(_) = e { update_layout(&handle); });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![set_view_mode, playback_control, playback_report, get_plugins, heartbeat])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}