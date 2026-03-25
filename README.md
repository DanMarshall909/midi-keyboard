# MIDI Keyboard

A lightweight desktop app that turns your PC keyboard into a MIDI output device. Built with Tauri 2 + Rust + vanilla JS.

![piano keyboard UI with dark theme]

## Features

- GarageBand-style two-octave PC keyboard mapping
- Adjustable octave (0–8), velocity, and MIDI channel
- Real MIDI output via WinMM — works with any DAW or MIDI-aware app
- Mouse playable too

## Key Layout

```
Upper octave:  q 2 w 3 e r 5 t 6 y 7 u i
Lower octave:  z s x d c v g b h n j m
```

White keys on the letter rows, black keys on the number/s/d/g/h/j positions.

## Requirements

- Windows (WinMM backend)
- A MIDI output port — physical device **or** a virtual loopback like [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html)
- [Rust + Cargo](https://rustup.rs/) (MSVC toolchain: `rustup default stable-x86_64-pc-windows-msvc`)
- Node.js 18+

## Getting Started

```bash
npm install
npm run tauri dev
```

Select a MIDI output port from the dropdown, then start playing.

## Build

```bash
npm run tauri build
```

Installer will be in `src-tauri/target/release/bundle/`.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Shell | [Tauri 2](https://tauri.app/) |
| MIDI output | [midir](https://github.com/Boddlnagg/midir) (WinMM) |
| Frontend | Vanilla JS + Vite |
