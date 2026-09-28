export function settingsAreWritable({ loaded, error }) {
  // Displayed defaults are not safe to persist until the authoritative settings load succeeds.
  return loaded === true && !error;
}
