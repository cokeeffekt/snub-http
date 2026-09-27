const http = require('http');

// snub splits a listener name on its nsSeparator ('.' by default), so
// `snub.on('http:GET:/file.json')` listens on `/file`, not `/file.json`.
// A path holding a dot is therefore also emitted with its dots encoded, and
// this builds the matching name to listen on.
const eventName = (method, path) =>
  'http:' + String(method).toUpperCase() + ':' + encodeDots(path);
const encodeDots = (path) => String(path).replace(/\./g, '%2E');

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

  let handle = null;

  const middleware = function (snub) {
    const timers = new Set();

    const fail = (response, statusCode, message) => {
      if (response.writableEnded) return;
      try {
        response.statusCode = statusCode;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ message }));
      } catch (error) {
        // suppress this as there is a chance the response has already been sent.
      }
    };

    const parseUrl = (url) => {
      // origin-form is the only thing a client should send here, and it must
      // not be resolved against a base or `//host/path` is read as a host.
      if (url.startsWith('/')) return new URL('http://localhost' + url);
      return new URL(url);
    };

    const requestHandler = (request, response) => {
      if (request.method === 'OPTIONS') {
        response.writeHead(200, config.optionHeaders);
        return response.end();
      }

      let urlParsed;
      try {
        urlParsed = parseUrl(request.url);
      } catch (error) {
        return fail(response, 400, 'Bad Request');
      }

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

          try {
            reqObj = await config.requestMutator(reqObj);
          } catch (error) {
            console.error('Snub-HTTP => requestMutator failed', error);
            return fail(response, 500, 'Server Error');
          }

          if (!reqObj) return fail(response, 503, 'Event handler unavailable');

          const event = 'http:' + reqObj.method + ':' + reqObj.path;
          const events = [event];
          if (String(reqObj.path).includes('.'))
            events.push(eventName(reqObj.method, reqObj.path));

          const emit = () => {
            let abandoned = false;
            snub
              .mono(events.shift(), reqObj)
              .replyAt((reply, error) => {
                if (abandoned) return;
                if (!reply && error) return fail(response, 500, 'Server Error');
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
                abandoned = true;
                if (events.length && !response.writableEnded) return emit();
                fail(response, 404, 'Event handler not found');
              })
              .catch((error) => {
                console.error('Snub-HTTP => failed to emit', error);
                fail(response, 500, 'Server Error');
              });
          };
          emit();

          const timer = setTimeout(() => {
            timers.delete(timer);
            if (!response.finished) {
              fail(response, 504, 'Event handler timed out');
              console.warn('Snub-HTTP => Event handler timed out', reqObj);
            }
          }, config.timeout);
          timers.add(timer);
          response.on('close', () => {
            clearTimeout(timer);
            timers.delete(timer);
          });
        });
    };

    const server = http.createServer(requestHandler);

    const ready = new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, () => {
        server.off('error', reject);
        if (config.debug) console.log(`Snub HTTP Listening on ${config.port}`);
        resolve();
      });
    });
    // a failed listen is reported here, awaiting `ready` is optional
    ready.catch((error) => {
      console.error('Snub HTTP => something bad happened', error);
    });
    server.on('error', (error) => {
      if (server.listening)
        console.error('Snub HTTP => something bad happened', error);
    });

    let closing = null;
    const close = () => {
      if (closing) return closing;
      closing = new Promise((resolve) => {
        timers.forEach((timer) => clearTimeout(timer));
        timers.clear();
        if (!server.listening) return resolve();
        server.close(() => resolve());
        if (server.closeAllConnections) server.closeAllConnections();
      });
      return closing;
    };

    handle = { server, ready, close };
    return handle;
  };

  middleware.close = () => (handle ? handle.close() : Promise.resolve());
  return middleware;
};

module.exports.event = eventName;
