# PanelSpec 0.16 component editing

Retain independent checkbox/radio/list/dialog identities. Existing generic
set-row-label, set-row-enabled, set-state-initial, add-row and remove-row apply
where advertised. Add the correct typed row and its boolean/enum state together.

set-choice-options changes Select/RadioGroup/List options and authored initial ID.
Keep existing IDs for surviving items. Current preview values are preserved;
removing the currently selected option without a compatible retained state is
rejected, never silently choosing another item. List supports 1–64 items, other
choices 1–8. set-list-properties sets both itemHeight and visibleItems.

set-dialog-properties sets title, text, closeLabel, modal, dialogWidth and
dialogHeight as one complete group. Copy all unmentioned values from the current
row. Opening button copy is the row label. Initial open state is boolean state;
changing it is not permission to change the current preview state. Host APIs own
current open/close and selection. Dialog content remains a bounded message with
open/close controls, not arbitrary nested forms or scripts.

These operations require current-request evidence and whole-patch validation.
Do not upgrade an older saved bundle or replace its component type silently.
