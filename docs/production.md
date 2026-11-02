# From an idea to a reviewed video

The same loop runs under every bench. The styles differ in what is drawn, not in how a piece is made.

## 1. Decide what the viewer must understand

Write down the single idea the piece leaves behind, who it is for, where it will be watched (feed, stories, a partner's inbox) and what on-screen proof supports it. Collect the real product, correct names, brand assets and any material you are allowed to use. A demo screen must correspond to a flow that exists: claim only what the product does today.

## 2. Pick the bench by what the scene needs

| The scene needs to… | Bench |
|---|---|
| Show how a feature is used, on the real app | `app-tutorial` |
| Explain how a number is calculated | `calculation-explainer` |
| Tell a story in a series of short vertical stories | `story-highlights` |
| Sell an idea with objects that transform, in a crafted brand film | `particle-film` |
| Ship many short, single-message ads from one workshop | `micro-ad-series` |
| Make characters act out a situation, in flat cartoon style | `cartoon-ads` |
| Stage a dialogue between a host and an AI character | `two-character-studio` |
| Report a week of product progress to partners | `progress-report-video` |
| Send a decision-ready document instead of a video | `pdf-report` |

## 3. Script first, then voice, then picture

1. Write `script.json`. Short sentences, one idea per line, written to be heard. Mark `*emphasis*` and give performance hints in `[brackets]`. Write numbers the way they are spoken when captions must match.
2. Record takes: `core/bin/wb voice <piece> --takes 2`. Listen and keep the best take of each line in `voice/selection.json`. Reject any take that whispers, rushes the end of a sentence or misreads a word: regenerate it with the same text and voice.
3. Build the timeline: `core/bin/wb timeline <piece>`. From here on, every visual cue is anchored to a line or a word in `timeline.json`, never to a hard-coded second.
4. Animate. Give every scene a job: situate, demonstrate, compare, explain or close. Keep continuity: an object can change state, scale or context while keeping its identity. Leave time to read on the target device.
5. Review stills at every scene change and every important gesture, **one frame at a time, in order, at a readable size**. Contact sheets hide what changes between frames.
6. Music and effects: `core/bin/wb music <piece>`, effects in `events.json` on the beats of the picture, then `core/bin/wb mix <piece>`. Music must be audible like in a commercial, never covering words.
7. Render the preview and watch it whole with sound. Then render the final, and `core/bin/wb verify` it.

## 4. Review the exported file, not the project

- Watch scenes and transitions in order, at phone size, with extra attention around changes.
- Check complete text, continuity, sharpness, framing and sync. Listen to the whole piece.
- A render that finishes without errors does not prove visual quality, and one loudness number does not prove good sound.
- Write corrections that can be verified: which object, which moment, what change.
- Keep the editable project, the assets used and the decisions behind the edit next to the piece.

## Content rules that held up in production

- No whispered voices, ever. If a take comes out whispered, regenerate it.
- Background music is audible in every piece, as in a commercial, and never covers a word.
- Complete sentences with a natural ending beat a cut made to fit a duration. A requested length is a guide.
- App screens come from real captures, centred and at the true size of cards and buttons. Third-party apps that are named appear only with logos you are licensed to use.
- The first frame already has content: a hook cannot open on an empty background.
- No black tail at the end; the last frame is a real frame.
