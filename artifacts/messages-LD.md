# L-D → parent: integration notes (no missing symbols)

Every symbol L-D consumes resolved exactly as the contract specified — `raceBanner` (L-A),
`rollProfile` / `creatorSheet` / `SheetRow` / `CreatorSheet` (L-B), and `groupKey` /
`initialDisclosure` / `toggleGroup` / `openGroup` / `encodeDisclosure` / `decodeDisclosure` /
`isOpen` / `DISCLOSURE_STORAGE_KEY` (L-C), plus `UiGroup` / `defaultOpen` in `UiTree.ts`. No
interface was missing or wrong, so nothing was worked around. Two decisions worth recording:

## 1. The Preview panel is PINNED, not a tab (the tabs stay the five tree panels)

The contract (L-D item 5) says "the panel tabs stay as they are", and the tabs are generated from
`UI_TREE` via `screenPanels("select")`. The tree declares five select panels and no `preview`
panel, so `#wireTabs`' `show()` would have hidden a sixth panel. The Preview panel is therefore
rendered with `data-panel="preview"` **and** `data-pinned`; `show()` skips any `[data-pinned]`
panel, so the model + sheet + dice stay visible under whichever tab is open (the user reads the
preview without leaving the Ancestry tab). It is still a real `.ui-panel` with a `panel-head`.

If the parent instead wants Preview to be a sixth tab, add a `preview` panel to `UI_TREE` (L-C's
file) and drop the `data-pinned` attribute in `Menu.#previewPanelHtml` — the tab and the show()
path then pick it up with no other change.

## 2. `data-action="random"` moved onto the dice button (kept working)

The old `<button data-action="random">Random</button>` is replaced by the dice button, which is
`data-action="dice"`. The roll handler is registered on `[data-action="dice"]`, and defensively on
`[data-action="random"]` if any such control survives. `tools/browser-menu.ts` clicks
`[data-action="random"]`; that selector no longer matches a real control, so the parent should
repoint it at `[data-action="dice"]` (the house rule leaves `tools/` to the parent). `probe-wave-l`
already clicks `[data-action="dice"]`.

## 3. Hook signature the engine should use

```ts
export interface MenuCallbacks {
  // …existing callbacks…
  /** Fired AFTER the whole Creator step refreshes, so a listener reading the DOM sees the
   *  rolled race/class/sign/sheet already in place. */
  onRoll?(profile: CharacterProfile): void;
}
```

`Menu` also exposes a public `rollCreator(seed?: number): void` (the parent may call it to paint an
initial preview; a fixed `seed` reproduces a fighter, for tests and screenshots). The engine's own
`new Menu({ … })` call is untouched by L-D; wire `onRoll` into the preview rig there.
