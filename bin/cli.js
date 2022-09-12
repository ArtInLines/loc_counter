#! /usr/bin/env node

const c = require('ansi-colors');
const arg = require('arg');
const fs = require('fs');
const { join, extname } = require('path');
const { cwd } = require('process');
const { count_loc } = require('../index');

// TODO: Use ansi-colors themes

const defaultCommentStyles = JSON.parse(fs.readFileSync(join(__dirname, 'commentStyles.json'), { encoding: 'utf-8' }));
const defaultExclude = JSON.parse(fs.readFileSync(join(__dirname, 'defaultExcludes.json'), { encoding: 'utf-8' }));

const spec = {
	'--help': Boolean,
	'-h': '--help',
	'-H': '--help',

	'--version': Boolean,

	'--verbose': arg.COUNT,
	'-v': '--verbose',
	'-V': '--verbose',

	'--file': [String],
	'-f': '--file',
	'-F': '--file',

	'--directory': [String],
	'-d': '--directory',
	'-D': '--directory',

	'--recursive': Boolean,
	'-r': '--recursive',
	'-R': '--recursive',

	'--include': [String],
	'-i': '--include',
	'-I': '--include',

	'--exclude': [String],
	'-x': '--exclude',
	'-X': '--exclude',

	'--type': [String],
	'-t': '--type',
	'-T': '--type',

	'--empty-lines': Boolean,
	'-l': '--empty-lines',
	'-L': '--empty-lines',

	'--comments': Boolean,
	'-c': '--comments',
	'-C': '--comments',

	'--comments-style': String,
	'-cs': '--comments-style',
	'-CS': '--comments-style',
};

const HELP_TEXT = `Sorry no help for you yet :(`;

(async function main() {
	let args = {};
	try {
		args = arg(spec);
	} catch (e) {
		console.log('An Error occured.');
		if (e.code === 'ARG_UNKNOWN_OPTION') {
			console.log('You supplied an unknown argument. Make sure you only supply known arguments and make sure you type the correct amount of dashes (- or --).');
		} else if (e.code === 'ARG_MISSING_REQUIRED_LONGARG') {
			console.log('You missed supplying some argument with any value. To supply a value, type ' + c.bgWhite.black.bold('--argument value') + '.');
		}
		console.log('\nIf you need more help, have a look at the help page again, by supplying ' + c.bgWhite.black.bold('--help') + ' as an argument (-h or -H works too).');
		return;
	}

	if (args['--help']) {
		console.log(HELP_TEXT);
		return;
	} else if (args['--version']) {
		let v = JSON.parse(fs.readFileSync('./package.json', { encoding: 'utf-8' }))?.version;
		if (!v)
			console.log(
				`An Error occured trying to retrieve the app's version number.\nThis probably happened because the "${c.italic(
					'package.json'
				)}" file associated with this app isn't in the same directory as this app's main file.`
			);
		else console.log(v);
		return;
	}

	let commentStyle = defaultCommentStyles;
	if (args['--comments-style']) {
		const errMessage = (fpath, exists = true) =>
			`An Error occured trying to ${exists ? 'parse' : 'read'} the file "${c.italic.grey(fpath)}".\nYou supplied the relative path to said file as the "${c.italic('comments-style')}" option.\n${
				exists ? 'Make sure that the file is a JSON-file, that follows the JSON-Syntax correctly' : "The file doesn't seem to exist"
			}.`;

		let fpath = args['--comments-style'];
		if (fs.existsSync(fpath)) {
			try {
				commentStyle = JSON.parse(fs.readFileSync(fpath, { encoding: 'utf-8' }));
			} catch (e) {
				console.log(errMessage(fpath));
			}
		} else {
			fpath = join(cwd(), args['--comments-style']);
			if (fs.existsSync(fpath)) {
				try {
					commentStyle = JSON.parse(fs.readFileSync(fpath, { encoding: 'utf-8' }));
				} catch (e) {
					console.log(errMessage(fpath));
				}
			} else console.log(errMessage(args['--comments-style'], false));
		}
	}

	const ensurePatterns = (arr) =>
		arr
			.map((str) => {
				if (extname(str).toLowerCase() === '.json') {
					let fpath = join(cwd(), str);
					if (fs.existsSync(fpath)) {
						return JSON.parse(fs.readFileSync(fpath, { encoding: 'utf-8' }));
					}
				}
				return str;
			})
			.flat(Infinity);

	let include = ensurePatterns(args['--include'] || []);
	let exclude = ensurePatterns(args['--exclude'] || []);

	// console.log(args, '\n\n');

	const res = await count_loc(
		args['--directory']
			? args['--directory'].map((d) => {
					if (d === '.' || d === './') return cwd();
					else return d;
			  })
			: args['--file']?.length || include.length
			? []
			: [cwd()],
		/* args['--file'] || */ [],
		include,
		exclude?.length ? exclude : defaultExclude,
		args['--recursive'] || false,
		args['--type'] || null,
		args['--empty-lines'] || false,
		args['--comments'] || false,
		commentStyle
	);

	// Print different output depending on verbosity level.
	let verbosity = args['--verbose'] || 0;
	if (res.dirs.length) console.log(c.bold.underline.cyan('\nDirectories:'));
	for (let dRes of res.dirs) {
		if (verbosity === 0) {
			console.log(c.bold.blue(dRes.name) + ': ' + c.italic.yellow(dRes.totalCount));
		} else if (verbosity === 1) {
			console.log(c.bold.blue(dRes.name) + ':');
			console.log(`\tTotal Count: ${c.italic.yellow(dRes.totalCount)}`);
			console.log(`\tNon-Recursive Count: ${c.italic.yellow(dRes.nonRecDirCount)}`);
		} else if (verbosity >= 2) {
			let f = (o) => `${c.italic.yellow(o.totalCount)} ${o.nonRecDirCount !== o.totalCount ? `(${c.italic.yellow(o.nonRecDirCount)})` : ''}`;

			console.log(`${c.bold.blue(dRes.name)}: ${f(dRes)}`);
			for (let d of Object.keys(dRes.dirCounts)) {
				// TODO:
				let indentation = 1;
				let s = '';
				for (let i = 0; i < indentation; i++) s += '\t';

				s += `${c.italic.bold.blue(d)}: ${f(dRes.dirCounts[d])}`;
				console.log(s);
			}
			for (let f of Object.keys(dRes.fileCounts)) {
				console.log(`\t${c.italic.green('File ' + f)}: ${c.italic.yellow(dRes.fileCounts[f])}`);
			}
		}
	}
	if (res.files.length) console.log(c.bold.underline.cyan('\nFiles: '));
	for (let fRes of res.files) {
		if (verbosity === 0 || verbosity) {
			console.log(c.bold.blue(fRes.name) + ': ' + c.italic.yellow(fRes.count));
		}
	}
})();
