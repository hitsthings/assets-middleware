/*globals jasmine:false, expect:false, describe:false, it:false, beforeEach:false, afterEach:false*/

"use strict";

var fs = require('fs');
var os = require('os');
var path = require('path');

var testDir = path.join(os.tmpDir(), 'asset-middleware-test');
var inDir = path.join(testDir, 'in');
var inSubDir = path.join(inDir, 'sub');
var outDir = path.join(testDir, 'out');
var outFile = path.join(outDir, 'out');

var assetMiddleware = require('./index');

function setup() {
    teardown();

    fs.mkdirSync(testDir);
    fs.mkdirSync(outDir);
    fs.mkdirSync(inDir);
    fs.mkdirSync(inSubDir);
    fs.writeFileSync(path.join(inDir, 'a.js'), 'A', { encoding: 'utf8' });
    fs.writeFileSync(path.join(inDir, 'b.css'), 'B', { encoding: 'utf8' });
    fs.writeFileSync(path.join(inDir, 'c.html'), 'C', { encoding: 'utf8' });
}

function unlinkIfExists(file) {
    fs.existsSync(file) && fs.unlinkSync(file);
}
function rmIfExists(dir) {
    fs.existsSync(dir) && fs.rmdirSync(dir);
}

function teardown() {
    unlinkIfExists(path.join(inDir, 'a.js'));
    unlinkIfExists(path.join(inDir, 'b.css'));
    unlinkIfExists(path.join(inDir, 'c.html'));
    rmIfExists(inSubDir);
    rmIfExists(inDir);

    unlinkIfExists(outFile);
    rmIfExists(outDir);
    
    rmIfExists(testDir);
}

function mockReq(method, url) {
    return {
        method : method,
        path : url
    };
}

function mockRes() {
    var ws = new (require('stream').Writable)();
    ws._data = '';
    ws._write = function(chunk, encoding, next) {
        ws._data += chunk;
        next();
    };
    return ws;
}

function test(options, req, next, onWriteEnd, errback) {
    setTimeout(function() {
        errback(new Error('Timed out'));
    }, 200);

    var res = mockRes();
    res.on('finish', function() {
        onWriteEnd(res._data);
    });

    assetMiddleware(options)(req, res, next);
}

function makeOnce() {
    var finished = false;
    return function (fn) {
        return function() {
            if (finished) return;
            finished = true;
            fn.apply(this, arguments);
        };
    };
}

function debugLogger(s,t) { console[t] ? console[t](s) : console.log(s); }
function infoLogger(s,t) { console[t] && console[t](s); }

describe('asset middleware', function() {
    beforeEach(setup);
    afterEach(teardown);

    it('provides sane defaults', function(done) {
        var once = makeOnce();
        test({
            logger : infoLogger,
            src : inDir,
            dest : outFile
        }, mockReq('GET', '/abc'), once(function next(err) {
            done(err || new Error("Shouldn't call next when successfully served"));
        }), once(function onResponseWriteEnd(written) {
            expect(written).toBe('ABC');
            done();
        }), once(function timeout(err) {
            done(err || new Error('Unexpected error occured'));
        }));
    });

    it('handles concurrent requests', function(done) {
        var waitingOn = 2;
        var once = makeOnce();
        test({
            logger : infoLogger,
            src : inDir,
            dest : outFile
        }, mockReq('GET', '/abc'), once(function next(err) {
            done(err || new Error("Shouldn't call next when successfully served"));
        }), function onResponseWriteEnd(written) {
            expect(written).toBe('ABC');
            if (--waitingOn) {
                serialRequest();
            }
        }, once(function timeout(err) {
            done(err || new Error('Unexpected error occured'));
        }));
        test({
            logger : infoLogger,
            src : inDir,
            dest : outFile
        }, mockReq('GET', '/abc'), once(function next(err) {
            done(err || new Error("Shouldn't call next when successfully served"));
        }), function onResponseWriteEnd(written) {
            expect(written).toBe('ABC');
            if (--waitingOn) {
                serialRequest();
            }
        }, once(function timeout(err) {
            done(err || new Error('Unexpected error occured'));
        }));

        function serialRequest() {
            test({
                logger : infoLogger,
                src : inDir,
                dest : outFile
            }, mockReq('GET', '/abc'), once(function next(err) {
                done(err || new Error("Shouldn't call next when successfully served"));
            }), once(function onResponseWriteEnd(written) {
                expect(written).toBe('ABC');
                done();
            }), once(function timeout(err) {
                done(err || new Error('Unexpected error occured'));
            }));
        }
    });

    it('accepts extension strings in prefilter', function(done) {
        var once = makeOnce();
        test({
            logger : infoLogger,
            src : inDir,
            dest : outFile,
            pipeline : {
                prefilter : 'js'
            }
        }, mockReq('GET', '/abc'), once(function next(err) {
            done(err || new Error("Shouldn't call next"));
        }), once(function onWriteEnd(written) {
            expect(written).toBe('A');
            done();
        }), once(function timeout(err) {
            done(err || new Error('Unexpected error occured'));
        }));
    });

    it('accepts string or stream from custom map steps', function(done) {
        var once = makeOnce();
        test({
            logger : infoLogger,
            src : inDir,
            dest : outFile,
            pipeline : {
                map : function(file, next) {
                    fs.readFile(file.path, 'utf8', next);
                }
            }
        }, mockReq('GET', '/abc'), once(function next(err) {
            done(err || new Error("Shouldn't call next"));
        }), once(function onWriteEnd(written) {
            expect(written).toBe('ABC');
            done();
        }), once(function timeout(err) {
            done(err || new Error('Unexpected error occured'));
        }));
    });

    it('offers mapContent and postReduceContent for string-based transforms', function(done) {
        var once = makeOnce();
        test({
            logger : infoLogger,
            src : inDir,
            dest : outFile,
            pipeline : {
                mapContent : function(content, file, next) {
                    next(null, content + ',' + path.basename(file.path) + ';');
                },
                postReduceContent : function(content, next) {
                    next(null, content + '!!!');
                }
            }
        }, mockReq('GET', '/abc'), once(function next(err) {
            done(err || new Error("Shouldn't call next"));
        }), once(function onWriteEnd(written) {
            expect(written).toBe('A,a.js;B,b.css;C,c.html;!!!');
            done();
        }), once(function timeout(err) {
            done(err || new Error('Unexpected error occured'));
        }));
    });

    it('makes mapContent optional for string-based transforms', function(done) {
        var once = makeOnce();
        test({
            logger : infoLogger,
            src : inDir,
            dest : outFile,
            pipeline : {
                postReduceContent : function(content, next) {
                    next(null, content + '!!!');
                }
            }
        }, mockReq('GET', '/abc'), once(function next(err) {
            done(err || new Error("Shouldn't call next"));
        }), once(function onWriteEnd(written) {
            expect(written).toBe('ABC!!!');
            done();
        }), once(function timeout(err) {
            done(err || new Error('Unexpected error occured'));
        }));
    });

    it('makes postReduceContent optional for string-based transforms', function(done) {
        var once = makeOnce();
        test({
            logger : infoLogger,
            src : inDir,
            dest : outFile,
            pipeline : {
                mapContent : function(content, file, next) {
                    next(null, content + ',' + path.basename(file.path) + ';');
                }
            }
        }, mockReq('GET', '/abc'), once(function next(err) {
            done(err || new Error("Shouldn't call next"));
        }), once(function onWriteEnd(written) {
            expect(written).toBe('A,a.js;B,b.css;C,c.html;');
            done();
        }), once(function timeout(err) {
            done(err || new Error('Unexpected error occured'));
        }));
    });

    it('accepts a whole new pipeline', function(done) {
        var once = makeOnce();
        test({
            logger : infoLogger,
            src : inDir,
            dest : outFile,
            pipeline : {
                prefilter : function(file, next) {
                    next(null, file.path.substring(file.path.length - 4) !== 'a.js');
                },
                map : function(file, next) {
                    fs.readFile(file.path, 'utf8', next);
                },
                filter : function(file, next) {
                    next(null, file.mapped !== 'B');
                },
                reduceSeed : function(destpath, next) {
                    next(null, { path : destpath, content : '' });
                },
                reduce : function(seed, file, next) {
                    seed.content += file.mapped;
                    next(null, seed);
                },
                postReduce : function(seed, next) {
                    var path = seed.path;
                    var content = seed.content;
                    fs.writeFile(path, content, { encoding: 'utf8' }, next);
                }
            }
        }, mockReq('GET', '/abc'), once(function next(err) {
            done(err || new Error("Shouldn't call next"));
        }), once(function onWriteEnd(written) {
            expect(written).toBe('C');
            done();
        }), once(function timeout(err) {
            done(err || new Error('Unexpected error occured'));
        }));
    });

    it("can't be used to read files outside the 'out' directory by default", function(done) {
        var once = makeOnce();
        expect(function() {
            test({
                logger : infoLogger,
                src : inSubDir,
                prefix : '/abc/def'
            }, mockReq('GET', '/abc/def/../../a'), once(function next(err) {
                done(err || new Error("Shouldn't call next"));
            }), once(function onWriteEnd(written) {
                expect(written).toBe('');
                done();
            }), once(function timeout(err) {
                done(err || new Error('Unexpected error occured'));
            }));
        }).toThrow();
        done();
    });
});