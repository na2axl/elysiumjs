import { Glob } from 'bun';

const glob = new Glob('dist/**/*.js');

for await (const path of glob.scan('.')) {
	const file = Bun.file(path);
	const code = await file.text();
	const result = new Bun.Transpiler({ minifyWhitespace: true, trimUnusedImports: true }).transformSync(code);
	await Bun.write(file, result);
}
