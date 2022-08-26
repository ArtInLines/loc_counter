const fs = require('fs');
const path = require('path');
const readline = require('readline');

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

async function count_loc_of_dir(dirpath, exclude = [], include = [], recursive = true, fileTypes = null, commentStyles = null, excludeComments = commentStyles !== null, excludeEmptyLines = true) {
	// TODO: Use "exclude" and "include" variables

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
		let c = await count_loc_of_file(path.join(dirpath, f.name), commentStyles, excludeComments, excludeEmptyLines);
		fileCounts[f.name] = c;
		totalCount += c;
	}
	let nonRecDirCount = totalCount;

	if (recursive) {
		const subdirs = dir.filter((dirent) => dirent.isDirectory());
		for await (const d of subdirs) {
			let r = await count_loc_of_dir(path.join(dirpath, d.name), exclude, include, recursive, fileTypes, commentStyles, excludeComments, excludeEmptyLines);

			dirCounts[d.name] = { totalCount: r.totalCount, nonRecDirCount: r.nonRecDirCount };
			for (let k of Object.keys(r.dirCounts)) {
				dirCounts[d.name + '/' + k] = r.dirCounts[k];
			}
			for (let k of Object.keys(r.fileCounts)) {
				fileCounts[d.name + '/' + k] = r.fileCounts[k];
			}
			totalCount += r.totalCount;
		}
	}
	return { totalCount, nonRecDirCount, fileCounts, dirCounts, name: dirpath.split('/').at(-1).split('\\').at(-1) };
}

async function count_loc(dirs, files, include, exclude, recursive, filetypes, excludeEmptyLines, excludeComments, commentStyles) {
	// console.log({ dirs, files, include, exclude, recursive, filetypes, excludeEmptyLines, excludeComments, commentStyles });

	let dirRes = [];
	let fileRes = [];
	for await (let d of dirs) {
		dirRes.push(await count_loc_of_dir(d, exclude, include, recursive, filetypes, commentStyles, excludeComments, excludeEmptyLines));
	}
	for await (let f of files) {
		fileRes.push({
			name: path.basename(f),
			count: await count_loc_of_file(f, commentStyles, excludeComments, excludeEmptyLines),
		});
	}

	let res = { dirs: dirRes, files: fileRes };
	// console.log(res);
	return res;
}

module.exports = { count_loc_of_dir, count_loc_of_file, count_loc };
