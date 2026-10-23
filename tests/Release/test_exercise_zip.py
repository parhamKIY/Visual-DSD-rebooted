import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile


class ExerciseZipTests(unittest.TestCase):
    def test_browser_zip_is_readable_by_the_independent_standard_library(self):
        root = Path(__file__).resolve().parents[2]
        module = (root / 'src/VisualDsd.App/Web/course-export.js').as_uri()
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / 'exercise.zip'
            code = ('import {zipFiles} from ' + json.dumps(module) + ';'
                    'import {writeFileSync} from "node:fs";'
                    'writeFileSync(process.argv[1],zipFiles([{name:"report.html",data:"<!doctype html><p>hello</p>"},'
                    '{name:"nested/data.csv",data:"Time,Value\\r\\n0,1\\r\\n"},'
                    '{name:"notes.json",data:JSON.stringify({student:"دانشجو"})}]));')
            subprocess.run(['node', '--input-type=module', '-e', code, str(destination)], check=True, cwd=root)
            with zipfile.ZipFile(destination) as archive:
                self.assertIsNone(archive.testzip())
                self.assertEqual(set(archive.namelist()), {'report.html', 'nested/data.csv', 'notes.json'})
                self.assertEqual(archive.read('nested/data.csv').decode(), 'Time,Value\r\n0,1\r\n')
                self.assertEqual(json.loads(archive.read('notes.json'))['student'], 'دانشجو')
                self.assertTrue(all(entry.flag_bits & 0x800 for entry in archive.infolist()))


if __name__ == '__main__':
    unittest.main()
