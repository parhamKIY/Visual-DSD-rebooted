"""Publish only the versioned packages from a successful master verification run.

Uses GitHub CLI with the workflow-scoped GH_TOKEN. No credentials are stored.
All artifacts are validated before creating a tag or draft release.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile


def gh(*args, missing=False):
    result = subprocess.run(['gh', *args], capture_output=True, text=True, check=False)
    if result.returncode:
        if missing and 'HTTP 404' in result.stderr:
            return None
        raise RuntimeError('GitHub command failed: ' + result.stderr.strip())
    return result.stdout


def api(path, *args, missing=False):
    result = gh('api', path, *args, missing=missing)
    return None if result is None else json.loads(result)


def validate_package(directory, runtime, version, commit):
    name = f'visual-dsd-rebooted-{runtime}-v{version}.zip'
    package = Path(directory) / name
    checksum = Path(str(package) + '.sha256')
    if {p.name for p in Path(directory).iterdir()} != {name, name + '.sha256'}:
        raise ValueError('Unexpected files in verified artifact')
    expected = hashlib.sha256(package.read_bytes()).hexdigest() + '  ' + name
    if checksum.read_text(encoding='utf-8-sig').strip() != expected:
        raise ValueError('Package checksum mismatch')
    executable = 'VisualDsd.exe' if runtime == 'win-x64' else 'VisualDsd'
    allowed = {executable, 'LICENSE', 'NOTICE', 'START-HERE.en.md', 'START-HERE.fa.md', 'VERSION.json',
               'examples/Catalytic.dsd', 'examples/State-switch.dsd', 'examples/Two-systems.crn'}
    with zipfile.ZipFile(package) as archive:
        files = [p for p in archive.infolist() if not p.is_dir()]
        if len(files) != len(allowed) or {p.filename.replace('\\', '/') for p in files} != allowed:
            raise ValueError('Unexpected release payload')
        if sum(p.file_size for p in files) > 400 * 1024 * 1024 or any(p.file_size == 0 for p in files):
            raise ValueError('Invalid release payload size')
        metadata = json.loads(archive.read('VERSION.json').decode('utf-8-sig'))
        if metadata != dict(version=version, runtime=runtime, commit=commit, selfContained=True, entryPoint=executable):
            raise ValueError('Package provenance does not match the verified run')
        if archive.testzip() is not None:
            raise ValueError('Corrupt release archive')
    return [package, checksum]


def main():
    version = os.environ['RELEASE_VERSION']
    run_id = os.environ['VERIFY_RUN_ID']
    repo = os.environ['GITHUB_REPOSITORY']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version) or not re.fullmatch(r'[1-9]\d*', run_id) or not re.fullmatch(r'[\w.-]+/[\w.-]+', repo):
        raise ValueError('Invalid release inputs')
    prefix = f'repos/{repo}'
    run = api(f'{prefix}/actions/runs/{run_id}')
    if (run['status'], run['conclusion'], run['event'], run['head_branch'], run['path'], run['head_repository']['full_name']) != (
        'completed', 'success', 'push', 'master', '.github/workflows/engine.yml', repo):
        raise ValueError('Release requires a successful master push verification in this repository')
    commit = run['head_sha']
    checkout = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    if checkout != commit:
        raise ValueError('The checked-out source differs from the verified commit; verify current master before release')
    jobs = api(f'{prefix}/actions/runs/{run_id}/jobs?per_page=100')['jobs']
    for name in ['Verify (win-x64)', 'Verify (linux-x64)']:
        if not any(j['name'] == name and j['status'] == 'completed' and j['conclusion'] == 'success' for j in jobs):
            raise ValueError('Both platform verification jobs must succeed')
    tag = 'v' + version
    if api(f'{prefix}/releases/tags/{tag}', missing=True) is not None:
        raise ValueError('A release with this version already exists; it will not be overwritten')
    existing_tag = api(f'{prefix}/git/ref/tags/{tag}', missing=True)
    if existing_tag and (existing_tag['object']['type'] != 'commit' or existing_tag['object']['sha'] != commit):
        raise ValueError('Existing tag targets a different commit')
    with tempfile.TemporaryDirectory(prefix='visual-dsd-release-') as temporary:
        assets = []
        for runtime in ['win-x64', 'linux-x64']:
            directory = Path(temporary) / runtime
            gh('run', 'download', run_id, '--repo', repo, '--name', f'visual-dsd-rebooted-{runtime}', '--dir', str(directory))
            assets += validate_package(directory, runtime, version, commit)
        if not existing_tag:
            api(f'{prefix}/git/refs', '--method', 'POST', '-f', 'ref=refs/tags/' + tag, '-f', 'sha=' + commit)
        gh('release', 'create', tag, '--repo', repo, '--verify-tag', '--target', commit, '--draft', '--title', f'Visual DSD Rebooted {tag}', '--notes-file', 'distribution/RELEASE-NOTES.md')
        gh('release', 'upload', tag, *map(str, assets), '--repo', repo)
        release = api(f'{prefix}/releases/tags/{tag}')
        expected_assets = {p.name: (p.stat().st_size, 'sha256:' + hashlib.sha256(p.read_bytes()).hexdigest()) for p in assets}
        actual_assets = {a['name']: (a['size'], a.get('digest')) for a in release['assets']}
        if actual_assets != expected_assets:
            raise ValueError('Uploaded assets differ; release remains a draft')
        gh('release', 'edit', tag, '--repo', repo, '--draft=false', '--latest')
        print(f'Published https://github.com/{repo}/releases/tag/{tag}')


if __name__ == '__main__':
    main()
