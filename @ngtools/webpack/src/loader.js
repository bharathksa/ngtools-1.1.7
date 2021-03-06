"use strict";
var path = require('path');
var ts = require('typescript');
var plugin_1 = require('./plugin');
var ast_tools_1 = require('@angular-cli/ast-tools');
// TODO: move all this to ast-tools.
function _findNodes(sourceFile, node, kind, keepGoing) {
    if (keepGoing === void 0) { keepGoing = false; }
    if (node.kind == kind && !keepGoing) {
        return [node];
    }
    return node.getChildren(sourceFile).reduce(function (result, n) {
        return result.concat(_findNodes(sourceFile, n, kind, keepGoing));
    }, node.kind == kind ? [node] : []);
}
function _removeDecorators(fileName, source) {
    var sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest);
    // Find all decorators.
    var decorators = _findNodes(sourceFile, sourceFile, ts.SyntaxKind.Decorator);
    decorators.sort(function (a, b) { return b.pos - a.pos; });
    decorators.forEach(function (d) {
        source = source.slice(0, d.pos) + source.slice(d.end);
    });
    return source;
}
function _replaceBootstrap(fileName, source, plugin) {
    // If bootstrapModule can't be found, bail out early.
    if (!source.match(/\bbootstrapModule\b/)) {
        return Promise.resolve(source);
    }
    var changes = new ast_tools_1.MultiChange();
    // Calculate the base path.
    var basePath = path.normalize(plugin.basePath);
    var genDir = path.normalize(plugin.genDir);
    var dirName = path.normalize(path.dirname(fileName));
    var entryModule = plugin.entryModule;
    var entryModuleFileName = path.normalize(entryModule.path + '.ngfactory');
    var relativeEntryModulePath = path.relative(basePath, entryModuleFileName);
    var fullEntryModulePath = path.resolve(genDir, relativeEntryModulePath);
    var relativeNgFactoryPath = path.relative(dirName, fullEntryModulePath);
    var ngFactoryPath = './' + relativeNgFactoryPath.replace(/\\/g, '/');
    var sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest);
    var allCalls = _findNodes(sourceFile, sourceFile, ts.SyntaxKind.CallExpression, true);
    var bootstraps = allCalls
        .filter(function (call) { return call.expression.kind == ts.SyntaxKind.PropertyAccessExpression; })
        .map(function (call) { return call.expression; })
        .filter(function (access) {
        return access.name.kind == ts.SyntaxKind.Identifier
            && access.name.text == 'bootstrapModule';
    });
    var calls = bootstraps
        .reduce(function (previous, access) {
        return previous.concat(_findNodes(sourceFile, access, ts.SyntaxKind.CallExpression, true));
    }, [])
        .filter(function (call) {
        return call.expression.kind == ts.SyntaxKind.Identifier
            && call.expression.text == 'platformBrowserDynamic';
    });
    if (calls.length == 0) {
        // Didn't find any dynamic bootstrapping going on.
        return Promise.resolve(source);
    }
    // Create the changes we need.
    allCalls
        .filter(function (call) { return bootstraps.some(function (bs) { return bs == call.expression; }); })
        .forEach(function (call) {
        changes.appendChange(new ast_tools_1.ReplaceChange(fileName, call.arguments[0].getStart(sourceFile), entryModule.className, entryModule.className + 'NgFactory'));
    });
    calls
        .forEach(function (call) {
        changes.appendChange(new ast_tools_1.ReplaceChange(fileName, call.getStart(sourceFile), 'platformBrowserDynamic', 'platformBrowser'));
    });
    bootstraps
        .forEach(function (bs) {
        // This changes the call.
        changes.appendChange(new ast_tools_1.ReplaceChange(fileName, bs.name.getStart(sourceFile), 'bootstrapModule', 'bootstrapModuleFactory'));
    });
    changes.appendChange(ast_tools_1.insertImport(fileName, 'platformBrowser', '@angular/platform-browser'));
    changes.appendChange(ast_tools_1.insertImport(fileName, entryModule.className + 'NgFactory', ngFactoryPath));
    var sourceText = source;
    return changes.apply({
        read: function (path) { return Promise.resolve(sourceText); },
        write: function (path, content) { return Promise.resolve(sourceText = content); }
    }).then(function () { return sourceText; });
}
function _transpile(plugin, fileName, sourceText) {
    var program = plugin.program;
    if (plugin.typeCheck) {
        var sourceFile = program.getSourceFile(fileName);
        var diagnostics = program.getSyntacticDiagnostics(sourceFile)
            .concat(program.getSemanticDiagnostics(sourceFile))
            .concat(program.getDeclarationDiagnostics(sourceFile));
        if (diagnostics.length > 0) {
            var message = diagnostics
                .map(function (diagnostic) {
                var _a = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start), line = _a.line, character = _a.character;
                var message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
                return diagnostic.file.fileName + " (" + (line + 1) + "," + (character + 1) + "): " + message + ")";
            })
                .join('\n');
            throw new Error(message);
        }
    }
    // Force a few compiler options to make sure we get the result we want.
    var compilerOptions = Object.assign({}, plugin.compilerOptions, {
        inlineSources: true,
        inlineSourceMap: false,
        sourceRoot: plugin.basePath
    });
    var result = ts.transpileModule(sourceText, { compilerOptions: compilerOptions, fileName: fileName });
    return {
        outputText: result.outputText,
        sourceMap: JSON.parse(result.sourceMapText)
    };
}
// Super simple TS transpiler loader for testing / isolated usage. does not type check!
function ngcLoader(source) {
    var _this = this;
    this.cacheable();
    var plugin = this._compilation._ngToolsWebpackPluginInstance;
    // We must verify that AotPlugin is an instance of the right class.
    if (plugin && plugin instanceof plugin_1.AotPlugin) {
        var cb_1 = this.async();
        Promise.resolve()
            .then(function () { return _removeDecorators(_this.resource, source); })
            .then(function (sourceText) { return _replaceBootstrap(_this.resource, sourceText, plugin); })
            .then(function (sourceText) {
            var result = _transpile(plugin, _this.resourcePath, sourceText);
            cb_1(null, result.outputText, result.sourceMap);
        })
            .catch(function (err) { return cb_1(err); });
    }
    else {
        return ts.transpileModule(source, {
            compilerOptions: {
                target: ts.ScriptTarget.ES5,
                module: ts.ModuleKind.ES2015,
            }
        }).outputText;
    }
}
exports.ngcLoader = ngcLoader;
//# sourceMappingURL=/Users/hansl/Sources/angular-cli/packages/webpack/src/loader.js.map