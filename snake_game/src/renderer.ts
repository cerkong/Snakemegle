/**
 * renderer.ts — Draws a GameState onto a 2D canvas context.
 *
 * This module is "dumb": it reads state and paints pixels. It contains no
 * game rules, never advances the simulation, and never reads input. That
 * separation is what will let us swap in interpolation/animation later, or
 * render server-sent state in the multiplayer phase, without touching logic.
 */

import { CELL_SIZE, type GameState, type Point } from "./game";

/** Pixel font used for any canvas text (game-over overlay). */
const PIXEL_FONT = '"Press Start 2P", monospace';

/** Rust book palette — warm browns, parchment cream, burnt-orange accent. */
const COLORS = {
  background: "#362e2d",
  grid: "#4a403f",
  snakeHead: "#d97e3a",
  snakeBody: "#e5e1d8",
  food: "#b8652a",
  text: "#e5e1d8",
  overlay: "rgba(38, 38, 38, 0.82)",
} as const;

/**
 * Draw one full frame using logical (CSS) pixel coordinates.
 *
 * `viewWidth` / `viewHeight` are the on-screen size before device-pixel-ratio
 * scaling; the context is already scaled in main.ts for crisp Retina output.
 */
export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  viewWidth: number,
  viewHeight: number,
): void {
  const cellSize = CELL_SIZE;

  drawBackground(ctx, viewWidth, viewHeight);
  drawGridLines(ctx, state, cellSize);
  if (state.food) drawFood(ctx, state.food, cellSize);
  drawSnakes(ctx, state, cellSize);

  if (state.gameOver) {
    drawGameOver(ctx, viewWidth, viewHeight);
  }
}

/** Paint the solid dark background over the whole canvas. */
function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);
}

/** Faint grid lines to make movement readable. Purely cosmetic. */
function drawGridLines(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  cellSize: number,
): void {
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;

  for (let x = 1; x < state.width; x++) {
    ctx.beginPath();
    ctx.moveTo(x * cellSize, 0);
    ctx.lineTo(x * cellSize, state.height * cellSize);
    ctx.stroke();
  }
  for (let y = 1; y < state.height; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * cellSize);
    ctx.lineTo(state.width * cellSize, y * cellSize);
    ctx.stroke();
  }
}

/** Draw every snake. Head gets a brighter shade than the body. */
function drawSnakes(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  cellSize: number,
): void {
  for (const snake of Object.values(state.snakes)) {
    let index = 0;
    for (const cell of snake.body) {
      ctx.fillStyle = index === 0 ? COLORS.snakeHead : COLORS.snakeBody;
      fillCell(ctx, cell, cellSize);
      index++;
    }
  }
}

/** Draw the single food pellet. */
function drawFood(
  ctx: CanvasRenderingContext2D,
  food: Point,
  cellSize: number,
): void {
  ctx.fillStyle = COLORS.food;
  fillCell(ctx, food, cellSize);
}

/**
 * Fill one grid cell with the current fillStyle, inset by 1px on each side
 * so neighbouring cells read as distinct blocks rather than a solid mass.
 */
function fillCell(
  ctx: CanvasRenderingContext2D,
  cell: Point,
  cellSize: number,
): void {
  const px = cell.x * cellSize;
  const py = cell.y * cellSize;
  ctx.fillRect(px + 1, py + 1, cellSize - 2, cellSize - 2);
}

/** Translucent overlay with a restart prompt. */
function drawGameOver(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.fillStyle = COLORS.overlay;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = COLORS.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.font = `28px ${PIXEL_FONT}`;
  ctx.fillText("Game Over", width / 2, height / 2 - 28);

  ctx.font = `14px ${PIXEL_FONT}`;
  ctx.fillText("Press any key", width / 2, height / 2 + 18);
  ctx.fillText("to restart", width / 2, height / 2 + 42);
}
