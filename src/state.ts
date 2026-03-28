// Mutable runtime state shared across modules.
// Import this object and mutate its properties directly.
export const state = {
  baseOctave: 3,
  velocity: 100,
  channel: 0,
  patch: 0,
  connected: false,
  arrowCc: 10,
  arrowCcValue: 64,
  modValue: 0,
  pitchValue: 0,
  heldKeys: new Set<string>(),
  heldKeyNotes: new Map<string, number>(),
};
