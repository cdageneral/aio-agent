/**
 * Taxonomy was removed in favor of smart per-project detection via
 * /api/detect-segment. This stub remains only so legacy imports don't break
 * during transition — every consumer should be migrated to read seed
 * keywords from `project.custom_seed_keywords` directly.
 */

export function seedsForSegment(): string[] {
  return [];
}
