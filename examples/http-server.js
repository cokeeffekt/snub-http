const Snub = require('snub');
const SnubHTTP = require('../snub-http.js');

const snub = new Snub();
const snubHttp = new SnubHTTP({
  requestMutator: reqObj => {
    console.log(reqObj);
    if (reqObj.path === '/mutate')
      reqObj.path = '/mutate-test';
    return reqObj;
  }
});

snub.use(snubHttp);

console.log('Running on default port 8484');

snub.on('http:GET:/', (payload, reply) => {
  // console.log(payload);
  reply({
    body: payload
  });
});

snub.on('http:GET:/timeout', (payload, reply) => {
  // doo nothing
});

snub.on('http:GET:/mutate-test', (payload, reply) => {
  reply({
    body: payload
  });
});
