#!/usr/bin/env bash
# Install a local CosyVoice 3 text-to-speech engine, pinned to exact revisions. It is the GGUF engine that the desktop
# app VoiceStudio (https://github.com/debpalash/VoiceStudio) uses.
#   core/bin/install-cosyvoice.sh [DEST]        (default: ~/.local/share/cosyvoice; set COSYVOICE_HOME to match)
# Needs git, cmake >= 3.28, ninja and a C++20 compiler. Downloads ~880 MB of model files and checks their SHA-256.
# Licences:
#   runtime  Lourdle/cosyvoice.cpp (https://github.com/Lourdle/cosyvoice.cpp): MIT
#   model    FunAudioLLM Fun-CosyVoice3-0.5B-2512: Apache-2.0 per its model card
#            (https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512), in the GGUF conversion by Lourdle
#            (https://huggingface.co/Lourdle/Fun-CosyVoice3-0.5B-2512-GGUF)
# Cloning a voice requires the permission of its owner.
set -euo pipefail
DEST="${1:-${COSYVOICE_HOME:-$HOME/.local/share/cosyvoice}}"
mkdir -p "$DEST/models/frontend-onnx"
RUNTIME_URL=https://github.com/Lourdle/cosyvoice.cpp.git
RUNTIME_COMMIT=67d45feb2f654bbc66cca25bff78464b3ec08fa1      # the revision VoiceStudio pins for its GGUF engine
[ -d "$DEST/cosyvoice.cpp/.git" ] || git clone -q "$RUNTIME_URL" "$DEST/cosyvoice.cpp"
git -C "$DEST/cosyvoice.cpp" fetch -q origin && git -C "$DEST/cosyvoice.cpp" checkout -q "$RUNTIME_COMMIT"
git -C "$DEST/cosyvoice.cpp" submodule update --init --recursive -q
cmake -S "$DEST/cosyvoice.cpp" -B "$DEST/cosyvoice.cpp/build" -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DCOSYVOICE_NO_ICU=ON -DCOSYVOICE_SERVER_NO_WEBUI=ON >/dev/null
cmake --build "$DEST/cosyvoice.cpp/build" --config Release --parallel >/dev/null
HF=https://huggingface.co/Lourdle/Fun-CosyVoice3-0.5B-2512-GGUF/resolve/ab01740bbbfcc059fd748163787554f7c8977e64
get() { [ -s "$DEST/models/$2" ] || curl -fsSL --retry 3 -o "$DEST/models/$2" "$HF/$1"; }
get CosyVoice3-2512_Q4_K_M.gguf CosyVoice3-2512_Q4_K_M.gguf
get frontend-onnx/campplus.int8.onnx frontend-onnx/campplus.int8.onnx
get frontend-onnx/speech_tokenizer_v3.int8.onnx frontend-onnx/speech_tokenizer_v3.int8.onnx
( cd "$DEST/models" && shasum -a 256 -c - <<'SUMS'
eb40867e270abdcde4ea958e634d5932702e16545d46336659fed9f8f462bc02  CosyVoice3-2512_Q4_K_M.gguf
96b05369863f6cad4a3905206bb376915c2d61af0db16508eeaf2910a0c8a80a  frontend-onnx/campplus.int8.onnx
d7caa04fbc2f54af196906469471b607ce2594b7e92ac07dddfb315103a74c72  frontend-onnx/speech_tokenizer_v3.int8.onnx
SUMS
)
echo "cosyvoice-cli: $DEST/cosyvoice.cpp/build/bin/cosyvoice-cli"
echo "Make a voice profile from a 10–15 s clip you have permission to use:"
echo "  $DEST/cosyvoice.cpp/build/bin/cosyvoice-cli --frontend-only --speech-tokenizer $DEST/models/frontend-onnx/speech_tokenizer_v3.int8.onnx \\"
echo "    --campplus $DEST/models/frontend-onnx/campplus.int8.onnx --prompt-audio voice.wav --prompt-text \"<exact transcript>\" --prompt-speech-output voice.ps"
