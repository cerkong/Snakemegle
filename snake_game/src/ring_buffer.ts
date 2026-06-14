/**
 * ring_buffer.ts — Growable ring buffer for snake body segments.
 *
 * Under the hood: a plain array + head index + length. The head is always
 * at logical index 0 (the snake's front); the tail is at length - 1.
 *
 *   pushFront  → O(1) amortized (new head; doubles capacity when full)
 *   popBack    → O(1)           (drop tail, decrement length)
 *
 * The snake can grow without a hard cap: when the backing array fills, it
 * doubles in size (like Rust's `VecDeque`). The starting capacity is just a
 * sensible default so short snakes never reallocate.
 */

/** Grid cell — same shape as `Point` in game.ts (kept local to avoid circular imports). */
export interface RingPoint {
  x: number;
  y: number;
}

/** Starting backing-array size. Not a length cap — the buffer grows past it. */
export const INITIAL_RING_CAPACITY = 50;

export class RingBuffer {
  private buffer: RingPoint[];
  /** Array index of the head (logical index 0). */
  private headIndex = 0;
  private len = 0;

  constructor(capacity = INITIAL_RING_CAPACITY) {
    this.buffer = new Array<RingPoint>(Math.max(1, capacity));
  }

  /** Build a ring buffer from an ordered list (index 0 = head). */
  static fromPoints(
    points: RingPoint[],
    capacity = INITIAL_RING_CAPACITY,
  ): RingBuffer {
    const ring = new RingBuffer(capacity);
    // Push tail-first so the final head ends up at logical index 0.
    for (let i = points.length - 1; i >= 0; i--) {
      ring.pushFront(points[i]!);
    }
    return ring;
  }

  get length(): number {
    return this.len;
  }

  /** Cell at logical index (0 = head, length - 1 = tail). */
  get(index: number): RingPoint {
    if (index < 0 || index >= this.len) {
      throw new RangeError(`RingBuffer index ${index} out of range (length ${this.len})`);
    }
    return this.buffer[(this.headIndex + index) % this.buffer.length]!;
  }

  /** The head cell (logical index 0). Named `front` to avoid clashing with `headIndex`. */
  front(): RingPoint {
    return this.get(0);
  }

  /** Add a new head at the front. Doubles the backing array when full. */
  pushFront(point: RingPoint): void {
    if (this.len >= this.buffer.length) {
      this.grow();
    }
    this.headIndex = (this.headIndex - 1 + this.buffer.length) % this.buffer.length;
    this.buffer[this.headIndex] = point;
    this.len++;
  }

  /**
   * Double the backing array and re-lay-out elements so the head sits at
   * index 0 again. O(n), but amortizes to O(1) per pushFront over time.
   */
  private grow(): void {
    const next = new Array<RingPoint>(this.buffer.length * 2);
    for (let i = 0; i < this.len; i++) {
      next[i] = this.get(i);
    }
    this.buffer = next;
    this.headIndex = 0;
  }

  /** Remove and return the tail. Returns undefined if empty. */
  popBack(): RingPoint | undefined {
    if (this.len === 0) return undefined;
    this.len--;
    const tailIndex = (this.headIndex + this.len) % this.buffer.length;
    return this.buffer[tailIndex];
  }

  /** Shallow copy for immutable tick() — copies indices and point objects. */
  clone(): RingBuffer {
    const copy = new RingBuffer(this.buffer.length);
    for (let i = 0; i < this.buffer.length; i++) {
      const cell = this.buffer[i];
      if (cell !== undefined) {
        copy.buffer[i] = { x: cell.x, y: cell.y };
      }
    }
    copy.headIndex = this.headIndex;
    copy.len = this.len;
    return copy;
  }

  *[Symbol.iterator](): Iterator<RingPoint> {
    for (let i = 0; i < this.len; i++) {
      yield this.get(i);
    }
  }
}
