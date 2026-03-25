# MIDI Keyboard

[![GitHub Release](https://img.shields.io/github/v/release/DanMarshall909/midi-keyboard)](https://github.com/DanMarshall909/midi-keyboard/releases/latest)

A lightweight desktop app that turns your PC keyboard into a MIDI output device. Built with Tauri 2 + Rust + vanilla JS.

## Download

| Platform | Download |
| --- | --- |
| Windows (MSI) | [midi-keyboard_x64_en-US.msi](https://github.com/DanMarshall909/midi-keyboard/releases/latest/download/midi-keyboard_0.1.0_x64_en-US.msi) |
| Windows (EXE) | [midi-keyboard_x64-setup.exe](https://github.com/DanMarshall909/midi-keyboard/releases/latest/download/midi-keyboard_0.1.0_x64-setup.exe) |
| macOS (Apple Silicon) | [midi-keyboard_aarch64.dmg](https://github.com/DanMarshall909/midi-keyboard/releases/latest/download/midi-keyboard_aarch64.dmg) |
| macOS (Intel) | [midi-keyboard_x64.dmg](https://github.com/DanMarshall909/midi-keyboard/releases/latest/download/midi-keyboard_x64.dmg) |
| Linux (Debian/Ubuntu) | [midi-keyboard_amd64.deb](https://github.com/DanMarshall909/midi-keyboard/releases/latest/download/midi-keyboard_amd64.deb) |
| Linux (AppImage) | [midi-keyboard_amd64.AppImage](https://github.com/DanMarshall909/midi-keyboard/releases/latest/download/midi-keyboard_amd64.AppImage) |

Or browse all releases on the [Releases page](https://github.com/DanMarshall909/midi-keyboard/releases).

### Platform notes

**Windows** — uses WinMM. A physical MIDI device or a virtual loopback (e.g. [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html)) is needed to route output to a DAW.

**macOS** — uses CoreMIDI (built-in). To route to a DAW without a physical device, use the built-in IAC Driver: open *Audio MIDI Setup → Window → Show MIDI Studio*, double-click *IAC Driver*, and enable it.

**Linux** — uses ALSA. Install `libasound2` if not already present:
```bash
sudo apt install libasound2        # Debian/Ubuntu
sudo dnf install alsa-lib          # Fedora
sudo pacman -S alsa-lib            # Arch
```
A virtual MIDI loopback like [VMPK](https://vmpk.sourceforge.io/) or `snd-virmidi` kernel module can route output to a DAW.

## Features

- GarageBand-style two-octave PC keyboard mapping
- Adjustable octave (0–8), velocity, and MIDI channel
- GM patch selector (128 patches)
- Pan, Expression, Reverb, Chorus knobs
- Mod wheel + sustain pedal (Space)
- Mouse playable
- Resizable window with zoom control (⚙ Settings)

## Key Layout

```
Upper octave:  q 2 w 3 e   r 5 t 6 y 7 u
Lower octave:  z s x d c   v g b h n j m
```

White keys on the letter rows, black keys on the number/s/d/g/h/j positions.

| Key | Action |
|-----|--------|
| `z s x d c v g b h n j m` | Lower octave (C–B + sharps) |
| `q 2 w 3 e r 5 t 6 y 7 u` | Upper octave (C–B + sharps) |
| `Space` (hold) | Sustain pedal (CC 64) |
| `F1`–`F9` | Set octave 0–8 |
| `↑` / `→` | Arrow CC up by 5 |
| `↓` / `←` | Arrow CC down by 5 |
| Scroll wheel | Modulation (CC 1) ±5 |
| Middle click | Reset modulation to 0 |

## Building from source

**Prerequisites:** [Node.js 18+](https://nodejs.org/), [Rust](https://rustup.rs/)

```bash
# Windows — MSVC toolchain required
rustup default stable-x86_64-pc-windows-msvc

# Linux — ALSA dev headers required
sudo apt install libasound2-dev pkg-config libwebkit2gtk-4.1-dev

# Install and run
npm install
npm run tauri dev

# Build release installer
npm run tauri build
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Shell | [Tauri 2](https://tauri.app/) |
| MIDI output | [midir](https://github.com/Boddlnagg/midir) |
| Frontend | Vanilla JS + Vite |
