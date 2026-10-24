import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('release', Path(__file__).parents[2] / 'eng/release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseValidationTests(unittest.TestCase):
    def package(self, directory, *, commit='a' * 40, version='0.21.0', extra=None):
        path = Path(directory) / 'visual-dsd-rebooted-win-x64-v0.21.0.zip'
        metadata = dict(version=version, runtime='win-x64', commit=commit, selfContained=True, entryPoint='VisualDsd.exe')
        files = {'VisualDsd.exe': b'executable', 'LICENSE': b'license', 'NOTICE': b'notice', 'START-HERE.en.md': b'guide', 'START-HERE.fa.md': b'guide', 'VERSION.json': json.dumps(metadata).encode(), 'examples/Catalytic.dsd': b'<a>', 'examples/State-switch.dsd': b'<b>', 'examples/Two-systems.crn': b'| 1 A'}
        files.update({name: b'authored course fixture' for name in release.COURSE_FILES})
        if extra:
            files.update(extra)
        with zipfile.ZipFile(path, 'w') as archive:
            for name, value in files.items():
                archive.writestr(name, value)
        checksum = Path(str(path) + '.sha256')
        checksum.write_text(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.name + '\n', encoding='utf-8')
        return path, checksum

    def test_validates_exact_payload_provenance_and_checksum(self):
        with tempfile.TemporaryDirectory() as directory:
            files = self.package(directory)
            self.assertEqual(release.validate_package(directory, 'win-x64', '0.21.0', 'a' * 40), list(files))
            files[1].write_text('0' * 64 + '  ' + files[0].name, encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'checksum'):
                release.validate_package(directory, 'win-x64', '0.21.0', 'a' * 40)

    def test_rejects_other_commit_other_version_and_unapproved_paths(self):
        for change in [dict(commit='b' * 40), dict(version='0.20.1'), dict(extra={'../outside': b'bad'}), dict(extra={'extra.exe': b'bad'})]:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                self.package(directory, **change)
                with self.assertRaises(ValueError):
                    release.validate_package(directory, 'win-x64', '0.21.0', 'a' * 40)

    def test_rejects_unverified_run_before_any_release_mutation(self):
        env = dict(RELEASE_VERSION='0.21.0', VERIFY_RUN_ID='123', GITHUB_REPOSITORY='owner/repo')
        base = dict(status='completed', conclusion='success', event='push', head_branch='master', path='.github/workflows/engine.yml', head_repository={'full_name': 'owner/repo'}, head_sha='a' * 40)
        for change in [dict(conclusion='failure'), dict(status='in_progress'), dict(event='pull_request'), dict(head_branch='other'), dict(path='other.yml'), dict(head_repository={'full_name': 'fork/repo'})]:
            with self.subTest(change=change), patch.dict(release.os.environ, env), patch.object(release, 'api', return_value={**base, **change}) as api:
                with self.assertRaises(ValueError):
                    release.main()
                self.assertEqual(api.call_count, 1)

    def test_rejects_injected_inputs_before_network_access(self):
        with patch.dict(release.os.environ, dict(RELEASE_VERSION='0.21.0;echo bad', VERIFY_RUN_ID='123', GITHUB_REPOSITORY='owner/repo')), patch.object(release, 'api') as api:
            with self.assertRaises(ValueError):
                release.main()
            api.assert_not_called()

    def test_rejects_checkout_mismatch_before_tag_or_download(self):
        run = dict(status='completed', conclusion='success', event='push', head_branch='master', path='.github/workflows/engine.yml', head_repository={'full_name': 'owner/repo'}, head_sha='a' * 40)
        with patch.dict(release.os.environ, dict(RELEASE_VERSION='0.21.0', VERIFY_RUN_ID='123', GITHUB_REPOSITORY='owner/repo')), patch.object(release, 'api', return_value=run) as api, patch.object(release.subprocess, 'check_output', return_value='b' * 40):
            with self.assertRaisesRegex(ValueError, 'checked-out'):
                release.main()
            self.assertEqual(api.call_count, 1)

    def test_requires_both_platform_jobs_before_any_mutation(self):
        run = dict(status='completed', conclusion='success', event='push', head_branch='master', path='.github/workflows/engine.yml', head_repository={'full_name': 'owner/repo'}, head_sha='a' * 40)
        jobs = dict(jobs=[dict(name='Verify (win-x64)', status='completed', conclusion='success'), dict(name='Verify (linux-x64)', status='completed', conclusion='failure')])
        with patch.dict(release.os.environ, dict(RELEASE_VERSION='0.21.0', VERIFY_RUN_ID='123', GITHUB_REPOSITORY='owner/repo')), patch.object(release, 'api', side_effect=[run, jobs]) as api, patch.object(release.subprocess, 'check_output', return_value='a' * 40):
            with self.assertRaisesRegex(ValueError, 'Both platform'):
                release.main()
            self.assertEqual(api.call_count, 2)

    def test_draft_lookup_resolves_numeric_id_instead_of_published_tag_endpoint(self):
        draft = dict(id=456, draft=True, assets=[])
        with patch.object(release, 'gh', return_value='{"databaseId":456}') as gh, patch.object(release, 'api', return_value=draft) as api:
            self.assertEqual(release.find_release('owner/repo', 'v0.21.0'), draft)
            gh.assert_called_once_with('release', 'view', 'v0.21.0', '--repo', 'owner/repo', '--json', 'databaseId', missing=True)
            api.assert_called_once_with('repos/owner/repo/releases/456')


if __name__ == '__main__':
    unittest.main()
