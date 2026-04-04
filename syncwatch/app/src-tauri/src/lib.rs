use tauri::{
    webview::WebviewBuilder,
    window::WindowBuilder,
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewUrl,
};
use url::Url;

// --- CONFIGURATION ---
const WIN_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0";
const SIDEBAR_WIDTH: f64 = 350.0;
const DEV_URL: &str = "http://localhost:1420";

const PLAYER_BRIDGE_SCRIPT: &str = r#"
    (function() {
        console.log('[SyncWatch] Core API Bridge Active');
        window.navigator.managed = { enabled: false };

        function sendToRust(cmd, args) {
            // Méthode officielle Tauri 2.0 : Utilise l'API interne si elle est injectée
            if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
                window.__TAURI_INTERNALS__.invoke(cmd, args).catch(() => {});
            } 
            // Fallback robuste : si l'API n'est pas prête mais que la Capability a fourni la clé secrète
            else if (window.ipc && window.__TAURI_INVOKE_KEY__) {
                window.ipc.postMessage(JSON.stringify({
                    cmd: cmd,
                    callback: Math.floor(Math.random() * 1000000),
                    error: Math.floor(Math.random() * 1000000),
                    __TAURI_INVOKE_KEY__: window.__TAURI_INVOKE_KEY__,
                    ...args
                }));
            }
        }

        setInterval(() => {
            const v = document.querySelector('video');
            if (v && !isNaN(v.duration) && v.duration > 0) {
                sendToRust('playback_report', {
                    t: v.currentTime,
                    d: v.duration,
                    p: v.paused ? 1 : 0
                });
            }
        }, 500);

        window.syncWatchControl = function(cmd, data) {
            const v = document.querySelector('video');
            if (!v) return;
            if (cmd === 'play') v.play().catch(() => {});
            if (cmd === 'pause') v.pause();
            if (cmd === 'seek') v.currentTime = data;
        };
    })();
"#;

// --- LAYOUT ENGINE ---

fn update_layout(app: &AppHandle) {
    if let Some(window) = app.get_window("main") {
        if let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) {
            let logical = size.to_logical::<f64>(scale);
            let player_exists = app.get_webview("player").is_some();
            let current_sidebar_width = if player_exists { SIDEBAR_WIDTH } else { logical.width };

            if let Some(sidebar) = app.get_webview("sidebar") {
                let _ = sidebar.set_bounds(tauri::Rect {
                    position: Position::Logical(LogicalPosition::new(0.0, 0.0)),
                    size: Size::Logical(LogicalSize::new(current_sidebar_width, logical.height)),
                });
            }

            if let Some(player) = app.get_webview("player") {
                let player_width = (logical.width - SIDEBAR_WIDTH).max(0.0);
                let _ = player.set_bounds(tauri::Rect {
                    position: Position::Logical(LogicalPosition::new(SIDEBAR_WIDTH, 0.0)),
                    size: Size::Logical(LogicalSize::new(player_width, logical.height)),
                });
            }
        }
    }
}

// --- COMMANDS ---

#[tauri::command]
async fn playback_control(
    app: AppHandle,
    command: String,
    data: Option<f64>,
) -> Result<(), String> {
    if let Some(player) = app.get_webview("player") {
        let js = match command.as_str() {
            "play" => "window.syncWatchControl('play')".to_string(),
            "pause" => "window.syncWatchControl('pause')".to_string(),
            "seek" => format!("window.syncWatchControl('seek', {})", data.unwrap_or(0.0)),
            _ => return Ok(()),
        };
        let _ = player.eval(&js);
    }
    Ok(())
}

#[tauri::command]
fn playback_report(app: AppHandle, t: f64, d: f64, p: i32) {
    if let Some(window) = app.get_window("main") {
        let _ = window.set_title(&format!("SyncWatch [RECUPERATION OK] - {:.0}s", t));
    }

    let payload = serde_json::json!({ "t": t, "d": d, "p": p });
    
    // Diffusion globale vers React
    let _ = app.emit("player-update", payload);
}

#[tauri::command]
fn heartbeat(_app: AppHandle) {
}

#[tauri::command]
async fn set_view_mode(
    app: AppHandle,
    mode: String,
    url: Option<String>,
) -> Result<(), String> {
    let native_window = app.get_window("main").ok_or("Main window not found")?;

    match mode.as_str() {
        "HOME" => {
            if let Some(player) = app.get_webview("player") {
                let _ = player.close();
                update_layout(&app);
            }
        }
        "WATCH" => {
            if let Some(player) = app.get_webview("player") {
                if let Some(target_url) = url {
                    let _ = player.navigate(target_url.parse().unwrap());
                }
            } else if let Some(target_url) = url {
                let parsed: Url = target_url.parse().map_err(|e: url::ParseError| e.to_string())?;
                
                // Finie la fausse ligne directe ! On construit un lecteur parfaitement standard.
                let builder = WebviewBuilder::new("player", WebviewUrl::External(parsed))
                    .initialization_script(PLAYER_BRIDGE_SCRIPT);

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
    
// --- MAIN RUN ---

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app: &mut tauri::App| {
            let window = WindowBuilder::new(app, "main")
                .title("SyncWatch Pro")
                .inner_size(1400.0, 900.0)
                .resizable(true)
                .build()
                .map_err(|e| e.to_string())?;

            let sidebar_url = if cfg!(debug_assertions) { 
                WebviewUrl::External(Url::parse(DEV_URL).unwrap()) 
            } else { 
                WebviewUrl::App("index.html".into()) 
            };

            let sidebar_builder = WebviewBuilder::new("sidebar", sidebar_url).user_agent(WIN_UA);
            let _sidebar = window
                .add_child(sidebar_builder, Position::Logical(LogicalPosition::new(0.0, 0.0)), Size::Logical(LogicalSize::new(1400.0, 900.0)))
                .map_err(|e| e.to_string())?;

            let app_handle = app.app_handle().clone();
            let app_handle_resize = app_handle.clone();
            
            update_layout(&app_handle);

            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Resized(_) = event {
                    update_layout(&app_handle_resize);
                }
            });

            Ok(())
        })
        // La fonction playback_report a bien retrouvé sa place !
        .invoke_handler(tauri::generate_handler![set_view_mode, playback_control, playback_report, heartbeat])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}