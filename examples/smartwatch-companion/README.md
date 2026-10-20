# Smartwatch Companion HTML Preview

Open [demo.html](demo.html) directly in a browser. It needs no build, network connection, or API
key. Sync a workout, send feedback, and review the next plan. Switch between Ava and Liam to
explore separate sample UI state, then reset the preview to repeat the flow.

This page uses illustrative local data. It does not execute API calls or Agent runs, prove tenant
isolation, or connect to a physical watch. Your product owns device sync; its server calls
API Claws. Read the [smartwatch pattern](../../skills/api-claws-creator/references/smartwatch-companion.md)
for the integration boundary and resource mapping.

The installed skill also bundles the HTML and logo under
`skills/api-claws-creator/assets/smartwatch-companion/`. Keep that bundled copy in sync when
changing this HTML or its assets. Copy the entire folder when adapting the preview.

The optional `?render=1` view provides a deterministic 1920x1080 animation. Call
`window.setSceneTime(milliseconds)` to seek its 13.667-second skill-to-product sequence. The
prompt and training plan are examples, not a recording of a coding agent generating an app.
Keep recordings and launch assets outside this public example.
