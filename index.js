"use strict";

var path = require('path');
var fs = require('fs');
var subpathIterator = require('./subpath-iterator');

function identitySync(a) { return a; }
function identity(a, next) { next(null, a); }

function extension(ext) {
    return function(filepath, next) {
        next(ext === path.extname(filepath));
    };
}

function createWriteStream(encoding) {
    return function(filepath, next) {
        try {
            next(null, fs.createWriteStream(filepath, { encoding : encoding }));
        } catch (e) {
            next(e);
        }
    };
}

function endWriteStream(writeStream, next) {
    if (writeStream && writeStream.end) {
        writeStream.end(null, null, next);
        return;
    }
    next();
}

function createReadStream(encoding) {
    return function(filepath, next) {
        try {
            var s = fs.createReadStream(filepath);
            s.setEncoding(encoding);
            next(null, s);
        } catch (e) {
            next(e);
        }
    };
}

function pipe(writeStream, readStream, next) {
    readStream.once('error', next);
    readStream.once('end', function() {
        next(null, writeStream);
    });
    readStream.pipe(writeStream, { end : false });
}

function normalizeSrc(src) {
    return typeof src === 'string' ? [ src ] : src;
}

function normalizeDest(dest) {
    return typeof dest === 'string' ? function() { return dest; } : dest;
}

function normalizeFilter(filter) {
    return typeof filter === 'string' ?
        extension(filter.charAt(0) == '.' ? filter : '.' + filter) :
        filter;
}

function logFilepaths(type, logger, paths) {
    if (logger && paths) {
        var joined = paths.join ? paths.join(', ') : paths;
        logger(type + ' (' + paths.length + '): ' + joined);
    }
}

function isOlder(filepath, otherFilepaths, filter, next) {
    fs.stat(filepath, function(err, fpStat) {
        if (err) {
            next(err);
            return;
        }
        var iterator = subpathIterator(otherFilepaths);
        iterator(function handleNext(err, filepath, otherStat) {
            if (err) {
                next(err);
                return;
            }
            if (!filepath) {
                next(null, false);
                return;
            }
            if (fpStat.mtime < otherStat.mtime) {
                filter(filepath, function(err, include) {
                    if (err) {
                        next(err);
                        return;
                    }
                    if (include) {
                        next(null, true);
                        return;
                    }
                    iterator(handleNext);
                });
                return;
            }
            iterator(handleNext);
        });
    });
}

function assets(options) {
    options = options || {};
    
    var logger = options.logger || null;
    var force = options.force || 'ifnewer';
    var src = normalizeSrc(options.src || './assets');
    var dest = normalizeDest(options.dest || identitySync);
    var prefix = options.prefix || '/';
    var encoding = options.encoding || null;
    var reduceSeed = options.reduceSeed || createWriteStream(encoding);
    var prefilter = normalizeFilter(options.prefilter || identity);
    var map = options.map || createReadStream(encoding);
    var filter = options.filter || identity;
    var reduce = options.reduce || function(ws, rs, next) { pipe(ws, rs, next); };
    var postReduce = options.postReduce || endWriteStream;

    var stripPrefix = prefix ? function(str) {
        if (str.substring(0, prefix.length) === prefix) {
            str = str.substring(prefix.length);
        }
        return str;
    } : identitySync;

    function middleware(req, res, next) {
        if (req.method !== 'GET') {
            next();
            return;
        }

        var pathname = req.path;
        logger && logger('Pathname: ' + pathname, "debug");

        var pathWithoutPrefix = stripPrefix(pathname);
        logger && logger('Stripped prefix: ' + pathWithoutPrefix, "debug");

        var destpath = dest(pathWithoutPrefix);
        logger && logger('Serves from file path: ' + destpath, "debug");

        if (!force || force === 'ifnewer') {
            logger && logger(!force ? 'Not forced.' : 'Force if newer sources exist.', "debug");
            fs.exists(destpath, function(exists) {
                if (!exists) {
                    logger && logger("File didn't exist", "debug");
                    getSources(generateAndServe);
                } else {
                    if (force === 'ifnewer') {
                        getSources(function(err, sources) {
                            if (err) {
                                next(err);
                                return;
                            }
                            checkOlderAndGenerateOrServe(sources);
                        });
                    } else {
                        logger && logger('Serve existing file.', "debug");
                        serveResource(null, destpath, res, next);
                    }
                }
            });
        } else {
            logger && logger('Forced.', "debug");
            getSources(generateAndServe);
        }

        function checkOlderAndGenerateOrServe(sources) {
            logger && logger("Checking if existing file is older than sources", "debug");
            isOlder(destpath, sources, prefilter, function(err, isOlder) {
                if (err) {
                    next(err);
                    return;
                }
                if (isOlder) {
                    logger && logger("Too old, regenerating", "debug");
                    generateAndServe(null, sources, next);
                } else {
                    logger && logger('Serve existing file.', "debug");
                    serveResource(null, destpath, res, next);
                }
            });
        }

        function getSources(next) {
            logger && logger("Getting sources", "debug");
            if (typeof src === 'function') {
                src(req, next);
            } else {
                next(null, src);
            }
        }

        function generateAndServe(err, sources) {
            if (err) {
                next(err);
                return;
            }
            generateResource(sources, destpath, function(err, fromPath) {
                serveResource(err, fromPath, res, next);
            });
        }
    }

    function generateResource(sources, destpath, next) {
        logger && logger("Generating output file", "debug");

        var writeStream;
        var anySources;

        reduceSeed(destpath, handleReduceSeed);

        function handleReduceSeed(err, ws) {
            writeStream = ws;

            if (err) {
                next(err);
                return;
            }

            handleSrcs(sources);
        }

        function handleSrcs(sourcePaths) {
            logger && logger('Source directories/files: ' + sourcePaths, "debug");

            var filepath;
            var readStream;

            var iterator = subpathIterator(sourcePaths);
            iterator(handleNext);


            function handleNext(err, fp) {
                filepath = fp;

                if (err) {
                    finalize(err);
                    return;
                }

                if (filepath == null) {
                    finalize();
                    return;
                }

                logger && logger('Beginning transformation pipeline for ' + filepath, "debug");

                logger && logger('Prefilter checking: ' + filepath, "debug");
                prefilter(filepath, handlePrefilter);
            }

            function handlePrefilter(err, include) {
                if (err) {
                    finalize(err);
                    return;
                }
                if (!include) {
                    logger && logger('Prefiltered: ' + filepath, "debug");
                    iterator(handleNext);
                    return;
                }
                logger && logger('Mapping: ' + filepath, "debug");
                map(filepath, handleMap);
            }

            function handleMap(err, rs) {
                readStream = rs;

                if (err) {
                    finalize(err);
                    return;
                }

                logger && logger('Filter checking: ' + filepath, "debug");
                filter(readStream, handleFilter);
            }

            function handleFilter(err, include) {
                if (err) {
                    finalize(err);
                    return;
                }
                if (!include) {
                    logger && logger('Filtered: ' + filepath);
                    iterator(handleNext);
                    return;
                }
                reduce(writeStream, readStream, handleReduce);
            }

            function handleReduce(err, ws) {
                if (err) {
                    finalize(err);
                    return;
                }

                anySources = true;
                
                logger && logger('Included: ' + filepath);

                writeStream = ws || writeStream;

                iterator(handleNext);
            }
        }

        function finalize(err) {
            logger && logger('Finished with files', "debug");

            if (err) {
                // don't wait for writeStream to close on an error
                // just gtfo
                writeStream && writeStream.end && writeStream.end();
                next(err);
                return;
            }

            logger && logger('Calling postReduce', "debug");
            postReduce(writeStream, function(err) {
                next(err, anySources && destpath);
            });
        }
    }

    function serveResource(err, fromPath, res, next) {
        logger && logger('Serving ' + fromPath, "debug");
        if (err) {
            next(err);
            return;
        }

        if (!fromPath) {
            // nothing to serve
            next();
            return;
        }

        createReadStream(encoding)(fromPath, function(err, readStream) {
            if (err) {
                next(err);
                return;
            }
            readStream.once('error', next);
            readStream.pipe(res);
        });
    }

    return middleware;
}

module.exports = assets;