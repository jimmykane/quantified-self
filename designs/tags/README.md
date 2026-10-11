# Tags route design review

Six interactive design proposals for a future authenticated `/tags` route and a **Tags** sidenav entry:

- **Tag library:** a searchable saved-tag rail beside the events table.
- **Top tabs:** tag tabs above a full-width events table.
- **Chip bar:** wrapping tag filter chips above the table.
- **Tag gallery:** saved-tag tiles with activity counts, followed by the selected tag's table.
- **Focus picker:** one prominent tag selector above the table.
- **Tag directory:** an alphabetical directory that opens a tag's table and provides a return action.

This is a design-only change. It does not register an Angular route or change the live sidenav. The HTML approximates the existing `EventTableComponent` presentation with synthetic activities; the final implementation should reuse that component, the existing catalog service, Material controls, the workspace shell, and app haptics. No account data, backend queries, or tag writes are used by these proposals. Product help will be updated with the selected implementation, after a design is chosen.

All designs support tag selection, scoped activity search, sorting, page selection, pagination, column visibility, and a local activity preview. **Race day** demonstrates a saved catalog label with no current event membership. Counts are calculated from the complete synthetic fixture, not stored in the tag catalog; the implementation must not imply complete account-wide counts from a bounded event read. Browsing tag membership across all dates needs an explicit loading, completeness, error, and pagination contract; the existing Calendar table only filters its loaded period. Any normalized lookup fields, indexed query, or pagination work belongs to the implementation review.

The fragment uses the visualization runtime's six-variant carousel. Its default appearance follows the host. Distance and duration display strings are generated from `fixture-data.ts` through `shared/unit-aware-display.ts` and Sports Lib, with metric and imperial test coverage. Optional design controls select distance units and comfortable row density.

Run the prototype checks with the repository's installed dependencies:

```sh
node --test designs/tags/verify-designs.test.cjs
```

When reusing another checkout's dependencies, set `NODE_PATH` to that checkout's `node_modules` path. The tests compare the embedded fixture with the formatter output to detect stale metric strings.

To inspect the rendered fragment locally, use the installed visualization skill renderer:

```sh
python3 <visualize-skill-directory>/scripts/render.py <absolute-path>/designs/tags/tags-route-designs.html --serve
```
