# Compact shop facts 1.0

Optional `rows.backgroundPolicy` forwards the consumer's exact version 1.0 object
(`mode: parent` or `own`) to `bindings[].states.list.backgroundPolicy`.
It requires a nonempty `rows.backgroundEvidence` explaining the source/layout
decision. Parent mode omits the independent List background material and binds
only normal/selected rows. Omission retains legacy own-background behavior.
The evidence is recorded in derivedTestStates; reference observations are not
rewritten. Never infer parent mode merely because an attempted background failed.
See the sole consumer contract: [List background](../../ui-component-harness/docs/list-background-v1.md).

Opt-in `planningProfile:"shop-facts-v1"` requests source-bound observations from
the planning provider. `expand_shop_facts(reference, facts)` deterministically
constructs native 1.2 components, row ownership, linkages, appearance bindings,
state evidence and material plans. It never loads a previous sample or native
JSON template. The provider prompt carries the schema example itself; it does
not require an MCP to read repository files.

The bounded profile is one panel, horizontal category Tabs, an initially empty
search Input, a closed sort Select, a uniform product List, a selected-name and
quantity/total footer, one CheckBox and two action Buttons. The initial selected
category is All; exactly one product is selected. Unsupported layouts and missing
required observations fail explicitly. This is not a general 16-component
screenshot recognizer.

The CheckBox profile uses a square mark whose side equals the control height.
The label must start after that square; extra label spacing is not part of the
mark texture. Non-square checkbox artwork needs a separately supported profile.

Facts use `kind:ui_shop_facts_v1`, `version:1.0`; the canonical JSON limit is
15,360 UTF-8 bytes. The planning response envelope is limited to 65,536 bytes.
All rectangles are integer source-image pixel-edge `[x,y,width,height]`, except
`rows.template` rectangles are row-local. `source.sha256` and canvas must match
the original bytes and dimensions. Only identity-oriented images are supported.

This complete example is a synthetic schema illustration, not source evidence
or a set of defaults. Replace all content and geometry for a new screenshot:

```json
{
  "kind": "ui_shop_facts_v1",
  "version": "1.0",
  "source": {
    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
    "canvas": [
      640,
      480
    ]
  },
  "observation": {
    "basis": "single-static-shop-screen",
    "unknowns": []
  },
  "background": {
    "semantics": "A quiet muted teal-blue room background behind the shop panel.",
    "rect": [
      0,
      0,
      640,
      480
    ]
  },
  "panel": {
    "semantics": "A centered slate shop panel with a shallow crown/header band.",
    "rect": [
      24,
      18,
      592,
      444
    ],
    "headerRect": [
      24,
      18,
      592,
      62
    ],
    "title": {
      "text": "Supply Depot",
      "bounds": [
        40,
        24,
        220,
        40
      ]
    },
    "subtitle": {
      "text": "Choose equipment",
      "bounds": [
        40,
        54,
        220,
        18
      ]
    },
    "balance": {
      "text": "320",
      "bounds": [
        484,
        24,
        48,
        28
      ],
      "currencyRect": [
        536,
        24,
        30,
        30
      ]
    }
  },
  "theme": {
    "colors": {
      "canvas": "#27343B",
      "panel": "#303740",
      "text": "#F8F3E7",
      "muted": "#C9D1D1",
      "accent": "#5DA6BF",
      "selected": "#3F829A",
      "button": "#376F82",
      "buttonText": "#FFFFFF",
      "activeTabText": "#FFFFFF",
      "quantityText": "#F8F3E7",
      "border": "#52656A"
    },
    "fontSizesPx": {
      "title": 22,
      "subtitle": 14,
      "body": 14,
      "price": 14,
      "footer": 14,
      "button": 14,
      "tab": 14,
      "checkbox": 14,
      "slogan": 12,
      "quantity": 14,
      "sort": 13,
      "itemName": 14
    },
    "shape": {
      "borderWidthPx": 1,
      "cornerRadiusPx": 8
    }
  },
  "tabs": {
    "rect": [
      40,
      86,
      552,
      44
    ],
    "items": [
      {
        "id": "all",
        "label": "ALL",
        "labelBounds": [
          70,
          96,
          44,
          20
        ],
        "glyphDescription": "four-square grid symbol",
        "glyphBounds": [
          48,
          98,
          18,
          18
        ],
        "glyphPaletteRects": {
          "normal": [
            4,
            4,
            3,
            3
          ],
          "active": [
            8,
            4,
            3,
            3
          ]
        },
        "category": null,
        "selected": true,
        "bounds": [
          40,
          86,
          92,
          44
        ]
      },
      {
        "id": "gear",
        "label": "GEAR",
        "labelBounds": [
          168,
          96,
          48,
          20
        ],
        "glyphDescription": "crossed tool silhouettes",
        "glyphBounds": [
          144,
          98,
          18,
          18
        ],
        "glyphPaletteRects": {
          "normal": [
            4,
            4,
            3,
            3
          ],
          "active": [
            8,
            4,
            3,
            3
          ]
        },
        "category": "gear",
        "selected": false,
        "bounds": [
          132,
          86,
          92,
          44
        ]
      }
    ]
  },
  "search": {
    "rect": [
      40,
      138,
      250,
      34
    ],
    "iconBounds": null,
    "iconDescription": null,
    "textBounds": [
      52,
      144,
      220,
      22
    ],
    "placeholder": "Search supplies",
    "value": "",
    "editingState": {
      "focused": {
        "status": "unknown",
        "reason": "The source pixels do not establish this input editing state."
      },
      "caretVisible": {
        "status": "unknown",
        "reason": "The source pixels do not establish this input editing state."
      },
      "selectionStart": {
        "status": "unknown",
        "reason": "The source pixels do not establish this input editing state."
      },
      "selectionEnd": {
        "status": "unknown",
        "reason": "The source pixels do not establish this input editing state."
      },
      "selectionDirection": {
        "status": "unknown",
        "reason": "The source pixels do not establish this input editing state."
      }
    }
  },
  "sort": {
    "rect": [
      420,
      138,
      132,
      34
    ],
    "labelBounds": [
      428,
      144,
      88,
      22
    ],
    "indicatorBounds": [
      526,
      148,
      14,
      14
    ],
    "selectedValue": "price-asc",
    "popupRect": [
      420,
      172,
      132,
      64
    ],
    "popupContentRect": [
      424,
      174,
      124,
      60
    ],
    "optionRowHeightPx": 30,
    "options": [
      {
        "label": "Price ↑",
        "value": "price-asc",
        "field": "unitPrice",
        "direction": "asc"
      },
      {
        "label": "Name A–Z",
        "value": "name-asc",
        "field": "searchText",
        "direction": "asc"
      }
    ],
    "evidence": "The dropdown is closed and its visible selected label and explicit option labels support this bounded derived menu."
  },
  "rows": {
    "viewport": [
      40,
      180,
      512,
      130
    ],
    "sourcePitchPx": 58,
    "template": {
      "rowHeightPx": 54,
      "imageRect": [
        8,
        8,
        38,
        38
      ],
      "nameRect": [
        56,
        6,
        190,
        18
      ],
      "descriptionRect": [
        56,
        26,
        190,
        16
      ],
      "currencyRect": [
        350,
        12,
        30,
        30
      ],
      "priceRect": [
        390,
        16,
        60,
        22
      ],
      "markRect": [
        472,
        12,
        24,
        24
      ]
    },
    "items": [
      {
        "id": "cargo",
        "name": "Cargo Crate",
        "description": "Packed travel provisions",
        "priceText": "25",
        "searchText": "Cargo Crate Packed travel provisions",
        "unitPrice": 25,
        "category": "gear",
        "iconDescription": "a small brown travel container",
        "selected": true
      }
    ]
  },
  "sharedCurrency": {
    "sourceRect": [
      390,
      192,
      30,
      30
    ],
    "description": "A small round gold coin with a dark stamped center.",
    "evidence": "The same coin design appears at the header balance and beside row prices."
  },
  "footer": {
    "rect": [
      40,
      326,
      512,
      120
    ],
    "selectedName": {
      "text": "Selected: Cargo Crate",
      "bounds": [
        48,
        336,
        180,
        22
      ],
      "prefix": "Selected: ",
      "emptyText": "—"
    },
    "quantity": {
      "minusRect": [
        190,
        378,
        24,
        28
      ],
      "valueRect": [
        218,
        378,
        40,
        28
      ],
      "valueTextBounds": [
        230,
        382,
        16,
        20
      ],
      "plusRect": [
        262,
        378,
        24,
        28
      ],
      "value": 2
    },
    "total": {
      "text": "Total: 50 G",
      "bounds": [
        342,
        336,
        110,
        22
      ],
      "prefix": "Total: ",
      "suffix": " G",
      "fractionDigits": 0,
      "grouping": "none",
      "emptyText": "—"
    },
    "checkbox": {
      "rect": [
        48,
        414,
        190,
        26
      ],
      "labelBounds": [
        74,
        416,
        164,
        20
      ],
      "label": "Remember selection",
      "checked": false
    },
    "buttons": [
      {
        "rect": [
          340,
          378,
          96,
          30
        ],
        "labelBounds": [
          350,
          383,
          76,
          20
        ],
        "label": "Back",
        "role": "back",
        "textColor": "#FFFFFF"
      },
      {
        "rect": [
          444,
          378,
          108,
          30
        ],
        "labelBounds": [
          454,
          383,
          88,
          20
        ],
        "label": "Purchase",
        "role": "purchase",
        "textColor": "#FFFFFF"
      }
    ],
    "slogan": {
      "text": "Ready for the journey",
      "bounds": [
        232,
        418,
        102,
        20
      ]
    }
  },
  "runtimeDerivations": {
    "categoriesEvidence": "The visible ALL tab and complete supplied item rows establish the initial all-category list; GEAR owns the gear category.",
    "quantityBounds": {
      "min": 1,
      "max": 20,
      "step": 1,
      "evidence": "The observed control has decrement and increment affordances and the explicitly supplied safe range is 1 through 20."
    },
    "rowSpacing": {
      "outputPitchPx": 58,
      "evidence": null
    },
    "search": {
      "match": "contains",
      "caseSensitive": false,
      "evidence": "The profile uses literal case-insensitive contains search over the explicitly supplied searchText field."
    },
    "selectionOnFilter": "clear",
    "quantityOnSelectionChange": "reset",
    "purchaseEmptySelection": "disabled"
  }
}
```

`headerRect` describes the source header area; the single Panel material owns
its crown once. `tabs.rect` may be omitted and computed as the union of the
explicit tab bounds. Each tab has its own stable ID, label bounds, glyph bounds
and explicit normal/active palette ROIs. Those palettes must satisfy the
[planned-glyph contract](planned-glyphs-v1.md); alternate glyphs retain the
canonical Alpha exactly and do not occupy generation slots.

`rows.template.markRect` is a reservation. Optional `markGlyphRect` is the
observed selected feedback extent inside it. Selection feedback belongs to the
selected-row state surface; it is never baked into the scene or ordinary rows.
The consumer currently carries this feedback in its selected-row image, not a
separate List icon-state contract. The compiler does not recognize arbitrary
painted marks after generation.

Every product occurs once, with a unique ID and explicit integer unit price,
search text and category. Every category maps to one non-All tab. Source order
must already agree with the selected sort; no silent initial reordering occurs.
`sharedCurrency.sourceRect` must identify the first row's coin, and every coin
placement must have the same dimensions. One canonical source serves the header
and all row coins; no coin is invented beside the total.

`quantity.valueRect` is the complete number-field surface;
`quantity.valueTextBounds` is its independently supplied text region. Minus,
number field and plus have separate geometry. `selectedName.text` and
`total.text` contain the complete observed visible strings, including their
explicit prefix/suffix. Quantity limits, category membership, search behavior,
unshown menu options and changed row pitch require derived evidence. The footer
slogan's upper edge is the explicit safe boundary for the two action buttons;
negative space fails. Quantity buttons are explicitly non-footer actions.

The twelve font roles in the example are required. Arial is the default system
font; source font identification is not asserted. Item names have an explicit separate font role; action Buttons have individual text colors. Active Tabs and quantity controls have separate palette fields, so they do not inherit the primary Button color by accident. Title/subtitle extent checks
use 0.90–1.10 width ratio and center tolerances of 3% width / 20% height, with a
2 px floor. Other allocated text boxes remain containment/size targets, not
invented measurements of glyph ink. Original observed text and comparison scope
remain present. Actual painted edges and browser typography still need testing.

All five Input editing fields use explicit observed evidence or unknown with a
reason. Unknowns remain unknown in reference-state 1.1. Unshown runtime states
and layout choices are recorded separately in acceptance-scope derived states.
Neither compilation nor model review establishes human visual acceptance.

Materials use bounded component-type boards, the formal content-gap 1.2
strategy, solid-key extraction and explicit shared/derived source evidence.
Background and Panel are separate; each other used component type has a board.
This profile uses up to nine requests for the illustrated supported types.
Frame occupancy requirements flow through native 1.2 to the materialized build
gate. They check declared geometry, not arbitrary icon identity or ornament
recognition.

`compile_delivery` accepts these facts through `shop_facts_adapter`; both supplied
responses and live planner routing use the same DAG. The compiler records facts,
native and plan digests. Every generated prompt binds the facts digest. Native
1.0/1.1 and legacy vision behavior remain available. The DAG freezes the plan and
waits for fresh single-use authorization; no media is generated during preflight.
No 20-minute successful-delivery guarantee is implied.

The compiler reserves at least 1.25 font heights for Text and CheckBox labels,
preserving their vertical center when extending short observed boxes. Shared
shop controls belong directly to the Panel; category Tabs have distinct empty
page containers, so tab visibility cannot hide the shared filtering controls.
For a selected-name binding, a second wrapped line is allowed only when the
existing space before the checkbox accommodates it with a 4-unit gap. Its first
line origin, font and width remain unchanged. This derived layout is recorded
in acceptance-scope; the original selection remains reference evidence. The
real-input linkage gate must still verify every item name without truncation.
When an explicitly recorded runtime row pitch differs from the source pitch,
text checks retain the original referenceRegion and separately project each
runtime region by its row index. They do not enlarge comparison tolerances.
Quantity step glyphs reserve the central 60% of width and 75% of height, centered
inside their existing buttons. The surrounding frame is not declared as text;
it remains available for actual appearance pixel checks. Font, button bounds,
hit area and materials are unchanged. Very small controls must still pass the
ordinary text containment gate; the reservation is not an overflow exemption.

Optional producer-only `materialObservations:{version:"1.0",items:[...]}` records
reviewed appearance details per real `layerId`. Each item requires nonempty
`evidence` and may declare `minimumOccupancy:{width:0.85,height:0.9}` (illustrative
values, measured fractions in (0,1]). Unknown/duplicate IDs, unknown fields and
invalid versions/fractions fail. Evidence is bound into the generation description
and acceptance-scope as a delivery requirement, never an observed alternate state.
Occupancy assertions compile to the existing native visibleGeometryRequirements
and cannot lower an existing minimum. Legacy facts without observations are
unchanged and do not acquire this coverage automatically.

Inspect static icon tiles separately from their enclosing runtime controls. If a
tile/backplate belongs to the Image, explicitly assign it in its description;
ownership exclusions must not erase it as an enclosing control. Review coin and
search-symbol visible support, row border weight, checkbox polarity and Panel
separators before compute. These semantic appearance observations are prompt and
review requirements, not automatic recognition tests. Alpha occupancy alone
cannot detect a missing backplate or arbitrary residual text.

State review must cover the surface fill, outline, owned mark and mark/divider
registration separately. For example, a selected row with both a pale blue fill
and a thin blue outline needs both observations; recording only the outline is
incomplete. Review the assembled default state before the expensive interaction
and Studio roundtrip stages. A generated row can pass distinctness and geometry
checks while omitting its observed fill; retain this as a visual defect, not a
technical failure waiver or a claim of full reference restoration. This is a
planning/review rule, not an automatic semantic color recognition capability.
# Disconnected tab glyph observations

`tabs.items[].glyphStructure` is an optional bounded source observation with exactly
`columnGroups`, `rowGroups` (integers 2–4), `maxInternalGapRatio` (positive, at most
0.25 of glyph height), and nonempty `evidence` (at most 1000 characters).
Declare it only for an observed disconnected rectangular grid. Names, expected
slot counts, and provider output do not establish source topology.

The compiler maps the declaration to the generated canonical glyph: selected
tabs use `tab-icon-{id}-active`, others `tab-icon-{id}`. The finalized `shop-tabs`
board uses extraction 1.3 and preserves the declaration in its hashed strategy
and generation prompt. Other families and facts without declarations retain 1.2.
The global 0.08 internal gap cap and external separation gates are unchanged.
Mixed-height generation prompts state the actual external gutter bound. Correct
grid grouping does not imply that a dense returned board passes separation.
