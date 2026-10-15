# Inventory grid

UI Panel now has an opt-in `inventory` content row. The daily catalog is
`modern-readable-game-grid-layout`; older catalogs and saved bundles retain their
previous compiler and prompt bytes. The feature is included in the
[rc.8 SDK release](sdk-rc8.md).

Short requests can use “帮我生成一个10X10的仓库面板”, “做个8行6列的背包”,
or “生成一个仓库面板”. The model returns one grid declaration and sparse item
records. The deterministic compiler creates every cell, including empty cells;
10×10 is exactly 100 cells. A literal size cannot silently become a smaller List.
Conflicting or unsupported dimensions require a specific clarification.

## Layout and data contract

The fixed-cell model resembles Unity's GridLayoutGroup: row and column counts,
cell width and height, horizontal and vertical spacing, padding, start corner and
fill axis are independent. It does not create or depend on a Unity layout component;
the same measured rectangles are exported to Pixi and UGUI.

| Setting | Default / supported range |
| --- | --- |
| Missing capacity | 5 rows × 6 columns |
| Cell | 72 × 72; each dimension 48–256 |
| Spacing | 8 × 8; each dimension 0–64 |
| Padding | 8; range 0–64 |
| Order | upper-left, horizontal |
| Capacity | At most 144 cells across the panel, each axis 1–32 |
| Items not supplied | `items: []`; every slot remains empty |
| Initial selection | `selectedSlot: null` |

Every slot has a real Panel background, an existing Button and a selection
indicator. Sparse items contain a unique zero-based `slot`, `name`, integer
`quantity` from 1 to 9999 and a pinned icon key or null. Icons must be eligible
candidates from the bound resource library; their original PNG bytes enter the
verified closure. A name is shown when an icon is absent. Unreadable quantities,
overflowing geometry, duplicate slots and missing artwork fail validation.

The Pixi view keeps fixed cells at their authored size. A small container scrolls
horizontally rather than scaling a ten-column inventory into tiny targets. An
explicit height limit enables vertical panel scrolling without changing capacity.
Ordinary panels retain their existing fit behavior.

## Selection and editing

Selection is one enum state: `none`, `slot0`, …, `slot99` for a 10×10 grid. Pointer,
touch and keyboard activation in Pixi use the same host event, with `rowId`, `fieldId`,
`value`, `slot`, `empty` and `source`. Empty cells are selectable. Repeated selection,
disabled controls and synthetic control events do not create a new selection event.
Host state restoration updates the indicator without emitting business events.
UGUI retains its existing host-event ABI: `RowId`, `FieldId` and `StringValue`
identify the selection; the game can resolve item data from the integration contract.

`set-inventory` changes `grid`, `items`, `selectedSlot` and the pinned
`assetLibrary` atomically. Import, editing, exact bundle reopening and undo retain
the contract. The delivery's integration contract includes the grid and sparse
items. A game can receive selection; item transfer, drag/drop, stacking, sorting,
database persistence and real warehouse transactions are not implemented here.

PanelSpec/Bundle 0.17, native intent 0.13, planning context 0.12, edit context 0.17
and Compiler 0.46 are used only when inventory is present. The UGUI source adapter
is 0.1.9. Existing foundation component types are reused; no seventeenth primitive
or new service is introduced. Native Unity import and interaction are NOT_RUN.

## Reproducing acceptance

Run `node --test tests/inventory-grid.test.mjs tests/inventory-batch.test.mjs` for
geometry, sparse data, exact size preservation, icon closure, selection, locks,
editing/undo, UGUI document export and the finite batch driver with a fake transport.
No model is called by these tests.

Run `node scripts/review-inventory-grid.mjs --output output/<fresh-directory>` to
produce five deterministic delivery specimens: empty 10×10, populated 8×6,
height-limited 10×10, full 12×12 and icon-backed 2×2. The output is explicitly
PROGRAMMATIC_FIXTURE. Browser acceptance verified all first-slot clicks and
keyboard last-slot selections, the scroll-limited last slot, and a mobile last-slot
click after horizontal scrolling. There were no browser errors; the software GPU
reported performance warnings. Browser plugin not available; existing
Playwright/Edge was used.

For real inference, prepare `scripts/input-adaptability.mjs prepare --cohort
inventory-grid-v1 --output output/<fresh-plan>`. Its four unchanged short requests
cover 10×10, 8×6, the unspecified-capacity default and 20×20 capacity clarification.
The immutable plan allows four invocations, one per request, serially, with zero
automatic retries. Preparation and preflight make zero calls. A new approval bound
to that plan digest is required before dispatch. Offline fixtures are never sent
as model answers or reported as real-model results.
