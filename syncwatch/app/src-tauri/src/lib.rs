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

const CORE_BRIDGE_SCRIPT: &str = r#"
    (function() {
        if (window.__SYNCWATCH_INJECTED__) return;
        window.__SYNCWATCH_INJECTED__ = true;

        console.log('[SyncWatch] Core Bridge Active on', window.location.hostname);
        window.navigator.managed = { enabled: false };

        const plugin = window.SW_PLUGIN || {
            getVideo: () => document.querySelector('video'),
            getIframe: () => null, // Par défaut, pas d'iframe spécifique
            play: (v) => v && v.play().catch(() => {}),
            pause: (v) => v && v.pause(),
            seek: (v, t) => { if (v) v.currentTime = t; }
        };

        setInterval(() => {
            const v = plugin.getVideo();
            if (v && v.tagName === 'VIDEO' && !isNaN(v.duration) && v.duration > 0) {
                const payload = { t: v.currentTime, d: v.duration, p: v.paused ? 1 : 0 };
                if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
                    window.__TAURI_INTERNALS__.invoke('playback_report', payload).catch(() => {});
                } else if (window.ipc && window.__TAURI_INVOKE_KEY__) {
                    window.ipc.postMessage(JSON.stringify({
                        cmd: 'playback_report', ...payload, callback: 0, error: 0,
                        __TAURI_INVOKE_KEY__: window.__TAURI_INVOKE_KEY__
                    }));
                }
            }
        }, 500);

        window.syncWatchControl = function(cmd, data) {
            const v = plugin.getVideo();
            
            if (v && v.tagName === 'VIDEO') {
                console.log('[SyncWatch] 🎬 Ordre', cmd, 'appliqué');
                if (cmd === 'play') plugin.play(v);
                if (cmd === 'pause') plugin.pause(v);
                if (cmd === 'seek') plugin.seek(v, data);
            } else {
                // CIBLAGE CHIRURGICAL : On demande au plugin s'il connait l'iframe cible
                const frame = plugin.getIframe ? plugin.getIframe() : null;
                if (frame && frame.contentWindow) {
                    console.log('[SyncWatch] 📡 Relais de l\'ordre à l\'iframe cible...');
                    frame.contentWindow.postMessage({ type: 'SYNCWATCH_CMD', cmd: cmd, data: data }, '*');
                }
            }
        };

        window.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'SYNCWATCH_CMD') {
                window.syncWatchControl(event.data.cmd, event.data.data);
            }
        });
    })();
"#;

fn get_plugin_script_for_url(url: &str) -> String {
    if url.contains("tf1.fr") {
        r#"
        window.SW_PLUGIN = {
            name: 'TF1+ Plugin',
            getVideo: () => document.querySelector('#ntrs-video-media'),
            getIframe: () => document.querySelector('iframe[src*="prod-player.tf1.fr"]'),
            play: (v) => v && v.play().catch(() => {}),
            pause: (v) => v && v.pause(),
            seek: (v, t) => { if (v) v.currentTime = t; }
        };
        "#.to_string()
    } else if url.contains("youtube.com") {
        r#"
        window.SW_PLUGIN = {
            name: 'YouTube Plugin',
            getVideo: () => document.querySelector('video'),
            getIframe: () => null,
            play: (v) => v && v.play().catch(() => {}),
            pause: (v) => v && v.pause(),
            seek: (v, t) => { if (v) v.currentTime = t; }
        };
        "#.to_string()
    } else {
        "".to_string()
    }
}

// --- LAYOUT ENGINE ---

fn update_layout(app: &AppHandle) {
    if let Some(window) = app.get_window("main") {
        let scale_factor = window.scale_factor().unwrap_or(1.0);
        let physical = window.inner_size().unwrap();
        let logical = physical.to_logical::<f64>(scale_factor);
        let width = logical.width;
        let height = logical.height;

        if let Some(sidebar) = app.get_webview("sidebar") {
            if let Some(player) = app.get_webview("player") {
                let _ = sidebar.set_bounds(tauri::Rect {
                    position: Position::Logical(LogicalPosition::new(0.0, 0.0)),
                    size: Size::Logical(LogicalSize::new(SIDEBAR_WIDTH, height)),
                });
                
                let player_width = (width - SIDEBAR_WIDTH).max(0.0);
                let _ = player.set_bounds(tauri::Rect {
                    position: Position::Logical(LogicalPosition::new(SIDEBAR_WIDTH, 0.0)),
                    size: Size::Logical(LogicalSize::new(player_width, height)),
                });
            } else {
                let _ = sidebar.set_bounds(tauri::Rect {
                    position: Position::Logical(LogicalPosition::new(0.0, 0.0)),
                    size: Size::Logical(LogicalSize::new(width, height)),
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
        "HOME" | "GROUP" => {
            if let Some(player) = app.get_webview("player") {
                let _ = player.close();
            }
            // On force un petit délai ou on appelle update_layout avec la certitude que player n'est plus là.
            // En fait, update_layout vérifie Some(player), donc on peut forcer le layout plein écran ici.
            if let Some(sidebar) = app.get_webview("sidebar") {
                let scale_factor = native_window.scale_factor().unwrap_or(1.0);
                let physical = native_window.inner_size().unwrap();
                let logical = physical.to_logical::<f64>(scale_factor);
                
                let _ = sidebar.set_bounds(tauri::Rect {
                    position: Position::Logical(LogicalPosition::new(0.0, 0.0)),
                    size: Size::Logical(LogicalSize::new(logical.width, logical.height)),
                });
            }
        }
        "WATCH" => {
            if let Some(player) = app.get_webview("player") {
                if let Some(target_url) = url {
                    let _ = player.navigate(target_url.parse().unwrap());
                }
            } else if let Some(target_url) = url {
                let parsed: Url = target_url.parse().map_err(|e: url::ParseError| e.to_string())?;
                
                // On assemble le plugin spécifique et le moteur de base
                let plugin_script = get_plugin_script_for_url(&target_url);
                let full_script = format!("{}\n{}", plugin_script, CORE_BRIDGE_SCRIPT);

                let builder = WebviewBuilder::new("player", WebviewUrl::External(parsed))
                    .initialization_script(&full_script);

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