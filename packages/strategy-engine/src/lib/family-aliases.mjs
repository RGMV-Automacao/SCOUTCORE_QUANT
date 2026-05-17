const FAMILY_ALIASES = new Map([
  ['resultado', '1x2'],
  ['1x2', '1x2'],
  ['dupla_chance', 'dupla'],
  ['dupla', 'dupla'],
]);

export function normalizeFamily(family) {
  return FAMILY_ALIASES.get(family) ?? family;
}

export function normalizeFamilies(families = []) {
  return new Set((families ?? []).map((family) => normalizeFamily(family)));
}
