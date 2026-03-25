// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use midir::{MidiOutput, MidiOutputConnection};
use std::sync::Mutex;
use tauri::State;

struct MidiState {
    connection: Mutex<Option<MidiOutputConnection>>,
}

#[tauri::command]
fn get_midi_ports() -> Vec<String> {
    match MidiOutput::new("midi-keyboard-query") {
        Ok(midi_out) => midi_out
            .ports()
            .iter()
            .filter_map(|p| midi_out.port_name(p).ok())
            .collect(),
        Err(_) => vec![],
    }
}

#[tauri::command]
fn connect_port(state: State<MidiState>, port_index: usize) -> Result<String, String> {
    let midi_out = MidiOutput::new("midi-keyboard").map_err(|e| e.to_string())?;
    let ports = midi_out.ports();
    let port = ports.get(port_index).ok_or("Invalid port index")?;
    let port_name = midi_out.port_name(port).unwrap_or_default();
    let conn = midi_out
        .connect(port, "midi-keyboard-conn")
        .map_err(|e| e.to_string())?;
    *state.connection.lock().unwrap() = Some(conn);
    Ok(port_name)
}

#[tauri::command]
fn disconnect(state: State<MidiState>) {
    *state.connection.lock().unwrap() = None;
}

#[tauri::command]
fn note_on(state: State<MidiState>, channel: u8, note: u8, velocity: u8) -> Result<(), String> {
    let mut guard = state.connection.lock().unwrap();
    match guard.as_mut() {
        Some(conn) => conn
            .send(&[0x90 | (channel & 0x0F), note & 0x7F, velocity & 0x7F])
            .map_err(|e| e.to_string()),
        None => Err("No MIDI port connected".to_string()),
    }
}

#[tauri::command]
fn send_cc(state: State<MidiState>, channel: u8, cc: u8, value: u8) -> Result<(), String> {
    let mut guard = state.connection.lock().unwrap();
    match guard.as_mut() {
        Some(conn) => conn
            .send(&[0xB0 | (channel & 0x0F), cc & 0x7F, value & 0x7F])
            .map_err(|e| e.to_string()),
        None => Err("No MIDI port connected".to_string()),
    }
}

#[tauri::command]
fn program_change(state: State<MidiState>, channel: u8, program: u8) -> Result<(), String> {
    let mut guard = state.connection.lock().unwrap();
    match guard.as_mut() {
        Some(conn) => conn
            .send(&[0xC0 | (channel & 0x0F), program & 0x7F])
            .map_err(|e| e.to_string()),
        None => Err("No MIDI port connected".to_string()),
    }
}

#[tauri::command]
fn note_off(state: State<MidiState>, channel: u8, note: u8) -> Result<(), String> {
    let mut guard = state.connection.lock().unwrap();
    match guard.as_mut() {
        Some(conn) => conn
            .send(&[0x80 | (channel & 0x0F), note & 0x7F, 0])
            .map_err(|e| e.to_string()),
        None => Err("No MIDI port connected".to_string()),
    }
}

fn main() {
    tauri::Builder::default()
        .manage(MidiState {
            connection: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_midi_ports,
            connect_port,
            disconnect,
            note_on,
            note_off,
            send_cc,
            program_change,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
