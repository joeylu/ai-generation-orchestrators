// Keyboard behavior augments the same PixiUI objects and declared signals used
// by pointer input. It never writes authored defaults.
export function attachKeyboard(adapter, { recipe, p, emit, skin }) {
  const view = adapter.view;
  const move = (items, current, key) => {
    const enabled = items
      .map((x, i) => ({ ...x, i }))
      .filter((x) => x.enabled !== false);
    if (!enabled.length) return -1;
    if (key === "Home") return enabled[0].i;
    if (key === "End") return enabled.at(-1).i;
    const at = enabled.findIndex((x) => x.i === current);
    return enabled[
      (at +
        (["ArrowLeft", "ArrowUp"].includes(key) ? -1 : 1) +
        enabled.length) %
        enabled.length
    ].i;
  };
  const arrows = [
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
  ];
  if (recipe.type === "Input") {
    adapter.activate = () => view.startEditing();
    adapter.focus = adapter.activate;
  }
  if (recipe.type === "Slider")
    adapter.key = (key) => {
      if (!arrows.includes(key)) return false;
      const before = view.value;
      const next =
        key === "Home"
          ? p.min
          : key === "End"
            ? p.max
            : p.min +
              (Math.round((before - p.min) / p.step) +
                (["ArrowLeft", "ArrowDown"].includes(key) ? -1 : 1)) *
                p.step;
      view.value = Math.max(
        p.min,
        Math.min(p.max, Number(next.toPrecision(12))),
      );
      if (view.value !== before) view.onChange.emit(view.value);
      return true;
    };
  if (recipe.type === "RadioGroup")
    adapter.key = (key) => {
      if (!arrows.includes(key)) return false;
      const i = move(p.options, view.selected, key);
      if (i >= 0 && i !== view.selected) view.selectItem(i);
      return true;
    };
  if (recipe.type === "Select") {
    let cursor = view.value;
    adapter.activate = () => {
      if (!view.expanded) {
        cursor = view.value;
        view.open();
      } else if (cursor >= 0 && p.options[cursor]?.enabled)
        view.rows[cursor].onPress.emit();
      else view.close();
    };
    adapter.key = (key) => {
      if (key === "Escape") {
        view.close();
        return true;
      }
      if (!arrows.includes(key)) return false;
      if (!view.expanded) view.open();
      cursor = move(p.options, cursor, key);
      view.rows.forEach((row, i) => (row.alpha = i === cursor ? 0.7 : 1));
      if (cursor >= 0) {
        const top = cursor * skin.profile.itemHeight;
        view.scrollBox.scrollY = -Math.max(
          0,
          Math.min(top, view.scrollBox.contentHeight - view.scrollBox.height),
        );
        view.scrollBox.update();
      }
      return true;
    };
  }
  if (["Tabs", "List"].includes(recipe.type))
    adapter.key = (key) => {
      if (
        !arrows.includes(key) ||
        (recipe.type === "List" && p.selection === "none")
      )
        return false;
      const items = p.tabs ?? p.items;
      const stateKey = p.tabs ? "activeId" : "selectedId";
      const value = adapter.state()[stateKey];
      const i = move(
        items,
        items.findIndex((x) => x.id === value),
        key,
      );
      if (i >= 0 && value !== items[i].id) {
        adapter.setState({ [stateKey]: items[i].id });
        emit("selectionChange", { [stateKey]: items[i].id });
      }
      return true;
    };
  if (recipe.type === "Dialog") {
    let action = 0;
    adapter.activate = () => {
      if (view.isOpen) adapter.buttons[action]?.onPress.emit();
    };
    adapter.key = (key) => {
      if (key === "Escape" && view.isOpen) {
        view.close();
        return true;
      }
      if (!arrows.includes(key)) return false;
      action = move(p.actions, action, key);
      adapter.buttons.forEach((b, i) => (b.alpha = i === action ? 0.7 : 1));
      return true;
    };
  }
}
