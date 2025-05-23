const http = require('http');

module.exports = function (config) {
  const headers = {
    'X-powered-by': 'Snub-HTTP',
    'Access-Control-Allow-Origin': '*',
  };
  const optionHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Credentials': false,
    'Access-Control-Max-Age': '86400', // 24 hours
    'Access-Control-Allow-Headers':
      'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept',
  };

  config = Object.assign(
    {
      port: 8484,
      debug: false,
      timeout: 5000,
      headers: {},
      optionHeaders: {},
      requestMutator: (reqObj) => {
        return reqObj;
      },
    },
    config || {}
  );

  config.headers = Object.assign({}, headers, config.headers);
  config.optionHeaders = Object.assign({}, optionHeaders, config.optionHeaders);

  return function (snub) {
    const requestHandler = (request, response) => {
      if (request.method === 'OPTIONS') {
        response.writeHead(200, config.optionHeaders);
        return response.end();
      }

      const urlParsed = new URL(request.url, 'http://localhost');

      request.headers['x-forwarded-for'] =
        request.headers['x-real-ip'] ||
        request.headers['x-forwarded-for'] ||
        request.connection.remoteAddress;

      let reqObj = {
        method: request.method,
        path: urlParsed.pathname,
        body: [],
        headers: request.headers,
      };
      const query = Object.fromEntries(urlParsed.searchParams);
      if (Object.keys(query).length > 0) {
        reqObj.query = query;
      }

      request
        .on('data', function (chunk) {
          reqObj.body.push(chunk);
        })
        .on('end', async function () {
          reqObj.body = Buffer.concat(reqObj.body).toString();

          reqObj = await config.requestMutator(reqObj);

          if (!reqObj) {
            response.statusCode = 503;
            response.setHeader('Content-Type', 'application/json');
            response.end(
              JSON.stringify({
                message: 'Event handler unavailable',
              })
            );
            return;
          }

          snub
            .mono('http:' + reqObj.method + ':' + reqObj.path, reqObj)
            .replyAt((reply, error) => {
              if (!reply && error) {
                try {
                  response.statusCode = 500;
                  response.setHeader('Content-Type', 'application/json');
                  response.end(
                    JSON.stringify({
                      message: 'Server Error',
                    })
                  );
                } catch (error) {
                  // suppress this as there is a chance the delivered check as already run.
                }
                return;
              }
              if (!reply) reply = {};
              try {
                if (response.finished) return; // timeout probably already happened.
                reply.headers = Object.assign(
                  {},
                  config.headers,
                  reply.headers
                );
                Object.keys(reply.headers).forEach((i) => {
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
            .send((delivered) => {
              if (delivered > 0) return;
              response.statusCode = 404;
              response.setHeader('Content-Type', 'application/json');
              response.end(
                JSON.stringify({
                  message: 'Event handler not found',
                })
              );
            });

          setTimeout(() => {
            if (!response.finished) {
              response.statusCode = 504;
              response.setHeader('Content-Type', 'application/json');
              response.end(
                JSON.stringify({
                  message: 'Event handler timed out',
                })
              );
              console.warn('Snub-HTTP => Event handler timed out', reqObj);
            }
          }, config.timeout);
        });
    };

    const server = http.createServer(requestHandler);

    server.listen(config.port, (err) => {
      if (err) return console.error('Snub HTTP => something bad happened', err);
      if (config.debug) console.log(`Snub HTTP Listening on ${config.port}`);
    });
  };
};
