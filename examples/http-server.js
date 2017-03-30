const Snub = require('snub');
const SnubHTTP = require('../snub-http.js');

const snub = new Snub();
const snubHttp = new SnubHTTP();

snub.use(snubHttp);

snub.on('http:*', (payload, reply) => {
  console.log(payload);
});