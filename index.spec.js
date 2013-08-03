/*globals jasmine:false, expect:false, describe:false, it:false, beforeEach:false, afterEach:false*/

"use strict";

var fs = require('fs');
var os = require('os');
var path = require('path');

var testDir = path.join(os.tmpDir(), 'asset-middleware-test');
var inDir = path.join(testDir, 'in');
var outDir = path.join(testDir, 'out');
var outFile = path.join(outDir, 'out');

var assetMiddleware = require('./index');

function setup() {
    teardown();

    fs.mkdirSync(testDir);
    fs.mkdirSync(inDir);
    fs.mkdirSync(outDir);
    fs.writeFileSync(path.join(inDir, 'a'), 'A', { encoding: 'utf8' });
    fs.writeFileSync(path.join(inDir, 'b'), 'B', { encoding: 'utf8' });
    fs.writeFileSync(path.join(inDir, 'c'), 'C', { encoding: 'utf8' });
}

function unlinkIfExists(file) {
    fs.existsSync(file) && fs.unlinkSync(file);
}
function rmIfExists(dir) {
    fs.existsSync(dir) && fs.rmdirSync(dir);
}

function teardown() {
    unlinkIfExists(path.join(inDir, 'a'));
    unlinkIfExists(path.join(inDir, 'b'));
    unlinkIfExists(path.join(inDir, 'c'));
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

describe('asset middleware', function() {
    beforeEach(setup);
    afterEach(teardown);

    it('provides sane defaults', function(done) {
        var once = makeOnce();
        test({
            logger : debugLogger,
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

    it('accepts a whole new pipeline', function(done) {
        var once = makeOnce();
        test({
            logger : debugLogger,
            src : inDir,
            dest : outFile,
            prefilter : function(filepath, next) {
                next(null, filepath.charAt(filepath.length - 1) !== 'a');
            },
            map : function(filepath, next) {
                fs.readFile(filepath, 'utf8', next);
            },
            filter : function(content, next) {
                next(null, content !== 'B');
            },
            reduceSeed : function(destpath, next) {
                next(null, { path : destpath, content : '' });
            },
            reduce : function(pathAndContent, str, next) {
                pathAndContent.content += str;
                next(null, pathAndContent);
            },
            postReduce : function(pathAndContent, next) {
                var path = pathAndContent.path;
                var content = pathAndContent.content;
                fs.writeFile(path, content, { encoding: 'utf8' }, next);
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
});