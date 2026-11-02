# core

Shared tools used by every bench. Python handles audio and delivery checks, and Node captures HTML scenes frame by frame. The file formats they read and write are specified in [`docs/CONTRACT.md`](../docs/CONTRACT.md).

## Setup

```sh
python3 -m venv .venv && .venv/bin/pip install -r core/requirements.txt         # numpy
(cd core/node && npm install && npx playwright install --only-shell chromium)   # headless Chromium
brew install ffmpeg                                                             # or your platform's package
cp .env.example .env                                                            # optional: provider keys
```

`core/bin/wb` uses `.venv` automatically and loads `.env` from the repo root, if present. It reads plain `KEY=VALUE` lines: a variable already set in your shell (even to an empty value) wins, empty values in `.env` are skipped, and `WB_NO_DOTENV=1` skips the file. Bench engines and tools (`node benches/<bench>/engine/render.mjs`, `bin/studio`, the Python tools) read only the shell environment, so load `.env` into the shell first when they need a key: `set -a; . ./.env; set +a`.

## Commands

| Command | What it does | Output |
|---|---|---|
| `wb voice <piece> [ids] [--takes N] [--provider P] [--force]` | Records one or more takes per line | `voice/<id>__t<k>.wav/.json`, `voice/selection.json` |
| `wb timeline <piece>` | Trims long pauses, applies the voice tempo and places every line and word on the absolute timeline | `timeline.json`, `voice/proc/<id>.wav` |
| `wb music <piece> [--force]` | Composes the music bed over the timeline sections | `audio/music.wav` |
| `wb sfx <piece>` / `--list` / `--audition DIR` | Renders `events.json` with the procedural effects library | `audio/sfx.wav` |
| `wb mix <piece>` | Levels the voices, ducks the music under them, adds effects and normalises to the target loudness, checked after AAC encoding | `audio/mix.wav`, `audio/stems/`, `audio/mix-report.json` |
| `wb audio <piece>` | Runs voice, timeline, music and mix | all of the above |
| `wb verify <video.mp4> [options]` | Delivery checks: format, loudness, true peak, black or frozen stretches, empty first frames | `<video>.verify.json`; exit code 1 on problems |
| `wb new <bench> <name> [--dest DIR]` | Copies a bench's sample (a piece, a report or a whole pack of stories) as the start of yours, without generated files or voice profiles | `work/<bench>/<name>` or `DIR/<name>` |

### `wb verify` options

| Option | Default | Checks |
|---|---|---|
| `--size WxH` | `1080x1920` | the resolution |
| `--fps N` | `30` | the frame rate (`--fps 60` for 60 fps benches) |
| `--lufs L` | `-14` | integrated loudness within ±1 LU of `L` (`-15.5` for the studio bench) |
| `--expected S` | none | the duration within ±0.25 s of `S` |
| `--max-mb MB` | `60` | the file size |
| `--hold-end S` | `2.5` | the last `S` seconds may freeze (an end card hold) |
| `--no-audio` | off | skip the audio checks for a silent file |

It also flags a true peak above −1 dBTP, a missing or silent audio track, black stretches of 0.3 s or more, frozen stretches of 1.5 s or more that start before the end-card hold, and first frames that are almost empty.

## Voice providers

| Provider | Needs | Word timings |
|---|---|---|
| `elevenlabs` | `ELEVENLABS_API_KEY`, a voice id | Exact (API alignment) |
| `openai` | `OPENAI_API_KEY`, a voice name | From a word-level transcription |
| `cosyvoice` | `core/bin/install-cosyvoice.sh` (local CosyVoice 3; CPU), a voice profile | Local faster-whisper if installed, else OpenAI, else estimated; always the script's own words |
| `say` | macOS | Transcribed if `OPENAI_API_KEY` is set, otherwise estimated |
| `silent` | nothing | Estimated: use it to block out timing before paying for voices |

Choose a provider per voice in `script.json` (`"provider"`), or for the whole run with `WB_TTS_PROVIDER=silent`. Voice IDs belong in the environment: write `"voice": "${WB_VOICE_NARRATOR}"`.

Transcriptions for word timings use OpenAI's `WB_TRANSCRIBE_MODEL` (default `whisper-1`; the model must return word timestamps). A local faster-whisper uses `WB_WHISPER_MODEL` (default `medium`) in the language `WB_LANGUAGE`, which defaults to the script's `"language"`.

Voices made with a provider's voice-design tool are governed by that provider's terms.

### Local voices with CosyVoice

```sh
core/bin/install-cosyvoice.sh                       # builds the runtime, downloads and checks the model (~880 MB)
.venv/bin/pip install faster-whisper                # optional: local word timings
```

The runtime is [`Lourdle/cosyvoice.cpp`](https://github.com/Lourdle/cosyvoice.cpp) (MIT). The model is FunAudioLLM's [Fun-CosyVoice3-0.5B](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512) (Apache-2.0 per its model card), in the [GGUF conversion by Lourdle](https://huggingface.co/Lourdle/Fun-CosyVoice3-0.5B-2512-GGUF). It is the same engine the desktop app [VoiceStudio](https://github.com/debpalash/VoiceStudio) uses.

A voice is a 10–15 s clip of someone who agreed to lend their voice, plus its exact transcript. In `script.json`, with paths relative to the piece folder:

```json
"voices": { "narrator": { "provider": "cosyvoice", "reference": "voices/narrator.wav", "reference_text": "Exact words of the clip.", "speed": 1.0 } }
```

The first run turns the clip into a reusable profile (`voices/narrator.ps`); later runs load it directly, or point `"profile"` at one. Profiles are git-ignored (`*.ps`): they are built from real recordings. The transcript must match the **whole** clip word for word: when the clip says more than its transcript, the model drops the beginning of every generated line. The provider transcribes the clip first and refuses a transcript that does not match. Each take uses a different seed, so `--takes 3` gives three readings to choose from. Generation runs on the CPU: in our tests the runtime's Metal path produced garbled audio on Apple Silicon. Budget about 6× real time on a 14-core laptop.

## Music

`provider: "procedural"` (the default) composes a bed with numpy. Styles: `pulse`, `tutorial`, `playful`, `ambient`, `news`, `tension`. Moods per section: `intro`, `build`, `main`, `lift`, `break`, `outro`. The bed ends on a resolved chord at the end of the piece.

`provider: "elevenlabs"` sends a composition plan built from the same sections to a music model. Use the procedural bed as a placeholder while you iterate on the edit.

`wb mix` sets the bed to `music.level` (LUFS, default −23.5) and ducks it by `music.duck` (dB, default −10) while a voice speaks. The full brief is in [`docs/CONTRACT.md`](../docs/CONTRACT.md).

## HTML scenes

`node core/node/frames.mjs --page scene.html --piece <piece> still|preview|final` drives any page that defines `window.render(t)`. The page receives `window.WB = { timeline, brand, script, piece, fps, width, height }` before loading; `brand` comes from `<piece>/brand.json`, else from the file given with `--brand`. Stills are JPEG files, `renders/still-<t>.jpg`. Video frames are piped to ffmpeg, so nothing is written per frame, and the mix is muxed in when `audio/mix.wav` exists. Chromium always runs headless.

## Fonts

`core/bin/fetch-fonts.sh "Poppins:400,600,700" "Inter:400,600"` downloads OFL TrueType files into `assets/fonts/`, which is git-ignored. Canvas engines register them from there.
