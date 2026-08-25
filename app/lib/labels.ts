const STORAGE_KEY = "mortal-vault-labels-v1";

type LabelStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * Address nicknames are a purely local convenience: they are stored only in
 * this browser and are never written on-chain or sent anywhere.
 */
export function readLabels(storage: LabelStorage | null): Record<string, string> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const labels: Record<string, string> = {};
    for (const [address, label] of Object.entries(parsed)) {
      if (typeof label === "string" && label.trim() !== "") {
        labels[address.toLowerCase()] = label;
      }
    }
    return labels;
  } catch {
    return {};
  }
}

export function readLabel(
  storage: LabelStorage | null,
  address: string | null | undefined,
): string | null {
  if (!address) return null;
  return readLabels(storage)[address.toLowerCase()] ?? null;
}

export function writeLabel(
  storage: LabelStorage | null,
  address: string,
  label: string,
): void {
  if (!storage) return;
  const labels = readLabels(storage);
  const key = address.toLowerCase();
  const trimmed = label.trim();
  if (trimmed === "") {
    delete labels[key];
  } else {
    labels[key] = trimmed.slice(0, 40);
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(labels));
  } catch {
    // Storage can be unavailable (private mode, quota); labels are optional.
  }
}
