var app = require('express')();

var assets = require('..');

var coffee = require('coffee-script');
function compile(code, next) {
    try {
        next(null, coffee.compile(code));
    } catch(e) { // compile error
        next(e);
    }
}

var uglify = require('uglify-js');
function minify(code, next) {
    try {
        next(null, uglify.minify(code, { fromString : true }).code);
    } catch (e) {
        next(e);
    }
}

app.get('/scripts.min.js', assets({
    src : [ __dirname + '/public' ],
    dest : function (path) { return __dirname + '/out/' + path; },
    force : true,
    pipeline : {
        prefilter : [ 'js', 'coffee' ],
        mapContent : function(content, file, next) {
            file.extname === '.coffee' ?
                compile(content, next) :
                next(null, content);
        },
        postReduceContent : minify
    }
}));

var appReadyCallback;
var ready = false;


var server = app.listen(161986, function() {
    ready = true;
    appReadyCallback && appReadyCallback();
});

var runner = jasmine.getEnv().currentRunner();
var oldFinish = runner.finishCallback;
runner.finishCallback = function () {
    server.close();
    return oldFinish.apply(this, arguments);
};

describe('the happy path', function() {
    it('does the scriptful', function(done) {
        require('http').get('http://localhost:161986/scripts.min.js', function(res) {
            expect(res).toBeTruthy();
            expect(res.statusCode).toBe(200);
            var d = '';
            res.on('data', function(data) { d += data; });
            res.on('end', function() {
                expect(d).toMatch('yepnope');
                expect(d).toMatch('.filter=');
                expect(d).not.toMatch('->');
                expect(d).not.toMatch('normalize.css');
                done();
            });
        }).on('error', done);
    });
});
