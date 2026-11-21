/**
 * Canonical normalization, matching, and deduplication utilities
 * for electronic part groups, parts_catalog, and shop_parts_inventory.
 */

export function cleanDisplayText(val?: string | null): string {
  return String(val || '').trim().replace(/\s+/g, ' ');
}

export function normalizePartText(val?: string | null): string {
  return cleanDisplayText(val)
    .replace(/[أإآٱ]/g, 'ا')
    .toLowerCase();
}

export function sanitizePartDocId(val: string): string {
  return cleanDisplayText(val).replace(/[\/\\]/g, '_');
}

export function isNonBatchStock(stock: any): boolean {
  if (!stock) return false;
  const hasBatchFlag = stock.isDisassemblyBatch === true || stock.isDisassemblyBatch === 1;
  const hasBatchId = Boolean(stock.batchId && String(stock.batchId).trim());
  return !hasBatchFlag && !hasBatchId;
}

export function findMatchingGroup<T extends Record<string, any>>(
  groups: T[],
  groupId?: string | null,
  groupName?: string | null
): T | undefined {
  if (!groups || groups.length === 0) return undefined;
  const cleanId = String(groupId || '').trim();
  const normId = normalizePartText(groupId);
  const normName = normalizePartText(groupName);

  if (cleanId) {
    const byId = groups.find(g => String(g.id || '').trim() === cleanId);
    if (byId) return byId;
  }
  if (normName) {
    const byName = groups.find(g => normalizePartText(g.name) === normName);
    if (byName) return byName;
  }
  if (normId) {
    const byIdAsName = groups.find(g => normalizePartText(g.name) === normId || normalizePartText(g.id) === normId);
    if (byIdAsName) return byIdAsName;
  }
  return undefined;
}

export function findMatchingCatalogPart<T extends Record<string, any>>(
  catalogItems: T[],
  partId?: string | null,
  partName?: string | null,
  preferredGroupId?: string | null
): T | undefined {
  if (!catalogItems || catalogItems.length === 0) return undefined;
  const cleanPartId = String(partId || '').trim();
  const normPartId = normalizePartText(partId);
  const normName = normalizePartText(partName);
  const normGroupId = normalizePartText(preferredGroupId);

  if (cleanPartId) {
    const byId = catalogItems.find(c => String(c.id || '').trim() === cleanPartId);
    if (byId) return byId;
  }

  if (normName && normGroupId) {
    const byNameAndGroup = catalogItems.find(
      c =>
        normalizePartText(c.name) === normName &&
        (String(c.groupId || '').trim() === String(preferredGroupId || '').trim() ||
          normalizePartText(c.groupName) === normGroupId)
    );
    if (byNameAndGroup) return byNameAndGroup;
  }

  if (normName) {
    const byName = catalogItems.find(c => normalizePartText(c.name) === normName);
    if (byName) return byName;
  }

  if (normPartId) {
    const byNormId = catalogItems.find(
      c => normalizePartText(c.id) === normPartId || normalizePartText(c.name) === normPartId
    );
    if (byNormId) return byNormId;
  }

  return undefined;
}

export function resolveCanonicalGroupInfo(
  groups: Array<{ id?: string; name?: string }>,
  item: { groupId?: string | null; groupName?: string | null; category?: string | null }
): { groupId: string; groupName: string } {
  const matched =
    findMatchingGroup(groups, item.groupId, item.groupName) ||
    findMatchingGroup(groups, null, item.category);
  if (matched) {
    return {
      groupId: String(matched.id || item.groupId || '').trim(),
      groupName: cleanDisplayText(matched.name)
    };
  }
  return {
    groupId: String(item.groupId || '').trim(),
    groupName: cleanDisplayText(item.groupName || '')
  };
}

export function findMatchingStockCandidates<T extends Record<string, any>>(
  stockItems: T[],
  criteria: {
    partId?: string | null;
    partName?: string | null;
    batchId?: string | null;
    nonBatchOnly?: boolean;
  }
): T[] {
  const cleanPartId = String(criteria.partId || '').trim();
  const normName = normalizePartText(criteria.partName);
  const cleanBatchId = String(criteria.batchId || '').trim();

  const matches = stockItems.filter(s => {
    if (!s) return false;
    if (criteria.nonBatchOnly && !isNonBatchStock(s)) return false;
    if (cleanBatchId && String(s.batchId || '').trim() !== cleanBatchId) return false;

    const idMatches =
      Boolean(cleanPartId) &&
      (String(s.id || '').trim() === cleanPartId ||
        String(s.partId || '').trim() === cleanPartId);
    const nameMatches = Boolean(normName) && normalizePartText(s.name) === normName;
    return idMatches || nameMatches;
  });

  // Sort candidates so available positive stock comes first,
  // preferring exact partId match and non-batch stock before dipping negative.
  return matches.sort((a, b) => {
    const qtyA = Number(a.quantity || 0);
    const qtyB = Number(b.quantity || 0);
    const posA = qtyA > 0 ? 1 : 0;
    const posB = qtyB > 0 ? 1 : 0;
    if (posA !== posB) return posB - posA;

    const nonBatchA = isNonBatchStock(a) ? 1 : 0;
    const nonBatchB = isNonBatchStock(b) ? 1 : 0;
    if (nonBatchA !== nonBatchB) return nonBatchB - nonBatchA;

    const exactIdA = cleanPartId && (a.id === cleanPartId || a.partId === cleanPartId) ? 1 : 0;
    const exactIdB = cleanPartId && (b.id === cleanPartId || b.partId === cleanPartId) ? 1 : 0;
    if (exactIdA !== exactIdB) return exactIdB - exactIdA;

    return qtyB - qtyA;
  });
}
