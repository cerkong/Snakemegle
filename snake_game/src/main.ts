/**
 * main.ts — Wires the modules together and runs the game loop.
 *
 * Responsibilities (and nothing more):
 *   - grab the canvas + context
 *   - own the current GameState
 *   - run a fixed-timestep loop
 *   - feed queued input into `tick`, then `render` the result
 *   - restart on key press after game over
 *
 * --- Fixed-timestep accumulator pattern -----------------------------------
 * `requestAnimationFrame` fires at the display's refresh rate, which varies
 * (60Hz, 120Hz, 144Hz, ...). If we advanced the game once per frame, the
 * snake would move faster on a 144Hz monitor than a 60Hz one. To make speed
 * independent of refresh rate we separate *rendering* from *simulation*:
 *
 *   - Each animation frame we measure how much real time elapsed (delta).
 *   - We add that delta to an `accumulator`.
 *   - While the accumulator holds at least one full TICK_MS, we run one
 *     `tick` and subtract TICK_MS. So a long frame may run several ticks; a
 *     short frame may run none. Over time the simulation advances at exactly
 *     one tick per TICK_MS regardless of how often we render.
 *   - We render once per animation frame using whatever the latest state is.
 * --------------------------------------------------------------------------
 */

import "./style.css";
import {
  CELL_SIZE,
  COLS,
  ROWS,
  createInitialState,
  mathRandomRng,
  tick,
  type GameState,
  type Inputs,
} from "./game";
import { render } from "./renderer";
import { InputController } from "./input";

/** Simulation step length. 120ms => ~8.3 ticks per second. */
const TICK_MS = 120;

/** Logical canvas size in CSS pixels (before device-pixel-ratio scaling). */
const CANVAS_WIDTH = COLS * CELL_SIZE;
const CANVAS_HEIGHT = ROWS * CELL_SIZE;

interface CanvasSetup {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
}

/**
 * Size the canvas for crisp rendering on Retina/high-DPI screens.
 *
 * The bitmap is scaled by `devicePixelRatio`, but all drawing uses logical
 * coordinates (CANVAS_WIDTH × CANVAS_HEIGHT). `ctx.scale(dpr, dpr)` maps
 * those logical pixels to physical screen pixels without blur.
 */
function setupCanvas(): CanvasSetup {
  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  if (!canvas) throw new Error("Canvas #game not found in the document.");

  const dpr = window.devicePixelRatio || 1;

  canvas.width = CANVAS_WIDTH * dpr;
  canvas.height = CANVAS_HEIGHT * dpr;
  canvas.style.width = `${CANVAS_WIDTH}px`;
  canvas.style.height = `${CANVAS_HEIGHT}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D context from the canvas.");

  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;

  return { ctx, width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
}

async function main(): Promise<void> {
  // Preload pixel-font sizes used on the canvas overlay.
  await Promise.all([
    document.fonts.load('28px "Press Start 2P"'),
    document.fonts.load('14px "Press Start 2P"'),
  ]);

  const { ctx, width, height } = setupCanvas();
  const input = new InputController();
  input.attach();

  let state: GameState = createInitialState(COLS, ROWS, mathRandomRng);

  // Timing state for the accumulator loop.
  let lastTime = performance.now();
  let accumulator = 0;

  function frame(now: number): void {
    // Time since the previous frame, in ms. Clamp to avoid a huge catch-up
    // burst after the tab was backgrounded (the "spiral of death" guard).
    const delta = Math.min(now - lastTime, 250);
    lastTime = now;

    if (state.gameOver) {
      // While dead, ignore movement input and watch for a restart key.
      if (input.wantsRestart()) {
        input.clearRestart();
        state = createInitialState(COLS, ROWS, mathRandomRng);
        accumulator = 0;
      }
    } else {
      accumulator += delta;

      // Run as many fixed steps as fit into the elapsed time.
      while (accumulator >= TICK_MS) {
        // Pull at most one buffered direction for player "p1" this tick.
        const inputs: Inputs = { p1: input.consume() };
        state = tick(state, inputs, mathRandomRng);
        accumulator -= TICK_MS;

        // If this tick ended the game, stop stepping; the restart flag set
        // by the death keypress shouldn't trigger an instant restart.
        if (state.gameOver) {
          input.clearRestart();
          break;
        }
      }
    }

    // Render once per animation frame with the latest state.
    render(ctx, state, width, height);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  console.error(error);
});
