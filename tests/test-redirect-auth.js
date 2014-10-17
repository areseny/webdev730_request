'use strict'

var server = require('./server')
  , request = require('../index')
  , util = require('util')
  , events = require('events')
  , tape = require('tape')

var s = server.createServer()
  , ss = server.createSSLServer()

// always send basic auth and allow non-strict SSL
request = request.defaults({
  auth : {
    user : 'test',
    pass : 'testing'
  },
  rejectUnauthorized : false
})

// redirect.from(proto, host).to(proto, host) returns an object with keys:
//   src : source URL
//   dst : destination URL
var redirect = {
  from : function(fromProto, fromHost) {
    return {
      to : function(toProto, toHost) {
        var fromPort = (fromProto === 'http' ? s.port : ss.port)
          , toPort = (toProto === 'http' ? s.port : ss.port)
        return {
          src : util.format(
            '%s://%s:%d/to/%s/%s',
            fromProto, fromHost, fromPort, toProto, toHost),
          dst : util.format(
            '%s://%s:%d/from/%s/%s',
            toProto, toHost, toPort, fromProto, fromHost)
        }
      }
    }
  }
}

function handleRequests(srv) {
  ['http', 'https'].forEach(function(proto) {
    ['localhost', '127.0.0.1'].forEach(function(host) {
      srv.on(util.format('/to/%s/%s', proto, host), function(req, res) {
        var r = redirect
          .from(srv.protocol, req.headers.host.split(':')[0])
          .to(proto, host)
        res.writeHead(301, {
          location : r.dst
        })
        res.end()
      })

      srv.on(util.format('/from/%s/%s', proto, host), function(req, res) {
        // Expect an authorization header unless we changed hosts
        var expectAuth = (host === req.headers.host.split(':')[0])
          , foundAuth = (req.headers.authorization === 'Basic dGVzdDp0ZXN0aW5n')

        if (expectAuth === foundAuth) {
          res.end('ok')
        } else {
          res.writeHead(400)
          res.end(util.format(
            'Expected %s but found: %s',
            (expectAuth ? 'auth' : 'no auth'),
            req.headers.authorization || '(nothing)'))
        }
      })
    })
  })
}

handleRequests(s)
handleRequests(ss)

tape('setup', function(t) {
  s.listen(s.port, function() {
    ss.listen(ss.port, function() {
      t.end()
    })
  })
})

tape('redirect URL helper', function(t) {
  t.deepEqual(
    redirect.from('http', 'localhost').to('https', '127.0.0.1'),
    {
      src : util.format('http://localhost:%d/to/https/127.0.0.1', s.port),
      dst : util.format('https://127.0.0.1:%d/from/http/localhost', ss.port)
    })
  t.deepEqual(
    redirect.from('https', 'localhost').to('http', 'localhost'),
    {
      src : util.format('https://localhost:%d/to/http/localhost', ss.port),
      dst : util.format('http://localhost:%d/from/https/localhost', s.port)
    })
  t.end()
})

function runTest(name, redir) {
  tape('redirect to ' + name, function(t) {
    request(redir.src, function(err, res, body) {
      t.equal(err, null)
      t.equal(res.request.uri.href, redir.dst)
      t.equal(body, 'ok')
      t.equal(res.statusCode, 200)
      t.end()
    })
  })
}

runTest('same host and protocol',
  redirect.from('http', 'localhost').to('http', 'localhost'))

runTest('same host different protocol',
  redirect.from('http', 'localhost').to('https', 'localhost'))

runTest('different host same protocol',
  redirect.from('https', '127.0.0.1').to('https', 'localhost'))

runTest('different host and protocol',
  redirect.from('http', 'localhost').to('https', '127.0.0.1'))

tape('cleanup', function(t) {
  s.close()
  ss.close()
  t.end()
})
