const fs = require('fs');
const path = require('path');
const readline = require('readline');
const glob = require('glob');

const GLOB_OPTS = { nocase: true };

function isDirPattern(str) {
	return str.endsWith('/');
}

function ensureRecursivePattern(pattern) {
	if (pattern.startsWith('**/')) return pattern;
	else return '**/' + pattern;
}

/**
 * Splits by / and if that didn't split the string, splits it by \ instead. This way the splitting should hopefully work for both windows and mac.
 * @param {String} str
 * @returns {String[]}
 */
function mySplit(str) {
	let res = str.split('/');
	if (res.length === 1) res = str.split('\\');
	if (!res[0]) res = res.slice(1);
	return res.map((s) => s.trim()).filter((s) => s !== '');
}

/**
 * Check whether the two patterns match. For example
 * @param {String} fpath
 * @param {String[] | String} toExclude
 */
function isPathExcluded(fpath, toExclude) {
	if (!Array.isArray(toExclude)) toExclude = [toExclude];
	for (let pattern of toExclude) {
		if (isDirPattern(pattern)) {
			let dirs = mySplit(pattern);
			let splitFPath = mySplit(fpath);
			let idx = splitFPath.findIndex((s) => s === dirs[0]);
			if (idx !== -1) {
				let matched = true;
				for (let i = 1; i < dirs.length; i++) {
					if (splitFPath[idx + i] !== dirs[i]) {
						matched = false;
						break;
					}
				}
				if (matched) return true;
			}
		} else {
			if (fpath.endsWith(pattern)) return true;
		}
	}
	return false;
}

function countLine(line, lineComments = [], blockComments = [], inBlockComment = false, excludeComments = lineComments.length + blockComments.length > 0, excludeEmptyLines = true) {
	let l = line.trim();
	if (excludeEmptyLines && l === '') return [false, inBlockComment];
	if (excludeComments) {
		for (let c of lineComments) {
			if (l.startsWith(c)) return [false, inBlockComment];
		}
		let res = true;
		for (let c of blockComments) {
			if (l.startsWith(c[0])) {
				res = false;
				inBlockComment = true;
			}
			if (inBlockComment && l.endsWith(c[1])) {
				res = false;
				inBlockComment = false;
			}

			if (!res) return [res, inBlockComment];
		}
	}
	return [true, inBlockComment];
}

async function count_loc_of_file(filepath, commentStyles = null, excludeComments = commentStyles !== null, excludeEmptyLines = true) {
	let ext = path.extname(filepath);
	let cstyles = commentStyles?.default;
	if (excludeComments && ext !== '') {
		let s = commentStyles.extensions.find((s) => s[0].includes(ext.slice(1)));
		if (s) cstyles = s[1];
	}
	let lineComment = [];
	let blockComment = [];
	if (cstyles !== null) {
		if (!Array.isArray(cstyles)) lineComment = [cstyles];
		else {
			lineComment = cstyles.filter((c) => !Array.isArray(c));
			blockComment = cstyles.filter((c) => Array.isArray(c));
		}
	}
	cstyles = null; // Free memory

	const rs = fs.createReadStream(filepath);
	const rl = readline.createInterface({
		input: rs,
		crlfDelay: Infinity,
		// Note: we use the crlfDelay option to recognize all instances of CR LF ('\r\n') in input.txt as a single line break.
	});

	let inCommentBlock = false;
	let lineCount = 0;
	for await (const line of rl) {
		let r = countLine(line, lineComment, blockComment, inCommentBlock, excludeComments, excludeEmptyLines);
		if (r[0]) lineCount++;
		inCommentBlock = r[1];
	}
	return lineCount;
}

async function count_loc_of_dir(dirpath, toExclude, recursive, fileTypes = null, commentStyles = null, excludeComments = commentStyles !== null, excludeEmptyLines = true) {
	let dir = fs.readdirSync(dirpath, { withFileTypes: true });
	let files = dir.filter((dirent) => dirent.isFile());
	if (fileTypes !== null) {
		if (!Array.isArray(fileTypes)) fileTypes = [fileTypes];
		files = files.filter((f) => fileTypes.includes(path.extname(f.name).slice(1)));
	}

	let fileCounts = {};
	let dirCounts = {};

	let totalCount = 0;
	for await (const f of files) {
		let fpath = path.join(dirpath, f.name);
		if (!isPathExcluded(fpath, toExclude)) {
			let c = await count_loc_of_file(fpath, commentStyles, excludeComments, excludeEmptyLines);
			fileCounts[f.name] = c;
			totalCount += c;
		}
	}
	let nonRecDirCount = totalCount;

	if (recursive) {
		const subdirs = dir.filter((dirent) => dirent.isDirectory());
		for await (const d of subdirs) {
			let dpath = path.join(dirpath, d.name);
			if (!isPathExcluded(dpath, toExclude)) {
				let r = await count_loc_of_dir(dpath, toExclude, recursive, fileTypes, commentStyles, excludeComments, excludeEmptyLines);

				dirCounts[d.name] = { totalCount: r.totalCount, nonRecDirCount: r.nonRecDirCount, children: [], name: d.name };
				for (let k of Object.keys(r.dirCounts)) {
					if (!dirCounts[d.name]) dirCounts[d.name] = { totalCount: 0 };
					dirCounts[d.name][k] = { totalCount: r.dirCounts[k].totalCount };
					dirCounts[d.name].children.push(k);
				}
				for (let k of Object.keys(r.fileCounts)) {
					fileCounts[d.name + '/' + k] = r.fileCounts[k];
				}
				totalCount += r.totalCount;
			}
		}
	}
	let getName = (dirpath) => {
		let d = dirpath.split('/');
		d = d.pop() || d.pop();
		d = d.split('\\');
		d = d.pop() || d.pop();
		return d + '/';
	};
	return { totalCount, nonRecDirCount, fileCounts, dirCounts, name: getName(dirpath) };
}

async function count_loc(dirs, files, include, exclude, recursive, filetypes, excludeEmptyLines, excludeComments, commentStyles) {
	// console.log({ dirs, files, include, exclude, recursive, filetypes, excludeEmptyLines, excludeComments, commentStyles });
	let dirRes = [];
	let fileRes = [];
	let toInclude = [];
	let toExclude = [];

	if (recursive) {
		include = include.map((p) => ensureRecursivePattern(p));
		exclude = exclude.map((p) => ensureRecursivePattern(p));
	}

	for (let pattern of exclude) {
		let matches = glob.sync(pattern, GLOB_OPTS);
		toExclude.push(...matches);
	}

	if (include.length) {
		for (let pattern of include) {
			let matches = glob.sync(pattern, GLOB_OPTS);
			toInclude.push(...matches);
		}

		for (let pattern of toInclude) {
			if (isDirPattern(pattern) && !isPathExcluded(pattern, dirs)) {
				dirs.push(pattern);
			} else if (!isPathExcluded(pattern, files)) {
				files.push(pattern);
			}
		}
	}

	for await (let d of dirs) {
		dirRes.push(await count_loc_of_dir(d, toExclude, recursive, filetypes, commentStyles, excludeComments, excludeEmptyLines));
	}
	for await (let f of files) {
		if (!isPathExcluded(f, toExclude)) {
			fileRes.push({
				name: path.basename(f),
				count: await count_loc_of_file(f, commentStyles, excludeComments, excludeEmptyLines),
			});
		}
	}

	let res = { dirs: dirRes, files: fileRes };
	// console.log(res);
	return res;
}

module.exports = { count_loc_of_dir, count_loc_of_file, count_loc };
