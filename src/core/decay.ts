import type { MemoryItem } from './types.js'

/**
 * Decay reference point: the later of creation and last access.
 * This is what makes expiry "sliding" (use it or lose it) — every
 * recall/injection resets the clock, so a memory that keeps being used
 * never expires, and one left unused for a full TTL dies.
 */
export function referenceOf(item: MemoryItem): number {
  return item.lastAccessedAt > item.createdAt ? item.lastAccessedAt : item.createdAt
}

/** Approximate per-item token footprint: content + per-line overhead. */
export function itemTokens(item: MemoryItem): number {
  return Math.max(1, Math.ceil(item.content.length / 4)) + 12
}

/** Pure strength settlement from time + parameters (deterministic). */
export function settleStrength(item: MemoryItem, now: number): number {
  if (item.pinned) return item.strength
  const age = Math.max(0, now - referenceOf(item))
  if (item.ttl !== null && age >= item.ttl) return 0
  let s = typeof item.baseStrength === 'number' ? item.baseStrength : 1
  if (item.curve === 'linear' && item.ttl !== null) {
    s = s * Math.max(0, 1 - age / item.ttl)
  } else if (item.curve === 'ebbinghaus' && item.ttl !== null) {
    s = s * Math.exp(-age / (item.ttl / 3))
  }
  if (item.lastAccessedAt > item.createdAt) s = Math.min(1, s * 1.5 + 0.1)
  return Math.max(0, Math.min(1, s))
}

/** Settle strength and derive lifecycle status. */
export function settleItem(
  item: MemoryItem,
  now: number,
  staleStrength: number,
  forgottenStrength: number,
): MemoryItem {
  item.strength = settleStrength(item, now)
  item.status = item.pinned
    ? 'active'
    : item.strength <= forgottenStrength
      ? 'forgotten'
      : item.strength <= staleStrength
        ? 'stale'
        : 'active'
  return item
}
