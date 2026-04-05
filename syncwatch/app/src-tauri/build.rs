use std::fs;
use serde::Deserialize;

#[derive(Deserialize)]
struct Plugin {
    url_pattern: String,
}

fn main() {
    // 🚀 AUTOMATION DES CAPABILITIES
    // Cette partie lit plugins.json et met à jour automatiquement remote-player.json
    let plugins_path = "plugins/plugins.json";
    if let Ok(content) = fs::read_to_string(plugins_path) {
        let plugins: Vec<Plugin> = serde_json::from_str(&content).unwrap_or_default();
        
        // Domaines de base (Authentification, etc.)
        let mut urls = vec![
            "https://*.google.com".to_string(),
            "https://*.accounts.google.com".to_string(),
            "https://*.facebook.com".to_string(),
            "https://*.apple.com".to_string(),
        ];

        // Ajout des domaines des plugins
        for p in plugins {
            if !p.url_pattern.is_empty() {
                urls.push(format!("https://{}", p.url_pattern));
                urls.push(format!("https://*.{}", p.url_pattern));
            }
        }
        
        // Doublons (certains plugins peuvent partager des domaines)
        urls.sort();
        urls.dedup();

        let capability = serde_json::json!({
            "$schema": "../gen/schemas/desktop-schema.json",
            "identifier": "remote-player-access",
            "description": "Généré automatiquement par build.rs depuis plugins.json",
            "windows": ["main", "player", "popup-*"],
            "webviews": ["player", "popup-*"],
            "remote": { "urls": urls },
            "permissions": [
                "core:default",
                "core:webview:allow-internal-toggle-devtools",
                "core:event:allow-emit",
                "core:event:allow-listen",
                "allow-playback-commands"
            ]
        });

        // On s'assure que le dossier existe
        fs::create_dir_all("capabilities").ok();
        
        let new_content = serde_json::to_string_pretty(&capability).unwrap();
        let target_path = "capabilities/remote-player.json";

        // 🔥 FIX: On n'écrit que si le contenu a changé pour éviter la boucle infinie de compilation
        let should_write = match fs::read_to_string(target_path) {
            Ok(old_content) => old_content != new_content,
            Err(_) => true,
        };

        if should_write {
            fs::write(target_path, new_content).ok();
        }

        // On dit à Cargo de surveiller plugins.json
        println!("cargo:rerun-if-changed=plugins/plugins.json");
    }

    tauri_build::build()
}
