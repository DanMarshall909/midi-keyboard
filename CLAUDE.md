# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Tauri 2 desktop app that turns the PC keyboard into a MIDI output device. The Rust backend sends MIDI via `midir`; the frontend renders a piano UI and maps keypresses to notes.

## Commands

```bash
# Install JS dependencies (first time / after package.json changes)
npm install

# Run in development (starts Vite dev server + Tauri window)
npm run tauri dev

# Build a release bundle
npm run tauri build

# Vite only (no Tauri window — useful for UI work in a browser)
npm run dev
```

## Architecture

```
index.html          # Shell: toolbar + keyboard container + hint bar
src/
  main.js           # All frontend logic (key mapping, piano rendering, Tauri invoke calls)
  styles.css        # Piano keyboard visuals
src-tauri/
  src/main.rs       # Tauri commands: get_midi_ports, connect_port, disconnect, note_on, note_off
  Cargo.toml        # midir + tauri + serde
  tauri.conf.json   # Window size (860×320, non-resizable), build config
  capabilities/default.json  # Tauri 2 permission manifest
```

### Data flow

1. User selects a MIDI output port from the dropdown → `connect_port(portIndex)` Tauri command stores a `MidiOutputConnection` in `Mutex<Option<MidiOutputConnection>>` app state.
2. `keydown` / mouse `mousedown` on a piano key → `note_on(channel, note, velocity)` command → `midir` sends `0x90` message.
3. `keyup` / `mouseup` / `mouseleave` / window blur → `note_off` command → `midir` sends `0x80` message.

### PC keyboard layout (GarageBand-style)

```
Lower octave (baseOctave):    z s x d c v g b h n j m
Upper octave (baseOctave+1):  q 2 w 3 e r 5 t 6 y 7 u i
```

`KEY_MAP` in `main.js` maps each key to a semitone offset (0–24). `midiNoteFromKey()` converts to absolute MIDI note: `baseOctave * 12 + 12 + offset`.

### State that lives in Rust

- `MidiOutputConnection` — only one port open at a time; swapped on `connect_port`, dropped on `disconnect`.

### State that lives in JS

- `baseOctave` — shifted by the +/− octave buttons (range 0–8, default 4).
- `velocity`, `channel` — set by toolbar controls.
- `heldKeys` Set — prevents key-repeat re-triggering note_on.
- `noteToEl` map — MIDI note → DOM element for visual feedback.

## Notes

- `midir` on Windows uses WinMM. A virtual MIDI loopback (e.g. loopMIDI) is needed if you want to route output to a DAW without a physical MIDI device.
- The window is intentionally non-resizable (piano key widths are fixed at 50 px).
- Icons in `src-tauri/icons/` must be generated before a release build (`npm run tauri icon <source-image>`).
