import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {termExerciseFiles} from '../src/VisualDsd.App/Web/systems-export.js';
const destination=resolve(process.argv[2]);
for(const file of termExerciseFiles()){
  const path=resolve(destination,file.name);if(!path.startsWith(destination+'/')&&!path.startsWith(destination+'\\'))throw new Error('Invalid course package path.');
  await mkdir(dirname(path),{recursive:true});await writeFile(path,file.data,'utf8');
}
