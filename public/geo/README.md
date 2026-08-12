# World country boundaries

`world-countries.geojson` is a reduced web subset derived from Natural Earth's
`ne_110m_admin_0_countries.geojson`. Singapore and Malta are absent at 1:110
million, and the former Liechtenstein placeholder was not a source feature, so
the Singapore, Liechtenstein, and Malta features are taken unchanged from
`ne_10m_admin_0_countries.geojson` at the same source revision.

- Source repository: https://github.com/nvkelso/natural-earth-vector
- Source revision: `ca96624a56bd078437bca8184e78163e5039ad19`
- Scale: 1:110 million, with Singapore, Liechtenstein, and Malta at 1:10 million
- Terms: Natural Earth data is public domain
- Retained properties: `ISO3`, `name`
- Geometry: unchanged from the source feature

The conversion uses `ISO_A3` when Natural Earth provides a three-letter ISO
code. `NOR` and `FRA` use `ADM0_A3` because their source `ISO_A3` value is
`-99`. Features without an ISO 3166-1 alpha-3 code are excluded.

`world-countries-index.json` contains only the ISO3/name pairs used by the
accessible keyboard and touch country selector. The application does not store
the world geometry in React state.
