# Instructions for agents

You are recreating a video style with your user's own content and brand. Work like a careful video editor: script, voices, timing, picture, sound, review, delivery.

## Before you start

1. Ask what the viewer must understand, who they are, and where the piece will be watched. One idea per piece.
2. Choose the bench with [`docs/production.md`](docs/production.md), then read that bench's README completely. The lessons at the end come from real productions.
3. Read [`docs/CONTRACT.md`](docs/CONTRACT.md): the shapes of `brand.json`, `script.json`, `timeline.json` and `events.json`.
4. Collect the real material: product screens (capture them headless with demo data), brand colours, fonts and logo, voices the user is allowed to use, and the facts each line claims.

## Order of work

1. `core/bin/wb new <bench> <name>`, then edit `brand.json` and `script.json`.
2. Voices: `core/bin/wb voice <piece> --takes 2` (or `WB_TTS_PROVIDER=silent` to block out timing first). Keep the best take per line in `voice/selection.json`.
3. `core/bin/wb timeline <piece>`. From here on, anchor every cue to `timeline.json` words and lines. Never hard-code seconds.
4. Animate. Render stills at every scene change and every important gesture, and look at them **one at a time, in order**.
5. `core/bin/wb music <piece>`, the bench's `events` step, `core/bin/wb mix <piece>`.
6. Render the preview and watch it with sound at phone size. Then render the final and run `core/bin/wb verify` with the bench's format (`--fps 60` for 60 fps benches).

## Done means

- Every frame you sampled is clean: one clear focus, no overlaps, nothing cut by the platform's safe zones, no frozen holds except the end card.
- Every line is intelligible over the music. The mix is −14 LUFS (−15.5 for the studio bench), with true peak ≤ −1 dBTP after encoding.
- `wb verify` reports no problems, or you can explain each one, such as a deliberate end-card hold.
- Each claim in the piece is true of the product on the day it is published.

## Content rules

- No whispered voices. If a take sounds whispered, regenerate it with the same text and voice.
- Background music is audible, like in a commercial, and never covers a word.
- Complete sentences beat trimmed ones. A requested length is a guide.
- Real screens, at their true size. Third-party apps named in a piece appear only with logos you are licensed to use.
- The first frame already has content; the last frame is a real frame, not black.
- Only clone a voice with its owner's permission. Synthetic voices from a voice-design tool are fine.
- Never print or commit keys. They live in `.env`, which is git-ignored.

## Practical notes

- Rendering is headless. Never open a visible browser for a render or a capture.
- Check free disk space before long renders. Delete the frame folders and intermediates you created.
- Renders use one worker and two encoder threads. Each worker holds the piece's images in memory (a tutorial with 250 captures takes about 2.5 GB) and runs its own encoder, so on a machine that also serves something else, look at the free memory before raising them with `--workers N` and `--threads N` (or `WB_RENDER_WORKERS` and `WB_RENDER_THREADS`). Where the machine has a heavy-job queue, start renders and capture runs through it (`pesado -- <command>`).
- Fonts come from `core/bin/fetch-fonts.sh` into `assets/fonts/`.
- A bench's `npm install` is needed once before its first render.
