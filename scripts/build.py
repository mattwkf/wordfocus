"""Build a reproducible XPI and source ZIP using Python's standard library."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
DIST.mkdir(exist_ok=True)
manifest = json.loads((ROOT / 'manifest.json').read_text())
version = manifest['version']
assert manifest['applications']['zotero']['strict_max_version'] == '10.0.*'
assert manifest['applications']['zotero']['update_url'].startswith('https://')

def archive(path, entries):
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as package:
        for source, target in entries:
            info = zipfile.ZipInfo(target, (2026, 10, 26, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            package.writestr(info, source.read_bytes())
    with zipfile.ZipFile(path) as package:
        assert package.testzip() is None
    print(f'{path.name}  {path.stat().st_size} bytes  SHA256 {hashlib.sha256(path.read_bytes()).hexdigest()}')

runtime = ['manifest.json', 'bootstrap.js', 'content/word-focus.js', 'LICENSE', 'README.md', 'VALIDATION.md']
archive(DIST / f'word-focus-{version}.xpi', [(ROOT / f, f) for f in runtime])
sources = sorted(p for p in ROOT.rglob('*') if p.is_file()
                 and not any(part in {'dist', '__pycache__', 'node_modules', '.git'} for part in p.relative_to(ROOT).parts))
archive(DIST / f'word-focus-{version}-source.zip', [(p, 'word-focus/' + p.relative_to(ROOT).as_posix()) for p in sources])
