import type { AuditEntry, ForgetReason, MemoryItem } from './types.js'

/**
 * Content hash (djb2, hex). Integrity only — not cryptographic.
 * The audit keeps the hash even in privacy mode so the user can verify
 * "this is the memory I forgot" without storing its content.
 */
export function hashText(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

/**
 * Build one audit entry. Content is stored ONLY when `restorable` is on
 * (the explicit privacy tradeoff: recoverability vs. clean deletion).
 */
export function buildAuditEntry(
  item: MemoryItem,
  reason: ForgetReason,
  at: number,
  restorable: boolean,
): AuditEntry {
  const entry: AuditEntry = { id: item.id, kind: item.kind, reason, at, contentHash: hashText(item.content) }
  if (restorable) {
    entry.content = item.content
    entry.tags = item.tags
    entry.scope = item.scope
    entry.ownerId = item.ownerId
  }
  return entry
}
