const http = require('http');
const querystring = require('querystring');
// const url = require('url');

module.exports = function (config) {
  var headers = {
    'X-powered-by': 'Snub-HTTP',
    'Access-Control-Allow-Origin': '*'
  };
  var optionHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Credentials': false,
    'Access-Control-Max-Age': '86400', // 24 hours
    'Access-Control-Allow-Headers': 'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept'
  };

  config = Object.assign({
    port: 8484,
    debug: false,
    timeout: 5000,
    headers: {},
    optionHeaders: {},
    requestMutator: reqObj => { return reqObj; }
  }, config || {});

  config.headers = Object.assign({}, headers, config.headers);
  config.optionHeaders = Object.assign({}, optionHeaders, config.optionHeaders);

  return function (snub) {
    const requestHandler = (request, response) => {
      if (request.method === 'OPTIONS') {
        response.writeHead(200, config.optionHeaders);
        return response.end();
      }

      var urlParsed = new URL('http://null' + request.url);

      request.headers['x-forwarded-for'] = request.headers['x-real-ip'] || request.headers['x-forwarded-for'] || request.connection.remoteAddress;

      var reqObj = {
        method: request.method,
        path: urlParsed.pathname,
        body: [],
        headers: request.headers
      };
      if (urlParsed.query)
        reqObj.query = querystring.parse(urlParsed.query);

      if (urlParsed.search)
        reqObj.query = querystring.parse(urlParsed.search.substring(1));

      request.on('data', function (chunk) {
        reqObj.body.push(chunk);
      }).on('end', async function () {
        reqObj.body = Buffer.concat(reqObj.body).toString();

        reqObj = await config.requestMutator(reqObj);

        if (!reqObj) {
          response.statusCode = 503;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({
            message: 'Event handler unavailable'
          }));
          return;
        }

        snub
          .mono('http:' + reqObj.method + ':' + reqObj.path, reqObj)
          .replyAt((reply, error) => {
            if (!reply && error) {
              console.error('Snub HTTP => ', error);
              response.statusCode = 500;
              response.setHeader('Content-Type', 'application/json');
              response.end(JSON.stringify({
                message: 'Server Error'
              }));
              return;
            }
            if (!reply)
              reply = {};
            try {
              reply.headers = Object.assign({}, config.headers, reply.headers);
              Object.keys(reply.headers).forEach(i => {
                response.setHeader(i, reply.headers[i]);
              });
              response.statusCode = reply.statusCode || 200;
              if (typeof reply.body === 'string')
                return response.end(reply.body);
              response.setHeader('Content-Type', 'application/json');
              response.end(JSON.stringify(reply.body));
            } catch (error) {
              console.error(error, reqObj, reply);
            }
          })
          .send(delivered => {
            if (delivered > 0) return;
            response.statusCode = 404;
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({
              message: 'Event handler not found'
            }));
          });

        setTimeout(() => {
          if (!response.finished) {
            response.statusCode = 504;
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({
              message: 'Event handler timed out'
            }));
          }
        }, config.timeout);
      });
    };

    const server = http.createServer(requestHandler);

    server.listen(config.port, (err) => {
      if (err)
        return console.error('Snub HTTP => something bad happened', err);
      if (config.debug)
        console.log(`Snub HTTP Listening on ${config.port}`);
    });
  };
};
