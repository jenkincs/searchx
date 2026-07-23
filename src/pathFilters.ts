export function globMatches(pattern: string, value: string): boolean {
  const normalizedPattern = pattern.replaceAll("\\", "/");
  const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const expression = escaped
    .replaceAll("**/", "§§PREFIX_GLOB§§")
    .replaceAll("/**", "§§SUFFIX_GLOB§§")
    .replaceAll("**", "§§DOUBLE_GLOB§§")
    .replaceAll("*", "[^/]*")
    .replaceAll("?", "[^/]")
    .replaceAll("§§PREFIX_GLOB§§", "(?:.*/)?")
    .replaceAll("§§SUFFIX_GLOB§§", "/.*")
    .replaceAll("§§DOUBLE_GLOB§§", ".*");
  return new RegExp(`^${expression}$`).test(value.replaceAll("\\", "/"));
}
