export function resolveTestResultRowOpenState(
  currentOpen: boolean,
  initialOpen: boolean | undefined
): boolean {
  return initialOpen ? true : currentOpen;
}
