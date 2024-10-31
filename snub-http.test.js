const Snub = require('snub');
const SnubHTTP = require('snub-http');

var snub = new Snub({
  debug: false,
  // host: 'localhost',
  // password: '',
  // db: 8,

  // redisAuth: 'redis://:@localhost:6379/8',
  redisAuth: {
    // see https://github.com/redis/ioredis#connect-to-redis for more information
    port: 6379, // Redis port
    host: 'localhost', // Redis host
    username: '', // needs Redis >= 6
    password: '',
    db: 8, // Defaults to 0
    debug: false, // Defaults to false
  },
  timeout: 10000,
});

const snubHttp = new SnubHTTP({
  port: 8484, // listen on http port
  debug: false, // dump debug junk
  timeout: 5000, // http timeout (time to wait for reply)
  headers: {
    'Access-Control-Allow-Origin': '*', // global headers to apply to all responses
  },
  requestMutator(reqObj) {
    // must return a request obj, this give you a change to mutate/log incoming requests.
    return reqObj;
  },
});

snub.use(snubHttp);

// setup some endpoints
snub.on('http:GET:/hello', function (payload, reply) {
  reply({ body: {message: payload.query || 'Hello, world!'}});
});

snub.on('http:POST:/formtest', function (payload, reply) {
  const body = JSON.parse(payload.body);
  reply({ body: {message: body}});
});

// tests

test('Basic HTTP Test', async function () {
  const response = await fetch('http://localhost:8484/hello');
  const data = await response.json();

  expect(response.status).toBe(200);
  expect(data).toEqual({ message: 'Hello, world!' });
}, 10000);

test('Query Strings HTTP Test', async function () {
  const response = await fetch('http://localhost:8484/hello?this=that&foo=bar');
  const data = await response.json();

  expect(response.status).toBe(200);
  expect(data).toEqual({ message: { this: 'that', foo: 'bar' } });
}, 10000);

test('Post Form HTTP Test', async function () {
  const formData = {
    username: 'junk_user',
    email: 'junk_email@example.com',
    password: '12345password',
    age: 'not_a_number'
  };

  const response = await fetch('http://localhost:8484/formtest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json' // Indicating that the request body contains JSON data
      },
      body: JSON.stringify(formData) // Convert the form data to a JSON string
    });

  const data = await response.json();

  expect(response.status).toBe(200);
  expect(data).toEqual({ message: formData });
}, 10000);


test('404 HTTP Test', async function () {
  const response = await fetch('http://localhost:8484/nowhere');
  const data = await response.json();

  expect(response.status).toBe(404);
  expect(data).toEqual({ message: 'Event handler not found' });
}, 10000);


function justWait(ms = 1000) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
