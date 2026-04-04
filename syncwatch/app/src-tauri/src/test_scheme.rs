use tauri::{http::Response, AppHandle, Manager};

pub fn run() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("syncwatch", |app: &AppHandle, req| {
            let uri = req.uri().to_string();
            Response::builder()
                .status(200)
                .body(Vec::new())
                .unwrap()
        })
        .setup(|_app| { Ok(()) })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
