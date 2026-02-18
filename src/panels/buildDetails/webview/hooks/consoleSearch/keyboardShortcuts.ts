export function createConsoleSearchKeyDownHandler({
  openSearchToolbar,
  canCloseSearch,
  onCloseSearch
}: {
  openSearchToolbar: () => void;
  canCloseSearch: boolean;
  onCloseSearch: () => void;
}): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === "f") {
      event.preventDefault();
      openSearchToolbar();
      return;
    }

    if (event.key === "Escape" && canCloseSearch) {
      event.preventDefault();
      onCloseSearch();
    }
  };
}
