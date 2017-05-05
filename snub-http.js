const http = require('http');
const querystring = require('querystring');
const url = require('url');

module.exports = function (config) {
  config = Object.assign({
    port: 8484,
    debug: false,
    timeout: 5000,
    headers: {
      'X-powered-by': 'Snub-HTTP',
      'Access-Control-Allow-Origin': '*'
    }
  }, config || {});

  return function (snub) {
    const requestHandler = (request, response) => {

      if (request.method === 'OPTIONS') {
        var headers = {};
        headers["Access-Control-Allow-Origin"] = "*";
        headers["Access-Control-Allow-Methods"] = "POST, GET, PUT, DELETE, OPTIONS";
        headers["Access-Control-Allow-Credentials"] = false;
        headers["Access-Control-Max-Age"] = '86400'; // 24 hours
        headers["Access-Control-Allow-Headers"] = "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept";
        response.writeHead(200, headers);
        return response.end();
      }

      var urlParsed = url.parse(request.url);

      var reqObj = {
        method: request.method,
        path: urlParsed.pathname,
        body: [],
        headers: request.headers
      };
      if (urlParsed.query)
        reqObj.query = querystring.parse(urlParsed.query);

      request.on('data', function (chunk) {
        reqObj.body.push(chunk);
      }).on('end', function () {
        reqObj.body = Buffer.concat(reqObj.body).toString();

        snub
          .mono('http:' + reqObj.method + ':' + reqObj.path, reqObj)
          .replyAt(reply => {
            reply.headers = Object.assign({}, config.headers, reply.headers);
            Object.keys(reply.headers).forEach(i => {
              response.setHeader(i, reply.headers[i]);
            });
            response.statusCode = reply.statusCode || 200;
            if (typeof reply.body == 'string')
              return response.end(reply.body);
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(reply.body));
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
      if (err) {
        return console.log('something bad happened', err);
      }
      if (config.debug)
        console.log(`Snub HTTP Listening on ${config.port}`);
    });
  };
};