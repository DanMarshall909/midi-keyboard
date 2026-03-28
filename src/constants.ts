// ── Key → MIDI note mapping (GarageBand layout) ──────────────────────────────
export const KEY_MAP: Record<string, number> = {
  z: 0,  s: 1,  x: 2,  d: 3,  c: 4,
  v: 5,  g: 6,  b: 7,  h: 8,  n: 9,  j: 10, m: 11,
  q: 12, 2: 13, w: 14, 3: 15, e: 16,
  r: 17, 5: 18, t: 19, 6: 20, y: 21, 7: 22, u: 23,
};

// ── General MIDI patch names (program 0–127) ──────────────────────────────────
export const GM_PATCHES: [string, string[]][] = [
  ["Piano",          ["Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-tonk Piano", "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavi"]],
  ["Chromatic Perc", ["Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular Bells", "Dulcimer"]],
  ["Organ",          ["Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ", "Accordion", "Harmonica", "Tango Accordion"]],
  ["Guitar",         ["Nylon Guitar", "Steel Guitar", "Jazz Guitar", "Clean Guitar", "Muted Guitar", "Overdriven Guitar", "Distortion Guitar", "Guitar Harmonics"]],
  ["Bass",           ["Acoustic Bass", "Finger Bass", "Pick Bass", "Fretless Bass", "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2"]],
  ["Strings",        ["Violin", "Viola", "Cello", "Contrabass", "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani"]],
  ["Ensemble",       ["String Ensemble 1", "String Ensemble 2", "Synth Strings 1", "Synth Strings 2", "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit"]],
  ["Brass",          ["Trumpet", "Trombone", "Tuba", "Muted Trumpet", "French Horn", "Brass Section", "Synth Brass 1", "Synth Brass 2"]],
  ["Reed",           ["Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet"]],
  ["Pipe",           ["Piccolo", "Flute", "Recorder", "Pan Flute", "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina"]],
  ["Synth Lead",     ["Square Lead", "Sawtooth Lead", "Calliope Lead", "Chiff Lead", "Charang Lead", "Voice Lead", "Fifths Lead", "Bass+Lead"]],
  ["Synth Pad",      ["New Age Pad", "Warm Pad", "Polysynth Pad", "Choir Pad", "Bowed Pad", "Metallic Pad", "Halo Pad", "Sweep Pad"]],
  ["Synth FX",       ["Rain FX", "Soundtrack FX", "Crystal FX", "Atmosphere FX", "Brightness FX", "Goblins FX", "Echoes FX", "Sci-fi FX"]],
  ["Ethnic",         ["Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bag Pipe", "Fiddle", "Shanai"]],
  ["Percussive",     ["Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal"]],
  ["Sound FX",       ["Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet", "Telephone Ring", "Helicopter", "Applause", "Gunshot"]],
];

export const GM_PATCH_NAMES = GM_PATCHES.flatMap(([, names]) => names);

// ── Piano layout ──────────────────────────────────────────────────────────────
export const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11] as const;

export interface BlackKeyDef { semitone: number; whitePos: number }
export const BLACK_KEY_DEFS: BlackKeyDef[] = [
  { semitone: 1, whitePos: 0.5 },
  { semitone: 3, whitePos: 1.5 },
  { semitone: 6, whitePos: 3.5 },
  { semitone: 8, whitePos: 4.5 },
  { semitone: 10, whitePos: 5.5 },
];

// ── Key + body dimensions (Three.js units) ────────────────────────────────────
export const WKW = 1.05, WKH = 0.18, WKD = 4.2; // white key w/h/d
export const BKW = 0.63, BKH = 0.24, BKD = 3;   // black key
export const KEY_GAP = 0.05;
export const DISPLAY_OCTAVES = 2;
export const BODY_D = WKD + 1.0;
export const HEAD_H = 0.7;
export const HEAD_D = 1.5;
export const KNOB_R = 0.50;
export const KEY_OFFSET_X = 3.0;

// ── Scene knob definitions ────────────────────────────────────────────────────
export interface KnobDef { id: string; cc: number; min: number; max: number; value: number; label: string }
export const SCENE_KNOBS: KnobDef[] = [
  { id: 'vel',  cc: -1, min: 1,   max: 127, value: 100, label: 'VEL' },
  { id: 'pan',  cc: 10, min: 0,   max: 127, value: 64,  label: 'PAN' },
  { id: 'expr', cc: 11, min: 0,   max: 127, value: 127, label: 'EXP' },
  { id: 'rev',  cc: 91, min: 0,   max: 127, value: 0,   label: 'REV' },
  { id: 'cho',  cc: 93, min: 0,   max: 127, value: 0,   label: 'CHO' },
];

// ── Theme lighting configs ────────────────────────────────────────────────────
interface LightConfig { color: number; intensity: number }
export interface ThemeLightCfg { sun: LightConfig; fill: LightConfig }
export const THEME_LIGHTS: Record<string, ThemeLightCfg> = {
  default:  { sun: { color: 0xfffaf0, intensity: 1.1 },  fill: { color: 0x00e8ff, intensity: 0.9 } },
  midnight: { sun: { color: 0xd0d8ff, intensity: 0.65 }, fill: { color: 0x203070, intensity: 0.35 } },
  synthwave:{ sun: { color: 0xff00ff, intensity: 1.3 },  fill: { color: 0x00ffff, intensity: 1.0 } },
  ember:    { sun: { color: 0xff9900, intensity: 1.4 },  fill: { color: 0xff4400, intensity: 0.7 } },
  matrix:   { sun: { color: 0x00ff66, intensity: 1.2 },  fill: { color: 0x00aa44, intensity: 0.15 } },
};

// ── Arrow CC options ──────────────────────────────────────────────────────────
export const ARROW_CC_OPTIONS: [number, string][] = [
  [1, "1 – Mod Wheel"], [7, "7 – Volume"], [10, "10 – Pan"],
  [11, "11 – Expression"], [64, "64 – Sustain"], [71, "71 – Resonance"],
  [74, "74 – Brightness"], [91, "91 – Reverb"], [93, "93 – Chorus"],
];
