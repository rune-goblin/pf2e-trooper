import { MODULE_ID } from '../constants';

// The escape hatch from unit movement: hold this key and the segment you drag moves on its own —
// nothing follows it, no advisory area opens, and an area already up neither locks the anchor nor
// refuses the drop.
//
// It is a keybinding rather than a modifier because v14 has already spoken for all three over a
// token drag: ⌘/Ctrl adds a ruler waypoint (and ⌘+wheel changes drag elevation), Shift drags
// unsnapped, Alt drops the token hidden. A registered binding is also rebindable, and Foundry's
// own conflict checker polices it.
const DEFAULT_KEY = 'KeyB';

export interface DragModifier {
  /** A pointer button is down, so a drag may be in flight. */
  pointerDown: boolean;
  /** The key was held when the current gesture began. */
  latched: boolean;
}

export const NO_MODIFIER: DragModifier = { pointerDown: false, latched: false };

export const pressPointer = (held: boolean): DragModifier => ({ pointerDown: true, latched: held });

export const releasePointer = (state: DragModifier): DragModifier => ({ ...state, pointerDown: false });

/**
 * Letting the key go mid-drag keeps the latch: the drop still belongs to the gesture that began
 * with it held. Letting it go with no button down drops the latch, or the next arrow-key nudge
 * would inherit it.
 */
export const releaseModifier = (state: DragModifier): DragModifier =>
  state.pointerDown ? state : NO_MODIFIER;

export const isIndependent = (state: DragModifier, heldNow: boolean): boolean =>
  state.latched || heldNow;

let state = NO_MODIFIER;
let keyHeld = false;

/** Whether the gesture behind the token update in flight asked for independent movement. */
export function independentMovement(): boolean {
  return isIndependent(state, keyHeld);
}

export function registerBreakFormation(): void {
  game.keybindings.register(MODULE_ID, 'breakFormation', {
    name: `${MODULE_ID}.keybindings.breakFormation.name`,
    hint: `${MODULE_ID}.keybindings.breakFormation.hint`,
    editable: [{ key: DEFAULT_KEY, modifiers: [] }],
    // Shift (unsnapped) and Alt (drop hidden) stay available to core mid-drag.
    reservedModifiers: ['Shift', 'Alt'],
    repeat: false,
    onDown: () => {
      keyHeld = true;
      return false;
    },
    onUp: () => {
      keyHeld = false;
      state = releaseModifier(state);
      return false;
    },
  });

  // Capture phase: the latch has to be set before Foundry's canvas handlers control the token or
  // start the drag, both of which are asked whether this gesture is independent.
  document.addEventListener('pointerdown', () => void (state = pressPointer(keyHeld)), true);
  document.addEventListener('pointerup', () => void (state = releasePointer(state)), true);
  document.addEventListener('pointercancel', () => void (state = releasePointer(state)), true);
  // A key held as the window loses focus never reports its keyup, which would strand the latch on.
  window.addEventListener('blur', () => {
    keyHeld = false;
    state = NO_MODIFIER;
  });
}
