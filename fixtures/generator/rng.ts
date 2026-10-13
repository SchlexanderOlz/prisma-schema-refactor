// Deterministic PRNG (mulberry32). Every generator call goes through an Rng seeded
// from a fixed seed plus a stable label, so adding a model never shifts other models' data.

export class Rng {
  private s: number
  constructor(seed: number) {
    this.s = seed >>> 0
  }
  static from(base: number, label: string): Rng {
    let h = base >>> 0
    for (let i = 0; i < label.length; i++) {
      h = Math.imul(h ^ label.charCodeAt(i), 2654435761) >>> 0
    }
    return new Rng(h)
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }
  chance(p: number): boolean {
    return this.next() < p
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }
  shuffle<T>(arr: readonly T[]): T[] {
    const a = arr.slice()
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }
  sample<T>(arr: readonly T[], n: number): T[] {
    return this.shuffle(arr).slice(0, Math.min(n, arr.length))
  }
}

export const SEED = 20240611
