function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort()
    .reduce((sorted, key) => {
      sorted[key] = sortKeysDeep(value[key]);
      return sorted;
    }, {});
}

export function settingsSnapshot(value) {
  return JSON.stringify(sortKeysDeep(value));
}

export function countChangedSettings(current, saved, excludedKeys = []) {
  if (!current || !saved) return 0;
  const excluded = new Set(excludedKeys);
  const keys = new Set([...Object.keys(current), ...Object.keys(saved)]);
  let changed = 0;
  keys.forEach((key) => {
    if (!excluded.has(key) && settingsSnapshot(current[key]) !== settingsSnapshot(saved[key])) {
      changed += 1;
    }
  });
  return changed;
}
