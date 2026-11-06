const byteUnits = ["B", "KB", "MB", "GB"] as const;

function roundedSize(value: number) {
  return value < 9.95 ? Math.round(value * 10) / 10 : Math.round(value);
}

export function formatBytes(bytes: number) {
  let value = bytes;
  let unit = 0;

  while (unit < byteUnits.length - 1 && roundedSize(value) >= 1000) {
    value /= 1000;
    unit += 1;
  }

  return `${roundedSize(value)} ${byteUnits[unit] ?? "B"}`;
}
