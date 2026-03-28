import { invoke } from "@tauri-apps/api/core";

// Raw Tauri invoke wrappers — no UI side-effects.

export async function noteOn(channel: number, note: number, velocity: number): Promise<void> {
  await invoke("note_on", { channel, note, velocity });
}

export async function noteOff(channel: number, note: number): Promise<void> {
  await invoke("note_off", { channel, note });
}

export async function sendCC(channel: number, cc: number, value: number): Promise<void> {
  await invoke("send_cc", { channel, cc, value });
}

export async function programChange(channel: number, program: number): Promise<void> {
  await invoke("program_change", { channel, program });
}

export async function pitchBend(channel: number, value: number): Promise<void> {
  await invoke("pitch_bend", { channel, value });
}

export async function getMidiPorts(): Promise<string[]> {
  return invoke("get_midi_ports");
}

export async function connectPort(portIndex: number): Promise<string> {
  return invoke("connect_port", { portIndex });
}

export async function disconnect(): Promise<void> {
  await invoke("disconnect");
}
