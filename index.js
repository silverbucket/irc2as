const events = require('events');
const debug = require('debug')('irc2as');

const EVENT_INCOMING = 'incoming',
      EVENT_ERROR = 'error',
      EVENT_PONG = 'pong',
      EVENT_PING = 'ping',
      EVENT_UNPROCESSED = 'unprocessed';

const ERR_BAD_NICK = "432",
      ERR_CHAN_PRIVS = "482",
      ERR_NICK_IN_USE = "433",
      ERR_TEMP_UNAVAIL = "437",
      ERR_NO_CHANNEL = "403",
      ERR_NOT_INVITED = "471",
      ERR_BADMODE= "472",
      ERR_INVITE_ONLY = "473",
      ERR_BANNED = "474",
      ERR_BADKEY = "475",
      ERR_BADMASK = "476",
      ERR_NOCHANMODES = "477",
      ERR_BANLISTFULL = "478",
      JOIN = "JOIN",
      MOTD = "372",
      MOTD_END = "376",
      NAMES = "353",
      NAMES_END = "366",
      NICK = "NICK",
      NOTICE = "NOTICE",
      PART = "PART",
      PING = "PING",
      PONG = "PONG",
      PRIVMSG = "PRIVMSG",
      QUIT = "QUIT",
      TOPIC_CHANGE = "TOPIC",
      TOPIC_IS = "332",
      TOPIC_SET_BY = "333",
      WHO = "352",
      WHO_OLD = "354",
      WHO_END = "315";

function IrcToActivityStreams(cfg) {
    const config = cfg || {};
    this.server = config.server;
    this.events = new events.EventEmitter();
    this.__buffer = {};
    this.__buffer[NAMES] = {};
    return this;
}

IrcToActivityStreams.prototype.input = function (string) {
    debug(string);
    if (typeof string !== 'string') {
        debug('unable to process incoming message as it was not a string.');
        return false;
    }
    if (string.length < 3) {
        debug('unable to process incoming string, length smaller than 3.');
        return false;
    }
    string = string.trim();
    const time = Date.now();
    const [metadata, content] = string.split(' :');
    const [server, code, pos1, pos2, pos3, ...msg] = metadata.split(" ");
    const channel = ((typeof pos1 === "string") && (pos1.startsWith('#'))) ? pos1 :
                    ((typeof pos2 === "string") && (pos2.startsWith('#'))) ? pos2 :
                    ((typeof pos3 === "string") && (pos3.startsWith('#'))) ? pos3 : undefined;
    let nick, type, message;

    if (metadata === PING) {
        this.events.emit(EVENT_PING, time);
        return true;
    }

    debug(`[${code}] server: ${server} channel: ${channel} 1: ${pos1}, 2: ${pos2}, 3: ${pos3}.` +
          ` content: `, content);
    switch (code) {
        /** */
        case ERR_CHAN_PRIVS:
        case ERR_NOT_INVITED:
        case ERR_BADMODE:
        case ERR_INVITE_ONLY:
        case ERR_BANNED:
        case ERR_BADKEY:
        case ERR_BADMASK:
        case ERR_NOCHANMODES:
        case ERR_BANLISTFULL:
        this.events.emit(EVENT_ERROR, {
            '@type': 'send',
            actor: {
              '@type': 'room',
              '@id': 'irc://' + this.server + '/' + channel
            },
            target: {
              '@type': 'person',
              '@id': 'irc://' + pos1 + '@' + this.server
            },
            object: {
              '@type': 'error',
              content: content
            }
        });
        break;

        /** */
        case ERR_NICK_IN_USE: // nick conflict
        case ERR_BAD_NICK:
        this.events.emit(EVENT_ERROR, {
            '@type': 'update',
            actor: {
                '@type': 'service',
                '@id': 'irc://' + this.server
            },
            object: {
                '@type': 'error',
                content: content
            },
            target: {
                '@type': 'person',
                '@id': 'irc://' + pos2 + '@' + this.server,
                displayName: pos2
            },
            published: time
        });
        break;

        /** */
        case ERR_NO_CHANNEL: // no such channel
        this.events.emit(EVENT_ERROR, {
            '@type': 'join',
            actor: {
                '@id': 'irc://' + this.server,
                '@type': 'service'
            },
            object: {
                '@type': 'error',
                content: 'no such channel ' + pos2
            },
            target: {
                '@id': 'irc://' + pos2 + '@' + this.server,
                '@type': 'person'
            },
            published: time
        });
        break;

        /** */
        case ERR_TEMP_UNAVAIL: // nick conflict
        this.events.emit(EVENT_ERROR, {
            '@type': 'update',
            actor: {
                '@type': 'service',
                '@id': 'irc://' + this.server
            },
            object: {
                '@type': 'error',
                content: content
            },
            target: {
                '@type': 'person',
                '@id': 'irc://' + pos2 + '@' + this.server,
                displayName: pos2
            },
            published: time
        });
        break;

        /** */
        case JOIN: // room join
        nick = server.split(/^:/)[1].split('!')[0];
        this.events.emit(EVENT_INCOMING, {
            '@type': 'join',
            actor: {
                '@type': 'person',
                '@id': 'irc://' + nick + '@' + this.server,
                displayName: nick
            },
            target: {
                '@type': 'room',
                '@id': 'irc://' + this.server + '/' + channel,
                displayName: channel
            },
            object: {},
            published: time
        });
        break;

        /** */
        case MOTD: // MOTD
        if (! this.__buffer[MOTD]) {
            this.__buffer[MOTD] = {
                '@type': 'update',
                actor: {
                    '@type': 'service',
                    '@id': 'irc://' + this.server,
                    displayName: this.server
                },
                object: {
                    '@type': 'topic',
                    content: [ content ]
                },
                published: time
            }
        } else {
            this.__buffer[MOTD].object.content.push(content);
        }
        break;
        case MOTD_END: // end of MOTD
        if (! this.__buffer[MOTD]) { break; }
        this.events.emit(EVENT_INCOMING, this.__buffer[MOTD]);
        delete this.__buffer[MOTD];
        break;

        /** */
        case NAMES:  // user list
        if (! this.__buffer[NAMES][channel]) {
            this.__buffer[NAMES][channel] = {
                '@type': 'observe',
                actor: {
                    '@type': 'room',
                    '@id': 'irc://' + this.server + '/' + channel,
                    displayName: channel
                },
                object: {
                    '@type': 'attendance',
                    members: content.split(' ')
                },
                published: time
            };
        } else {
            this.__buffer[NAMES][channel].object.members = this.__buffer[NAMES][channel].object.members.concat(content.split(' '));
        }
        break;
        case NAMES_END: // end user list
        if (! this.__buffer[NAMES][channel]) { break; }
        this.events.emit(EVENT_INCOMING, this.__buffer[NAMES][channel]);
        delete this.__buffer[NAMES][channel];
        break;

        /** */
        case NICK: // nick change
        nick = server.split(/^:/)[1].split('!')[0];
        this.events.emit(EVENT_INCOMING, {
            '@type': 'update',
            actor: {
                '@type': 'person',
                '@id': 'irc://' + nick + '@' + this.server,
                displayName: nick
            },
            target: {
                '@type': 'person',
                '@id': 'irc://' + content + '@' + this.server,
                displayName: content
            },
            object: {
                '@type': 'address'
            },
            published: time
        });
        break;

        /** */
        case NOTICE: // notice
        this.events.emit(EVENT_INCOMING, {
            '@type': 'update',
            actor: {
                '@type': 'service',
                '@id': 'irc://' + this.server
            },
            object: {
                '@type': 'error',
                content: content
            },
            target: {
                '@type': 'person',
                '@id': 'irc://' + pos1 + '@' + this.server,
                displayName: pos1
            },
            published: time
        });
        break;

        /** */
        case PART: // leaving
        nick = server.split(/^:/)[1].split('!')[0];
        this.events.emit(EVENT_INCOMING, {
            '@type': 'leave',
            actor: {
                '@type': 'person',
                '@id': 'irc://' + nick + '@' + this.server,
                displayName: nick
            },
            target: {
                '@type': 'room',
                '@id': 'irc://' + this.server + '/' + channel,
                displayName: channel
            },
            object: {
                '@type': 'message',
                content: 'user has left the channel'
            },
            published: time
        });
        break;

        /** */
        case PONG: // ping response received
        this.events.emit(EVENT_PONG, time);
        break;

        /** */
        case PRIVMSG: // msg
        nick = server.split(/^:/)[1].split('!')[0];
        if (content.startsWith('+\u0001ACTION ')) {
            type = 'me';
            message = content.split(/^\+\u0001ACTION\s+/)[1].split(/\u0001$/)[0];
        } else {
            type = 'message';
            message = content;
        }

        this.events.emit(EVENT_INCOMING, {
            '@type': 'send',
            actor: {
              '@type': 'person',
              '@id': 'irc://' + nick + '@' + this.server,
              displayName: nick
            },
            target: {
              displayName: pos1
            },
            object: {
              '@type': type,
              content: message
            },
            published: time
        });
        break;

        /** */
        case QUIT: // quit user
        nick = server.split(/^:/)[1].split('!')[0];
        this.events.emit(EVENT_INCOMING, {
            '@type': 'leave',
            actor: {
                '@type': 'person',
                '@id': 'irc://' + nick + '@' + this.server,
                displayName: nick
            },
            target: {
                '@type': 'service',
                '@id': 'irc://' + this.server
            },
            object: {
                '@type': 'message',
                content: 'user has quit'
            },
            published: time
        });
        break;

        /** */
        case TOPIC_CHANGE: // topic changed now
        nick = server.split(/^:/)[1].split('!')[0];
        this.events.emit(EVENT_INCOMING, {
            '@type': 'update',
            actor: {
                '@type': 'person',
                '@id': 'irc://' + nick + '@' + this.server,
                displayName: nick
            },
            target: {
                '@type': 'room',
                '@id': 'irc://' + this.server + '/' + channel,
                displayName: channel
            },
            object: {
                '@type': 'topic',
                topic: content
            },
            published: time
        });
        break;

        /** */
        case TOPIC_IS: // topic currently set to
        this.__buffer[TOPIC_IS] = {
            '@type': 'update',
            actor: undefined,
            target: {
                '@type': 'room',
                '@id': 'irc://' + this.server + '/' + channel,
                displayName: channel
            },
            object: {
                '@type': 'topic',
                topic: content
            }
        };
        break;
        case TOPIC_SET_BY: // current topic set by
        if (! this.__buffer[TOPIC_IS]) { break; }
        nick = pos3.split('!')[0];
        this.__buffer[TOPIC_IS].actor = {
            '@type': 'person',
            '@id': 'irc://' + nick + '@' + this.server,
            displayName: nick
        };
        this.__buffer[TOPIC_IS].published = msg[0];
        this.events.emit(EVENT_INCOMING, this.__buffer[TOPIC_IS]);
        delete this.__buffer[TOPIC_IS];
        break;

        /** */
        case WHO:
        case WHO_OLD:
        nick = (msg[3].length <= 2) ? msg[2] : msg[3];
        if (nick === 'undefined') { break; }
        if (! this.__buffer[WHO]) {
            this.__buffer[WHO] = {
                '@type': 'observe',
                object: {
                    '@type': 'attendance',
                    members: [ nick ]
                },
                published: time
            };
        } else {
            this.__buffer[WHO].object.members.push(nick);
        }
        break;
        case WHO_END:
        if (! this.__buffer[WHO]) { break; }
        if (!channel) {
            this.__buffer[WHO].actor = {
                '@type': 'person',
                '@id': 'irc://' + pos2 + '@' + this.server,
                displayName: pos2
            };
        } else {
            this.__buffer[WHO].actor = {
                '@type': 'room',
                '@id': 'irc://' + this.server + '/' + channel,
                displayName: channel
            };
        }
        this.events.emit(EVENT_INCOMING, this.__buffer[WHO]);
        delete this.__buffer[WHO];
        break;

        /** */
        default:
        this.events.emit(EVENT_UNPROCESSED, string);
        break;
    }
};

module.exports = IrcToActivityStreams;