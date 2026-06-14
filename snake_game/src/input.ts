/**
 * input.ts — Keyboard handling for a single player.
 *
 * Key idea: event listeners never touch game state. Instead they push
 * direction changes into a per-player queue. Once per tick the game loop
 * calls `consume()` to pull at most one direction out of that queue.
 *
 * Why a queue? Two reasons:
 *   1. It decouples "when the key was pressed" (any time) from "when it's
 *      applied" (exactly once per fixed tick), so fast key mashing can't
 *      skip a tick or apply two turns at once.
 *   2. It mirrors networking: in the multiplayer phase each queued input
 *      becomes a message sent to the server, which applies it on its own
 *      authoritative tick. Same shape, different transport.
 */

import { isOpposite, type Direction } from "./game";

/** Maps keyboard keys to directions (arrow keys + WASD). */
const KEY_MAP: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
  W: "up",
  S: "down",
  A: "left",
  D: "right",
};

export class InputController {
  /** Pending direction changes, oldest first. */
  private queue: Direction[] = [];

  /** Latest non-movement key press (used to restart after game over). */
  private restartRequested = false;

  private readonly keydownHandler = (event: KeyboardEvent): void => {
    const direction = KEY_MAP[event.key];

    if (direction) {
      event.preventDefault();
      this.enqueue(direction);
    }

    // Any key counts as a restart request; main.ts decides whether to act.
    this.restartRequested = true;
  };

  /** Begin listening for key presses. */
  attach(target: Window | HTMLElement = window): void {
    target.addEventListener("keydown", this.keydownHandler as EventListener);
  }

  /** Stop listening (useful for teardown / hot reload). */
  detach(target: Window | HTMLElement = window): void {
    target.removeEventListener(
      "keydown",
      this.keydownHandler as EventListener,
    );
  }

  /**
   * Add a direction to the queue, with light filtering so the buffer can't
   * fill with redundant or instantly-fatal inputs:
   *   - ignore a repeat of the last queued direction
   *   - ignore a 180° reversal of the last queued direction
   * Final validation against the snake's *actual* direction still happens
   * in `tick`, but filtering here keeps the queue meaningful.
   */
  private enqueue(direction: Direction): void {
    const last = this.queue[this.queue.length - 1];
    if (last !== undefined) {
      if (last === direction || isOpposite(last, direction)) return;
    }
    // Cap the queue so a burst of presses can't buffer many turns.
    if (this.queue.length < 3) {
      this.queue.push(direction);
    }
  }

  /**
   * Pull at most one direction change for this tick, or `undefined` if the
   * queue is empty. Called once per fixed timestep by the game loop.
   */
  consume(): Direction | undefined {
    return this.queue.shift();
  }

  /** True once since the last `clearRestart()`; used to restart the game. */
  wantsRestart(): boolean {
    return this.restartRequested;
  }

  /** Reset the restart flag and drop any buffered directions. */
  clearRestart(): void {
    this.restartRequested = false;
    this.queue = [];
  }
}
