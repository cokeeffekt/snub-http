const Snub = require('snub');
const SnubHTTP = require('../snub-http.js');

const snub = new Snub();
const snubHttp = new SnubHTTP();

snub.use(snubHttp);

console.log('Running on default port 8484');

snub.on('http:*', (payload, reply) => {
  // console.log(payload);
  reply({
    body: payload
  });
});
