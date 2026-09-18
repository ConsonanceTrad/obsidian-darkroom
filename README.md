# Darkroom

> [**A Dark Room**](https://github.com/doublespeakgames/adarkroom) — a minimalist text adventure — ported into Obsidian.

---

## ⚠️ Provenance and license

**This plugin is not the original game.** It is a port; the game itself was made by someone else. Please note the attribution below.

| | |
| --- | --- |
| Original work | **A Dark Room — A Minimalist Text Adventure** |
| Author / copyright | **Michael Townsend / Doublespeak Games** |
| Upstream repository | https://github.com/doublespeakgames/adarkroom |
| Pinned commit | `1fada4620b6c66bd07bf15a3f1eb8223df8bc1d7` (upstream v1.4) |
| **Original license** | **Mozilla Public License 2.0 (MPL-2.0)** — full text in [`LICENSE-ADARKROOM.md`](./LICENSE-ADARKROOM.md) |
| Adapter layer license | MIT — see [`LICENSE`](./LICENSE) |
| Full provenance & changes | [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) |

The upstream source is **redistributed verbatim** in [`src/game/upstream/`](./src/game/upstream) — every file there is byte-for-byte identical to the upstream tarball, which is what satisfies the source-availability requirement of MPL-2.0 §3.2. Every change this plugin makes is applied **at build time**, only to the generated artifacts, and is itemised in the `buildTimeTransforms` field of [`src/game/upstream.meta.json`](./src/game/upstream.meta.json).

This port is not affiliated with or endorsed by Doublespeak Games. The name and content of "A Dark Room" belong to its original author.

---

## What this is

A Dark Room begins with a dying fire. You light it in the dark; someone is drawn to the light. You send them out to scavenge, raise a village, and eventually walk into the empty world outside. It has almost no graphics — just text, whitespace and pacing.

This plugin turns it into a **native Obsidian view** rather than an embedded web page: the game renders directly into Obsidian's DOM, wired into the plugin lifecycle, save persistence and the command palette, and it exposes a public API for other plugins to hook into.

**This port is silent** — the original's sound effects and music are not bundled. The interface ships in **English and Simplified Chinese**, and defaults to **English** (Settings → Darkroom → Language).

## Install

Manual install:

1. Build the artifacts (or download a release), then copy `main.js`, `styles.css` and `manifest.json` into
   `<your vault>/.obsidian/plugins/obsidian-darkroom/`
2. Enable **Darkroom** under Settings → Community plugins

## Usage

- Command palette: **Open A Dark Room**
- Progress is saved automatically, and the save file lives in the plugin's own `data.json` — so it syncs along with your vault
- The in-game **save** menu can export / import save codes

## Development

```bash
npm install
npm run dev        # watch + incremental build
npm run build      # production build, output in output/
npm run typecheck  # type check
```

`npm run build` first runs the build-time codegen (parses the upstream `index.html`, concatenates the scripts into an isolated runtime, scopes the upstream CSS), then hands off to esbuild.

### Layout

```
src/
  main.ts                 plugin entry point
  game/
    upstream/             A Dark Room upstream source (kept verbatim, MPL-2.0)
    upstream.meta.json    provenance, vendored/excluded lists, build-time change log
    generated/            build-time generated artifacts (not committed)
scripts/                  build-time codegen scripts
docs/                     public API documentation
```

## License

- Adapter layer of this plugin: **MIT** ([`LICENSE`](./LICENSE))
- `src/game/upstream/**` (A Dark Room upstream source and the bundled third-party libraries): **MPL-2.0** plus the respective licenses of each library ([`LICENSE-ADARKROOM.md`](./LICENSE-ADARKROOM.md), [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md))
