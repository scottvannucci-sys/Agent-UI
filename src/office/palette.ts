/** Dunder Bots palette — The Office (NBC)-inspired paper-company colors. */

export const C = {
  outline: "#26262e",
  wall: "#e9e2cf",
  wallShade: "#c6bba3",
  wallTop: "#f5f0e2",
  window: "#bcd9e2",
  windowFrame: "#8fa3ad",

  carpet: "#93a5b6",
  carpetAlt: "#8a9bac",
  carpetDot: "#7d8fa0",

  tile: "#d9d4c7",
  tileAlt: "#c4bdae",

  wood: "#a06a3f",
  woodDark: "#7c4f2c",
  woodLight: "#c08a52",

  metal: "#b9c2c9",
  metalDark: "#7f8a92",
  plastic: "#d5d8da",

  paper: "#f7f4e8",
  paperShade: "#d9d2bd",

  screenOff: "#2e3438",
  screenOn: "#9fd8e8",

  green: "#3f7d44",
  greenDark: "#2d5c31",
  pot: "#a5502c",
  potDark: "#7c3a1e",

  water: "#4f9bd6",
  waterLight: "#9ccdee",

  coffee: "#6b4a2b",
  coffeeDark: "#4a3018",

  door: "#8a5a33",
  doorDark: "#6b4322",

  navy: "#1e2a3a",
  bubble: "#ffffff",
  bubbleInk: "#26262e",

  red: "#e05555",
  amber: "#d8c34a",
  greenLight: "#3fbf5f",

  skin: ["#f0c8a0", "#e3b088", "#c98d5f", "#8d5a3a"],
  hair: ["#3a2a1c", "#6b4a2a", "#a8763a", "#1c1c22", "#8a8f96", "#c9c2b2"],
  shirt: [
    "#4f6d9e",
    "#9e4f5a",
    "#4f9e6b",
    "#b08c3f",
    "#7a5f9e",
    "#3f8f9e",
    "#9e6b4f",
    "#5a7a5a",
  ],
  pants: ["#3a3f4a", "#5a4a3a", "#2f4a5a", "#4a4a4a"],
  shoe: "#2b2b33",
  tie: ["#9e4f5a", "#4f6d9e", "#b08c3f", "#3f8f9e", "#5a6b7a"],

  sky: "#aee0ef",
  skyDeep: "#8fc9dd",
  grout: "#b3ab99",
  shadow: "rgba(20,25,35,0.20)",
} as const;

/** Deterministic palette override for a bot, from its hash seed. */
export function botPalette(seed: number): Record<string, string> {
  const skin = C.skin[seed % C.skin.length];
  const hair = C.hair[Math.floor(seed / 7) % C.hair.length];
  const shirt = C.shirt[Math.floor(seed / 13) % C.shirt.length];
  const pants = C.pants[Math.floor(seed / 31) % C.pants.length];
  return { K: skin, H: hair, S: shirt, P: pants };
}
