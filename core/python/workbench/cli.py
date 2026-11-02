"""wb: the workbench command line.

    wb voice <piece> [ids] [--takes N] [--provider P] [--force]   voice takes per line
    wb timeline <piece>                                          timeline.json + processed voice
    wb music <piece> [--force]                                   music bed (procedural or ElevenLabs)
    wb sfx <piece> | --list | --audition DIR                     sound effects
    wb mix <piece>                                               audio/mix.wav at the target loudness
    wb audio <piece>                                             voice + timeline + music + mix in one go
    wb verify <video.mp4> [options]                              delivery checks
    wb new <bench> <name> [--dest DIR]                           copy a bench's sample as a new piece (or pack)
"""
import os
import shutil
import sys

from . import common, mix, music, sfx, timeline, verify, voice

COMMANDS = {'voice': voice.main, 'timeline': timeline.main, 'music': music.main, 'sfx': sfx.main, 'mix': mix.main, 'verify': verify.main}
# A sample is a folder with one of these: a video piece, a PDF report, or a pack of stories (copied whole).
SAMPLE_FILES = ('script.json', 'report.json', 'pack.json')
# Generated files and voice profiles (*.ps, made from real recordings) are never copied into a new piece.
NOT_COPIED = ('voice', 'audio', 'renders', 'timeline.json', 'events.json', 'plan.json', 'frames', 'cache', '.cache',
              'node_modules', '*.ps')


def audio(argv):
    voice.main(argv)
    timeline.main(argv[:1])
    music.main(argv[:1] + (['--force'] if '--force' in argv else []))
    mix.main(argv[:1])


def new(argv):
    if len(argv) < 2:
        sys.exit('usage: wb new <bench> <name> [--dest DIR]')
    bench, name = argv[0], argv[1]
    root = os.path.join(common.ROOT, 'benches', bench)
    folders = [os.path.join(root, d) for d in ('samples', 'episodes') if os.path.isdir(os.path.join(root, d))]
    if not os.path.isdir(root) or not folders:
        sys.exit(f'unknown bench {bench!r}; see benches/')
    samples = sorted((os.path.basename(f), os.path.join(f, d)) for f in folders for d in os.listdir(f)
                     if any(os.path.isfile(os.path.join(f, d, s)) for s in SAMPLE_FILES))
    if not samples:
        sys.exit(f'{bench} has no sample to copy (a folder with {", ".join(SAMPLE_FILES)})')
    source = samples[0][1]
    dest = os.path.join(argv[argv.index('--dest') + 1] if '--dest' in argv else os.path.join(common.ROOT, 'work', bench), name)
    if os.path.exists(dest):
        sys.exit(f'{dest} already exists')
    shutil.copytree(source, dest, ignore=shutil.ignore_patterns(*NOT_COPIED))
    kind = 'pack' if os.path.isfile(os.path.join(source, 'pack.json')) else 'piece'
    print(f'new {kind} →', dest, f'(from {os.path.relpath(source, common.ROOT)})')


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ('-h', '--help', 'help'):
        print(__doc__)
        return
    cmd, argv = sys.argv[1], sys.argv[2:]
    if cmd == 'audio':
        audio(argv)
    elif cmd == 'new':
        new(argv)
    elif cmd in COMMANDS:
        if not argv:
            sys.exit(f'usage: wb {cmd} <piece>')
        COMMANDS[cmd](argv)
    else:
        sys.exit(f'unknown command {cmd!r}\n{__doc__}')


if __name__ == '__main__':
    main()
