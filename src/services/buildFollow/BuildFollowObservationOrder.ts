let order = 0;

/** Orders status requests and completion notices within this extension host. */
export function nextBuildObservationOrder(): number {
  return ++order;
}
