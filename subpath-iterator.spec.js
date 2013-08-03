/*globals jasmine:false, expect:false, describe:false, it:false, beforeEach:false,
  afterEach:false, spyOn:false*/

"use strict";

var fs = require('fs');
var path = require('path');

var subpathIterator = require('./subpath-iterator');

function returnTrue() { return true; }
function returnFalse() { return false; }

function mockStat(type) {
    return {
        isDirectory : type === 'dir' ? returnTrue : returnFalse,
        isFile : type === 'file' ? returnTrue : returnFalse
    };
}

describe('subpath-iterator', function() {
    var iterator;
    var callback;

    var customNext;
    var customStat;
    var customReaddir;


    var rootDirs = [ 'a', 'b', 'c' ];
    var stats = {
        a : mockStat('dir'),
        b : mockStat('dir'),
        c : mockStat('dir')
    };
    setNixAndWindows(stats, 'a/a1', mockStat('file'));
    setNixAndWindows(stats, 'a/a2', mockStat('file'));
    setNixAndWindows(stats, 'a/a3', mockStat('dir'));
    setNixAndWindows(stats, 'a/a3/a3-1', mockStat('file'));
    setNixAndWindows(stats, 'b/b1', mockStat('file'));

    var dirContents = {
        a : [ 'a1', 'a2', 'a3' ],
        b : [ 'b1' ],
        c : [  ]
    };
    setNixAndWindows(dirContents, 'a/a3', [ 'a3-1' ]);
    
    function setNixAndWindows(obj, path, val) {
        obj[path.replace(/\\/g, '/')] = val;
        obj[path.replace(/\//g, '\\')] = val;
    }
    
    beforeEach(function() {
        customNext = function() {};
        customStat = function(filepath, next) {
            next(
                stats[filepath] ? null : new Error(filepath + " doesn't exist"),
                stats[filepath]);
        };
        customReaddir = function(filepath, next) {
            next(
                dirContents[filepath] ? null : new Error(filepath + " doesn't exist"),
                dirContents[filepath]);
        };
        spyOn(fs, 'stat').andCallFake(function() {
            return customStat.apply(this, arguments);
        });
        spyOn(fs, 'readdir').andCallFake(function() {
            return customReaddir.apply(this, arguments);
        });

        iterator = subpathIterator(rootDirs);
        callback = jasmine.createSpy("callback").andCallFake(function(err, filepath, filestat) {
            customNext.apply(this, arguments);
        });
    });

    it('returns a function', function() {
        expect(typeof iterator).toBe('function');
    });

    it('the returned function calls its callback', function() {
        iterator(callback);
        expect(callback).toHaveBeenCalledWith(null, path.join('a','a1'), stats['a/a1']);
    });

    it('returns all subpaths', function() {
        iterator(callback);
        expect(callback).toHaveBeenCalledWith(
            null,
            path.join('a','a1'),
            stats['a/a1']);
        iterator(callback);
        expect(callback).toHaveBeenCalledWith(
            null,
            path.join('a','a2'),
            stats['a/a2']);
        iterator(callback);
        expect(callback).toHaveBeenCalledWith(
            null,
            path.join('a','a3', 'a3-1'),
            stats['a/a3/a3-1']);
        iterator(callback);
        expect(callback).toHaveBeenCalledWith(
            null,
            path.join('b','b1'),
            stats['b/b1']);
        iterator(callback);
        expect(callback).toHaveBeenCalledWith();
    });
});