/**
 * game.ts — Pure game logic. Zero DOM, zero canvas, zero `window`.
 *
 * This module is the "authoritative simulation". In phase two it should be
 * possible to port this almost line-for-line to a Rust server: the data
 * shapes here map cleanly onto Rust types (see notes on each type).
 *
 * Two design ideas drive everything below:
 *
 *   1. "Coordinate list is the source of truth, grid is derived."
 *      A snake is just an ordered list of cells (head first, tail last).
 *      That list fully describes the snake — we never store a direction
 *      per cell. Anything we need for fast lookups (e.g. "is this cell
 *      occupied?") is *rebuilt* from the lists each tick into a grid.
 *      The lists are canonical; the grid is a cache we regenerate.
 *
 *   2. "Model for many snakes even though there's one."
 *      Snakes live in a record keyed by player id ("p1", "p2", ...).
 *      Adding a second player later is a data change, not a rewrite.
 */

import { RingBuffer } from "./ring_buffer";

// ---------------------------------------------------------------------------
// Grid dimensions
// ---------------------------------------------------------------------------

/** Number of columns (cells along the x-axis). Maps to `width` in GameState. */
export const COLS = 40;

/** Number of rows (cells along the y-axis). Maps to `height` in GameState. */
export const ROWS = 20;

/** Pixel size of one grid cell. Canvas size = COLS×CELL_SIZE by ROWS×CELL_SIZE. */
export const CELL_SIZE = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A grid coordinate. Maps to a `Point { x: i32, y: i32 }` in Rust. */
export interface Point {
  x: number;
  y: number;
}

/** The four movement directions. */
export type Direction = "up" | "down" | "left" | "right";

/** What occupies a single grid cell in the derived grid. */
export enum CellKind {
  Empty = 0,
  Food = 1,
  Snake = 2,
}

/**
 * A snake.
 *
 * `body` is a growable ring buffer: logical index 0 is the head, the last
 * index is the tail. pushFront / popBack are O(1) amortized; the buffer
 * doubles its backing array when full, so the snake can grow without a cap.
 *
 * `direction` is the direction the snake moved on the *last* tick.
 * `pendingDirection` is the direction requested by input for the *next*
 * tick; keeping them separate is what lets us reject 180° reversals.
 */
export interface Snake {
  id: string;
  body: RingBuffer;
  direction: Direction;
  pendingDirection: Direction;
  /** Set true for exactly one tick after eating, to skip the tail pop. */
  grew: boolean;
  alive: boolean;
}

/**
 * The complete game state. Everything needed to render a frame or advance
 * the simulation lives here — there is no hidden state elsewhere.
 */
export interface GameState {
  width: number;
  height: number;
  /** Snakes keyed by player id, so multiplayer is just "more entries". */
  snakes: Record<string, Snake>;
  food: Point | null;
  score: number;
  gameOver: boolean;
}

/**
 * Per-tick input: the direction each player wants to face next.
 * Keyed by player id, matching `GameState.snakes`. A missing entry means
 * "no change requested this tick". Later this is exactly the shape of a
 * message a client would send to the server.
 */
export type Inputs = Record<string, Direction | undefined>;

/**
 * RNG is passed in (not called globally) so the simulation stays
 * deterministic and testable. The Rust server can supply its own RNG
 * implementing the same contract: return a float in [0, 1).
 */
export interface Rng {
  next(): number;
}

/** A trivial RNG backed by Math.random for the browser/client. */
export const mathRandomRng: Rng = {
  next: () => Math.random(),
};

// ---------------------------------------------------------------------------
// Direction helpers
// ---------------------------------------------------------------------------

/** The unit step (dx, dy) for each direction. y grows downward. */
const DIRECTION_VECTORS: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** True if `b` is the direct opposite of `a` (a 180° reversal). */
export function isOpposite(a: Direction, b: Direction): boolean {
  return (
    (a === "up" && b === "down") ||
    (a === "down" && b === "up") ||
    (a === "left" && b === "right") ||
    (a === "right" && b === "left")
  );
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Build a fresh game state: one snake ("p1") of length 3, centered and
 * moving right, with a single piece of food placed on an empty cell.
 */
export function createInitialState(
  width = COLS,
  height = ROWS,
  rng: Rng = mathRandomRng,
): GameState {
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);

  const p1: Snake = {
    id: "p1",
    body: RingBuffer.fromPoints([
      { x: cx, y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
    ]),
    direction: "right",
    pendingDirection: "right",
    grew: false,
    alive: true,
  };

  const state: GameState = {
    width,
    height,
    snakes: { p1 },
    food: null,
    score: 0,
    gameOver: false,
  };

  // Place the first food using the derived grid for the empty-cell search.
  state.food = pickFoodCell(state, rng);
  return state;
}

// ---------------------------------------------------------------------------
// Derived grid
// ---------------------------------------------------------------------------

/**
 * Rebuild the derived grid from the coordinate lists (the source of truth).
 *
 * The grid is a flat array of `width * height` cells indexed by
 * `y * width + x`. It exists purely as an O(1) collision/occupancy lookup;
 * it is never edited directly by game rules — only regenerated from the
 * snakes and food.
 */
export function buildGrid(state: GameState): CellKind[] {
  const grid: CellKind[] = new Array(state.width * state.height).fill(
    CellKind.Empty,
  );

  for (const snake of Object.values(state.snakes)) {
    for (const cell of snake.body) {
      if (inBounds(state, cell)) {
        grid[cell.y * state.width + cell.x] = CellKind.Snake;
      }
    }
  }

  if (state.food && inBounds(state, state.food)) {
    grid[state.food.y * state.width + state.food.x] = CellKind.Food;
  }

  return grid;
}

/** True if a point lies inside the play field. */
export function inBounds(
  state: Pick<GameState, "width" | "height">,
  p: Point,
): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < state.width && p.y < state.height;
}

/**
 * Pick a uniformly random empty cell for new food.
 *
 * Instead of scanning the whole board we collect only occupied cells from
 * snake bodies (O(snake length)), then pick random coordinates and retry if
 * occupied. On a 1v1 board with snakes ≤50 this lands empty ~7/8 of the
 * time on the first try. Returns null only if the board is completely full.
 */
function pickFoodCell(state: GameState, rng: Rng): Point | null {
  const occupied = new Set<number>();

  for (const snake of Object.values(state.snakes)) {
    for (const cell of snake.body) {
      if (inBounds(state, cell)) {
        occupied.add(cell.y * state.width + cell.x);
      }
    }
  }

  if (state.food && inBounds(state, state.food)) {
    occupied.add(state.food.y * state.width + state.food.x);
  }

  const total = state.width * state.height;
  if (occupied.size >= total) return null;

  // Rejection sampling: keep drawing random cells until we hit an empty one.
  for (let attempt = 0; attempt < total; attempt++) {
    const x = Math.floor(rng.next() * state.width);
    const y = Math.floor(rng.next() * state.height);
    if (!occupied.has(y * state.width + x)) {
      return { x, y };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

/**
 * Advance the game by exactly one step.
 *
 * Deterministic and side-effect free: it reads `state`, `inputs`, and `rng`,
 * and returns a brand-new `GameState`. It never mutates the input `state`,
 * which keeps it easy to reason about and to mirror on an authoritative
 * server (same inputs + same RNG => same next state).
 *
 * Order of operations each tick:
 *   1. Apply each snake's pending direction (rejecting 180° reversals).
 *   2. Move each snake: unshift the new head, pop the tail unless it ate.
 *   3. Resolve food: if a head landed on food, grow + score, then respawn.
 *   4. Detect collisions: walls and self (and, later, other snakes).
 */
export function tick(
  state: GameState,
  inputs: Inputs,
  rng: Rng = mathRandomRng,
): GameState {
  // Nothing to do once the game is over; return the state unchanged.
  if (state.gameOver) return state;

  // Work on a shallow clone so the caller's state object is never mutated.
  const next: GameState = {
    ...state,
    snakes: {},
    // food/score reassigned below as needed
  };

  let ateThisTick = false;
  let food = state.food;

  for (const snake of Object.values(state.snakes)) {
    // --- 1. Apply pending direction (already validated by input.ts, but we
    //        re-check here so the simulation is safe on its own). ---
    const requested = inputs[snake.id] ?? snake.pendingDirection;
    const direction = isOpposite(snake.direction, requested)
      ? snake.direction
      : requested;

    // --- 2. Move: O(1) pushFront for new head, popBack for tail unless ate. ---
    const step = DIRECTION_VECTORS[direction];
    const body = snake.body.clone();
    const head = body.front();
    const newHead: Point = { x: head.x + step.x, y: head.y + step.y };

    body.pushFront(newHead);

    // --- 3. Did this head land on food? If so, grow (skip tail pop). ---
    const ateFood =
      food !== null && newHead.x === food.x && newHead.y === food.y;

    if (ateFood) {
      ateThisTick = true; // growth = keep the tail this tick
    } else {
      body.popBack(); // normal move: drop the tail so length stays constant
    }

    next.snakes[snake.id] = {
      ...snake,
      body,
      direction,
      pendingDirection: direction,
      grew: ateFood,
    };
  }

  // Update score and respawn food if anyone ate this tick.
  let score = state.score;
  if (ateThisTick) {
    score += 10;
    // Respawn relative to the *new* snake positions so food never spawns
    // on top of a snake.
    food = pickFoodCell({ ...next, food: null }, rng);
  }

  next.food = food;
  next.score = score;

  // --- 4. Collision detection against the freshly moved bodies. ---
  // Rebuild occupancy from the new coordinate lists, then test each head.
  let gameOver = false;
  for (const snake of Object.values(next.snakes)) {
    const head = snake.body.front();

    // Wall collision.
    if (!inBounds(next, head)) {
      snake.alive = false;
      gameOver = true;
      continue;
    }

    // Self collision: does the head share a cell with any other body part?
    // (This loop also naturally extends to other snakes' bodies later.)
    const hitSomething = collidesWithAnyBody(next, snake.id, head);
    if (hitSomething) {
      snake.alive = false;
      gameOver = true;
    }
  }

  // Single-player: the game ends as soon as the one snake dies. With more
  // snakes you'd instead remove dead ones and keep the round going.
  next.gameOver = gameOver;

  return next;
}

/**
 * Does `head` overlap any snake body cell? Skips the head of its own snake
 * (index 0) so a snake isn't reported as colliding with itself trivially.
 */
function collidesWithAnyBody(
  state: GameState,
  movingSnakeId: string,
  head: Point,
): boolean {
  for (const other of Object.values(state.snakes)) {
    const startIndex = other.id === movingSnakeId ? 1 : 0;
    for (let i = startIndex; i < other.body.length; i++) {
      const cell = other.body.get(i);
      if (cell.x === head.x && cell.y === head.y) return true;
    }
  }
  return false;
}
