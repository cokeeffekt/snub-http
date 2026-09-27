# Snub-HTTP

Middleware HTTP server that allows you to run http over snub. Simply put it
takes http requests, emits an event on the pub/sub bus and waits for a reply.

Requires `snub` 5 and Redis. The handle described under
[Closing](#closing) needs `snub` 5.1.0 or newer.

#### Usage

`npm install snub`
`npm install snub-http`

#### Basic Example

With redis installed and running with default port and no auth.

```javascript
const Snub = require('snub');
const SnubHTTP = require('snub-http');

const snub = new Snub();

snub.use(SnubHTTP());

snub.on('http:GET:/hello', (payload, reply) => {
  reply({ body: { hello: 'world' } });
});
```

`curl localhost:8484/hello` answers `{"hello":"world"}`.

The listener does not have to be in the process that runs the server. Any
snub instance on the same redis and prefix can answer, and with several
listening one of them handles each request.

#### Advanced Setup

Optional config, defaults are applied if omitted.

```javascript
const Snub = require('snub');
const SnubHTTP = require('snub-http');

const snub = new Snub();
const snubHttp = SnubHTTP({
  port: 8484, // listen on http port
  debug: false, // dump debug junk
  timeout: 5000, // http timeout (time to wait for reply)
  headers: {
    'Access-Control-Allow-Origin': '*', // global headers to apply to all responses
  },
  optionHeaders: {
    'Access-Control-Allow-Methods': 'POST, GET', // headers to apply to OPTIONS responses
  },
  requestMutator(reqObj) {
    // must return a request obj, this gives you a chance to mutate/log incoming requests.
    return reqObj;
  },
});

snub.use(snubHttp);
```

| Option | Default | Description |
|---|---|---|
| `port` | `8484` | Port to listen on. |
| `debug` | `false` | Log when the server starts listening. |
| `timeout` | `5000` | How long to wait for a reply, in ms, before answering 504. |
| `headers` | see below | Headers for every response, merged over the defaults. |
| `optionHeaders` | see below | Headers for `OPTIONS` responses, merged over the defaults. |
| `requestMutator` | returns the request | Called with every request before it is emitted. May be async. |

Default `headers`:

```javascript
{
  'X-powered-by': 'Snub-HTTP',
  'Access-Control-Allow-Origin': '*',
}
```

Default `optionHeaders`:

```javascript
{
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Credentials': false,
  'Access-Control-Max-Age': '86400',
  'Access-Control-Allow-Headers': 'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept',
}
```

##### requestMutator

Return the request to let it through, changed or not. Changing `method` or
`path` changes the event that is emitted. Return nothing to refuse the request
with a 503. If it throws, the request is answered with a 500.

```javascript
SnubHTTP({
  async requestMutator(reqObj) {
    if (!(await isAllowed(reqObj.headers.authorization))) return;
    reqObj.path = reqObj.path.replace(/^\/v1/, '');
    return reqObj;
  },
});
```

### API

##### `snub.on('http:{{method}}:{{path}}', (payload, [reply]) => {});`

All events emitted from HTTP will be prefixed with `http:` followed by the method in caps `GET` `POST` `PUT` ... so on. The path is then appended. An example listener will look like this.

```javascript
snub.on('http:GET:/api/hullo', (payload, reply) => {
  reply({ body: 'hullo' });
});
```

A listener can use a glob, `*` also matches `/`.

```javascript
snub.on('http:GET:/users/*', (payload, reply) => {
  // /users/42 and /users/42/posts
  reply({ body: payload.path });
});
```

`OPTIONS` requests are answered by the server with `optionHeaders` and are not
emitted.

##### Paths with a dot

Snub reads a dot in a listener name as the start of a namespace, so
`snub.on('http:GET:/file.json')` listens on `/file`. Use `SnubHTTP.event` to
build the name for a path that has a dot in it.

```javascript
snub.on(SnubHTTP.event('GET', '/file.json'), (payload, reply) => {
  reply({ body: { path: payload.path } }); // '/file.json'
});
```

A glob listener needs nothing extra, `http:GET:/static/*` receives
`/static/app.js`. Neither does an app whose snub has a different `nsSeparator`.

##### How a path is read

- The path is not decoded, `/a%20b` is emitted as `/a%20b`.
- `.` and `..` segments are resolved first, `/x/../b` is emitted as `/b`.
- A path starting `//` is a path, `//example.com/b` is not read as a host.

##### Payload

The payload will be an object with http data.

Example for `[GET] localhost:8484/api/hullo?test=123`

```javascript
{ method: 'GET',
  path: '/api/hullo',
  body: '',
  headers:
   { host: 'localhost:8484',
     connection: 'keep-alive',
     'cache-control': 'no-cache',
     'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_3)',
     'accept-encoding': 'gzip, deflate, sdch, br',
     'accept-language': 'en-US,en;q=0.8,it;q=0.6',
     'x-forwarded-for': '::ffff:127.0.0.1' },
  query: { test: '123' } }
```

| Property | Description |
|---|---|
| `method` | The http method in caps. |
| `path` | The path without the query string. |
| `body` | Always a string, read as utf8. It is not parsed, use `JSON.parse(payload.body)` for a json body. Binary bodies do not survive. |
| `headers` | The request headers, names in lower case. |
| `query` | The query string as an object. Left out when there is no query string. When a key is repeated the last value is kept. |

`headers['x-forwarded-for']` is always set. It is the `x-real-ip` header if
there is one, then the `x-forwarded-for` header, then the address of the
socket. Both headers are sent by the client, only trust the value when a proxy
you control sets them.

There is no limit on the size of a body, set one at the proxy in front.

##### Reply

Reply is a standard snub reply, it accepts a single param, an object with some optional keys. The reply object is passed as the http response.

```javascript
reply({
  headers: { 'Content-Type': 'application/json' }, // headers are optional.
  statusCode: 200, // int, 200 if omitted
  body: ['hullo?'], // can be a string or Obj, objects are automatically stringifyed to json.
});
```

A string `body` is sent as it is with no `Content-Type`, set one in `headers`.
Anything else is sent as json. Headers are merged over the configured
`headers`.

A reply with an invalid `statusCode` or header is logged and the request is
left to time out with a 504.

##### Responses from the server

| Status | Body | When |
|---|---|---|
| 400 | `{"message":"Bad Request"}` | The request target could not be parsed. |
| 404 | `{"message":"Event handler not found"}` | Nothing is listening for the event. |
| 500 | `{"message":"Server Error"}` | Snub gave up waiting for the reply, or `requestMutator` threw. |
| 503 | `{"message":"Event handler unavailable"}` | `requestMutator` returned nothing. |
| 504 | `{"message":"Event handler timed out"}` | A listener took the request and did not reply within `timeout`. |

A listener that never replies is answered by whichever is shorter, the
`timeout` here (504) or the `timeout` of the snub instance (500).

##### Closing

`snub.use()` resolves to a handle.

```javascript
const server = await snub.use(SnubHTTP({ port: 8484 }));

await server.ready; // listening
await server.close(); // port released
```

| Property | Description |
|---|---|
| `ready` | Resolves when the server is listening. Rejects if it could not, a port in use for example. The error is logged either way. |
| `close()` | Stops the server and closes open connections. Resolves when the port is released. |
| `server` | The node `http.Server`. |

`close()` is also on the middleware, for a `snub` older than 5.1.0 where
`use()` resolves to nothing.

```javascript
const snubHttp = SnubHTTP();
snub.use(snubHttp);
await snubHttp.close();
```

#### Changes in 5.1.0

- A request for `//` no longer ends the process.
- `//host/path` is no longer routed as `/path`.
- A `requestMutator` that throws answers 500, it used to end the process.
- A port that is in use is logged and rejects `ready`, it used to end the
  process. Await `ready` if the app should not run without the server.
- Paths with a dot can be routed, see [Paths with a dot](#paths-with-a-dot).
- `use()` returns a handle with `close()`.

#### Tests

`npm test` needs a redis, on port 6379 unless told otherwise.

`SNUB_TEST_REDIS_PORT=6399 SNUB_TEST_HTTP_PORT=8485 npm test`

The `http` group in `snub-smoke` covers the rest.
