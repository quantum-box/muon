use std::fs;
use std::path::Path;

fn main() {
    // `#[derive(Embed)] #[folder = "ui/dist"]` in src/server/mod.rs
    // requires the folder to exist at compile time, but ui/dist is a
    // gitignored Vite build artifact. Create an empty placeholder so
    // `cargo build` succeeds on fresh checkouts and in environments
    // that build the Rust binary without building the UI first
    // (e.g. Tachyon Cloud App autobuild). The server falls back to
    // 404 "Frontend not found" when the embedded folder is empty.
    let dist = Path::new("ui/dist");
    if !dist.exists() {
        fs::create_dir_all(dist)
            .expect("failed to create ui/dist placeholder");
    }
    println!("cargo:rerun-if-changed=ui/dist");
}
