import { sdkPanels } from "./sdk-fixed-panels.mjs";

const stateNames = new Map(
  sdkPanels
    .filter(
      (item) =>
        sdkPanels.filter((other) => other.group === item.group).length > 1,
    )
    .map(({ spec, groupName, variant }) => [
      spec.id,
      { original: spec.title, groupName, name: `${groupName} · ${variant}` },
    ]),
);

// A presentation label only: existing frozen prototypes, visible game copy and
// generation inputs keep their original bytes. Preserve user-authored titles.
export function panelDisplayTitle({ panelId, title }) {
  const state = stateNames.get(panelId);
  return state && [state.original, state.groupName, state.name].includes(title)
    ? state.name
    : title;
}
