# Snub-HTTP

Middleware HTTP server that allows you to run http over snub. Simply put it takes http requests, emits and event on the pub/sub bus and waits for a reply.

#### Usage

`npm install snub`
`npm install snub-http`

#### Basic Example

With redis installed and running with default port and no auth.

```javascript
const Snub = require('snub');
const SnubHTTP = require('snub-http');

const snub = new Snub();
const snubHttp = new SnubHTTP();

snub.use(snubHttp);

snub.on('http:*', (payload) => {
  console.log(payload);
});
```

For further examples take a look in [examples](/examples).

#### Advanced Setup
Optional config, defaults are applied if omitted.
```javascript
const Snub = require('snub');
const SnubHTTP = require('snub-http');

const snub = new Snub();
const snubHttp = new SnubHTTP({
    port: 8484, // listen on http port
    debug: false, // dump debug junk
    timeout: 5000 // http timeout (time to wait for reply)
    headers: {
      'Access-Control-Allow-Origin': '*' // global headers to apply to all responses
    },
    requestMutator(reqObj) {
      // must return a request obj, this give you a change to mutate/log incoming requests.
      return reqObj;
    }
  });

snub.use(snubHttp);

```

### API

##### `snub.on('http:{{method}}:{{path}}', (payload, [reply]) => {});`

All events emitted from HTTP will be prefixed with `http:` followed by the method in caps `GET` `POST` `PUT` ... so on. The path is then appended. An example listener will look like this.

```javascript
snub.on('http:GET:/api/hullo', (payload, reply) => {
  console.log(payload);
});
```
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
     'accept-language': 'en-US,en;q=0.8,it;q=0.6' },
  query: { test: '123' } }
```

##### Reply

Reply is a standard snub reply, it accepts a single param, an object with some optional keys. The reply object is passed as the http response.

```javascript
reply({
    headers: {'Content-Type': 'application/json'} // headers are optional.
    statusCode: 200, // int
    body: ['hullo?'] // can be a string or Obj, objects are automatically stringifyed to json.
});
```