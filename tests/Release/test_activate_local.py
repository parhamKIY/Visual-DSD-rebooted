"""Tampered packages must never replace or clean existing local builds."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile


@unittest.skipUnless(sys.platform == 'win32' and shutil.which('pwsh'), 'Windows local activation')
class LocalActivationSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='visualdsd-activation-test-')
        self.root = Path(self.temp.name).resolve()
        (self.root / 'eng').mkdir()
        source = Path(__file__).resolve().parents[2] / 'eng/activate-local.ps1'
        shutil.copyfile(source, self.root / 'eng/activate-local.ps1')
        self.canary = self.root / 'artifacts/publish/win-x64-0.1.0/student-work.dsdproj.json'
        self.canary.parent.mkdir(parents=True)
        self.canary.write_text('keep this project', encoding='utf-8')
        subprocess.run(['git', 'init', '--quiet', str(self.root)], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(self.root), '-c', 'user.name=Activation Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'fixture'], check=True, capture_output=True)

    def tearDown(self):
        self.temp.cleanup()

    def package(self, *, extra=False, bad_checksum=False, missing_course=False):
        package = self.root / 'visual-dsd-rebooted-win-x64-v0.22.0.zip'
        metadata = dict(version='0.22.0', runtime='win-x64', commit='0' * 40, selfContained=True, entryPoint='VisualDsd.exe')
        with zipfile.ZipFile(package, 'w') as archive:
            archive.writestr('VERSION.json', json.dumps(metadata))
            for name in ['VisualDsd.exe', 'LICENSE', 'NOTICE', 'START-HERE.en.md', 'START-HERE.fa.md', 'examples/Catalytic.dsd', 'examples/State-switch.dsd', 'examples/Two-systems.crn']:
                archive.writestr(name, b'fixture only; never executable')
            # Use the real generated course payload so these admission tests
            # still reach provenance checks when the classroom pack evolves.
            module = (Path(__file__).resolve().parents[2] / 'src/VisualDsd.App/Web/systems-export.js').as_uri()
            code = 'import {termExerciseFiles} from '+json.dumps(module)+'; console.log(JSON.stringify(termExerciseFiles()));'
            course = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code], text=True, encoding='utf-8'))
            for file in course:
                if missing_course and file['name'] == 'COURSE.en.html':
                    continue
                archive.writestr('course/'+file['name'], file['data'])
            if extra:
                archive.writestr('../outside.txt', b'bad')
        digest = 'f' * 64 if bad_checksum else hashlib.sha256(package.read_bytes()).hexdigest()
        Path(str(package) + '.sha256').write_text(digest + '  ' + package.name, encoding='utf-8')
        return package

    def rejects_without_mutation(self, package, message):
        result = subprocess.run(['pwsh', '-NoProfile', '-File', str(self.root / 'eng/activate-local.ps1'), '-Package', str(package)], capture_output=True, text=True, timeout=30)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(message, result.stderr + result.stdout)
        self.assertEqual(self.canary.read_text(encoding='utf-8'), 'keep this project')
        self.assertFalse((self.root / 'artifacts/publish/win-x64').exists())
        self.assertFalse((self.root.parent / 'outside.txt').exists())

    def test_bad_checksum_cannot_replace_or_clean_a_build(self):
        self.rejects_without_mutation(self.package(bad_checksum=True), 'Package checksum mismatch')

    def test_archive_traversal_is_rejected_before_extraction(self):
        self.rejects_without_mutation(self.package(extra=True), 'Unexpected package contents')

    def test_wrong_source_commit_is_rejected_before_executing_anything(self):
        self.rejects_without_mutation(self.package(), 'Package provenance does not match')

    def test_missing_course_material_is_rejected_without_touching_user_work(self):
        self.rejects_without_mutation(self.package(missing_course=True), 'Unexpected package contents')


if __name__ == '__main__':
    unittest.main()
