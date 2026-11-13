// Runs under Node.js with --disallow-code-generation-from-strings, like workerd: any
// new Function or eval left in the bundle throws.
const { default: worker } = await import(process.argv[2]);

const post = (path, body) =>
	worker.fetch(
		new Request(`http://localhost${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	);

const ok = await post('/me/follows/abc', { note: 'hi' });
const okBody = await ok.json();
if (ok.status !== 200 || okBody.authorId !== 'abc' || okBody.note !== 'hi') {
	throw new Error(`Unexpected response ${ok.status}: ${JSON.stringify(okBody)}`);
}
if (ok.headers.get('x-module') !== 'social') throw new Error('The module middleware did not run.');

const invalid = await post('/me/follows/ab', {});
if (invalid.status !== 422) throw new Error(`Expected a validation error, got ${invalid.status}.`);

const spec = await worker.fetch(new Request('http://localhost/openapi/json'));
const paths = Object.keys((await spec.json()).paths ?? {});
if (spec.status !== 200 || !paths.includes('/me/follows/{id}')) {
	throw new Error(`The OpenAPI document does not list the route: ${spec.status} ${paths}`);
}

console.log('Served a validated route without code generation under Node.js', process.version);
