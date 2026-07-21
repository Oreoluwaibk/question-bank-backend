function parseVersion(version: string): [number, number, number] {
  const parts = version.trim().split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });

  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function compareVersions(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = parseVersion(a);
  const [bMajor, bMinor, bPatch] = parseVersion(b);

  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

export function isValidVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version.trim());
}
