#!/usr/bin/env node
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import express, { static as expressStatic } from "express";
import basicAuth from 'express-basic-auth';
import { join } from "path";
import { every } from "lodash";
import moment from "moment";
import { parse, error, info, debug } from 'cli';

const config = parse({
  'smtp-port': ['s', 'SMTP port to listen on', 'number', 1025],
  'smtp-ip': [false, 'IP Address to bind SMTP service to', 'ip', '0.0.0.0'],
  'http-port': ['h', 'HTTP port to listen on', 'number', 1080],
  'http-ip': [false, 'IP Address to bind HTTP service to', 'ip', '0.0.0.0'],
  whitelist: ['w', 'Only accept e-mails from these adresses. Accepts multiple e-mails comma-separated', 'string'],
  max: ['m', 'Max number of e-mails to keep', 'number', 100],
  auth: ['a', 'Enable Authentication', 'string'],
  headers: [false, 'Enable headers in responses']
});

const whitelist = config.whitelist ? config.whitelist.split(',') : [];

let users = null;
if (config.auth && !/.+:.+/.test(config.auth)) {
    error("Please provide authentication details in USERNAME:PASSWORD format");
    console.log(process.exit(1))
}
if (config.auth) {
  let authConfig = config.auth.split(":");
  users = {};
  users[authConfig[0]] = authConfig[1];
}

const mails = [];

const server = new SMTPServer({
  authOptional: true,
  maxAllowedUnauthenticatedCommands: 1000,
  onMailFrom(address, session, cb) {
    if (whitelist.length == 0 || whitelist.indexOf(address.address) !== -1) {
      cb();
    } else {
      cb(new Error('Invalid email from: ' + address.address));
    }
  },
  onAuth(auth, session, callback) {
    info('SMTP login for user: ' + auth.username);
    callback(null, {
      user: auth.username
    });
  },
  onData(stream, session, callback) {
    parseEmail(stream).then(
      mail => {
        debug(JSON.stringify(mail, null, 2));

        mails.unshift(mail);

        //trim list of emails if necessary
        while (mails.length > config.max) {
          mails.pop();
        }

        callback();
      },
      callback
    );
  }
});

function formatHeaders(headers) {
  const result = {};
  for (const [key, value] of headers) {
    result[key] = value;
  }
  return result;
}

function parseEmail(stream) {
  return simpleParser(stream).then(email => {
    if (config.headers) {
      email.headers = formatHeaders(email.headers);
    } else {
      delete email.headers;
    }
    return email;
  });
}

server.on('error', err => {
  console.error(err)
  error(err);
});

server.listen(config['smtp-port'], config['smtp-ip']);

const app = express();

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

if (users) {
    app.use(basicAuth({
        users: users,
        challenge: true
    }));
}

const buildDir = join(__dirname, 'build');

app.use(expressStatic(buildDir));

function emailFilter(filter) {
  return email => {
    if (filter.since || filter.until) {
      const date = moment(email.date);
      if (filter.since && date.isBefore(filter.since)) {
        return false;
      }
      if (filter.until && date.isAfter(filter.until)) {
        return false;
      }
    }

    if (filter.to && every(email.to.value, to => to.address !== filter.to)) {
      return false;
    }

    if (filter.from && every(email.from.value, from => from.address !== filter.from)) {
      return false;
    }

    return true;
  }
}

app.get('/api/emails', (req, res) => {
  res.json(mails.filter(emailFilter(req.query)));
});

app.delete('/api/emails', (req, res) => {
    mails.length = 0;
    res.send();
});

app.listen(config['http-port'], config['http-ip'], () => {
  info("HTTP server listening on http://" + config['http-ip'] +  ":" + config['http-port']);
});

info("SMTP server listening on " + config['smtp-ip'] + ":" + config['smtp-port']);
