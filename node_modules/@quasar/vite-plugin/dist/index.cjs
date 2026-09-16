Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let node_fs = require("node:fs");
let node_path = require("node:path");
let node_module = require("node:module");
let vite = require("vite");
//#region src/quasar-path.js
const require$1 = (0, node_module.createRequire)(require("url").pathToFileURL(__filename).href);
const quasarPath = (0, node_path.dirname)(require$1.resolve("quasar/package.json"));
//#endregion
//#region src/vite-config.js
const { version } = JSON.parse((0, node_fs.readFileSync)((0, node_path.join)(quasarPath, "package.json"), "utf8"));
function getViteConfig(runMode, viteMode, externalViteCfg) {
	const viteCfg = {
		define: {
			__QUASAR_VERSION__: `'${version}'`,
			__QUASAR_SSR__: false,
			__QUASAR_SSR_SERVER__: false,
			__QUASAR_SSR_CLIENT__: false
		},
		css: { preprocessorOptions: {
			sass: {
				api: "modern-compiler",
				silenceDeprecations: ["import", "global-builtin"]
			},
			scss: {
				api: "modern-compiler",
				silenceDeprecations: ["import", "global-builtin"]
			}
		} }
	};
	if (!externalViteCfg.define || externalViteCfg.define.__QUASAR_SSR_PWA__ === void 0) viteCfg.define.__QUASAR_SSR_PWA__ = false;
	if (runMode === "ssr-server") Object.assign(viteCfg.define, {
		__QUASAR_SSR__: true,
		__QUASAR_SSR_SERVER__: true
	});
	else {
		if (viteMode !== "production") viteCfg.resolve = { alias: [{
			find: /^quasar$/,
			replacement: "quasar/dist/quasar.client.js"
		}] };
		else viteCfg.optimizeDeps = { exclude: ["quasar"] };
		if (runMode === "ssr-client") Object.assign(viteCfg.define, {
			__QUASAR_SSR__: true,
			__QUASAR_SSR_CLIENT__: true
		});
	}
	return viteCfg;
}
//#endregion
//#region src/js-transform.js
let quasarImportMap;
function loadQuasarImportMap() {
	if (quasarImportMap !== void 0) return;
	try {
		quasarImportMap = JSON.parse((0, node_fs.readFileSync)((0, node_path.join)(quasarPath, "dist/transforms/import-map.json"), "utf8"));
	} catch (err) {
		throw new Error("Failed to load Quasar import map", { cause: err });
	}
}
const importQuasarRegex = /import\s*\{([\w,\s]+)\}\s*from\s*(['"])quasar\2;?/g;
function importTransformation(importName) {
	const file = quasarImportMap[importName];
	if (file === void 0) throw new Error("Unknown import from Quasar: " + importName);
	return "quasar/" + file;
}
/**
* Transforms JS code where importing from 'quasar' package
* Example:
*       import { QBtn } from 'quasar'
*    -> import QBtn from 'quasar/src/components/QBtn.js'
*/
function mapQuasarImports(code, importMap = {}) {
	return code.replace(importQuasarRegex, (_, match) => match.split(",").map((identifier) => {
		const data = identifier.split(" as ");
		const importName = data[0].trim();
		if (importName === "") return "";
		const importAs = data[1] !== void 0 ? data[1].trim() : importName;
		importMap[importName] = importAs;
		return `import ${importAs} from '${importTransformation(importName)}';`;
	}).join(""));
}
/**
* Transforms JS code where importing from 'quasar' package
* Example:
*       import { QBtn } from 'quasar'
*    -> add to importMap & importList & remove original import statement
*    (removing original is required so that the end file will have
*     only one import from Quasar statement)
*/
function removeQuasarImports(code, importMap, importSet, reverseMap) {
	return code.replace(importQuasarRegex, (_, match) => {
		match.split(",").forEach((identifier) => {
			const data = identifier.split(" as ");
			const importName = data[0].trim();
			if (importName !== "") {
				const importAs = data[1] !== void 0 ? data[1].trim() : importName;
				importSet.add(importName + (importAs !== importName ? ` as ${importAs}` : ""));
				importMap[importName] = importAs;
				reverseMap[importName.replaceAll("-", "_")] = importAs;
			}
		});
		return "";
	});
}
//#endregion
//#region src/vue-transform.js
let transformState;
function useTransformState() {
	if (transformState !== void 0) return transformState;
	const autoImportData = JSON.parse((0, node_fs.readFileSync)((0, node_path.join)(quasarPath, "dist/transforms/auto-import.json"), "utf8"));
	transformState = {
		autoImportData,
		compRegex: {
			kebab: new RegExp(`_resolveComponent\\("${autoImportData.regex.kebabComponents}"\\)`, "g"),
			pascal: new RegExp(`_resolveComponent\\("${autoImportData.regex.pascalComponents}"\\)`, "g"),
			combined: new RegExp(`_resolveComponent\\("${autoImportData.regex.components}"\\)`, "g")
		},
		dirRegex: new RegExp(`_resolveDirective\\("${autoImportData.regex.directives.replaceAll("v-", "")}"\\)`, "g")
	};
	return transformState;
}
const lengthSortFn = (a, b) => b.length - a.length;
function vueTransform(content, autoImportComponentCase, useTreeshaking) {
	const { autoImportData, compRegex, dirRegex } = useTransformState();
	const importSet = /* @__PURE__ */ new Set();
	const importMap = {};
	const compList = [];
	const dirList = [];
	const reverseMap = {};
	let code = (useTreeshaking ? mapQuasarImports(content, importMap) : removeQuasarImports(content, importMap, importSet, reverseMap)).replace(compRegex[autoImportComponentCase], (_, match) => {
		const name = autoImportData.importName[match];
		const reverseName = match.replaceAll("-", "_");
		if (importMap[name] === void 0) {
			importSet.add(name);
			reverseMap[reverseName] = name;
		} else reverseMap[reverseName] = importMap[name];
		compList.push(reverseName);
		return "";
	}).replace(dirRegex, (_, match) => {
		const name = autoImportData.importName["v-" + match];
		const reverseName = match.replaceAll("-", "_");
		if (importMap[name] === void 0) {
			importSet.add(name);
			reverseMap[reverseName] = name;
		} else reverseMap[reverseName] = importMap[name];
		dirList.push(reverseName);
		return "";
	});
	if (compList.length !== 0) {
		const list = compList.sort(lengthSortFn).join("|");
		code = code.replaceAll(new RegExp(`const _component_(${list}) = `, "g"), "").replaceAll(new RegExp(`_component_(${list})`, "g"), (_, match) => reverseMap[match]);
	}
	if (dirList.length !== 0) {
		const list = dirList.sort(lengthSortFn).join("|");
		code = code.replaceAll(new RegExp(`const _directive_(${list}) = `, "g"), "").replaceAll(new RegExp(`_directive_(${list})`, "g"), (_, match) => reverseMap[match]);
	}
	if (importSet.size === 0) return code;
	const importList = [...importSet];
	return (useTreeshaking ? importList.map((name) => `import ${name} from '${importTransformation(name)}'`).join(";") : `import {${importList.join(",")}} from 'quasar'`) + ";" + code;
}
//#endregion
//#region src/scss-transform.js
function createScssTransform(fileExtension, sassVariables) {
	const sassImportCode = ["@import 'quasar/src/css/variables.sass'", ""];
	if (typeof sassVariables === "string") sassImportCode.unshift(`@import '${sassVariables}'`);
	const prefix = fileExtension === "sass" ? sassImportCode.join("\n") : sassImportCode.join(";\n");
	return (content) => {
		const useIndex = Math.max(content.lastIndexOf("@use "), content.lastIndexOf("@forward "));
		if (useIndex === -1) return prefix + content;
		const newLineIndex = content.indexOf("\n", useIndex);
		if (newLineIndex !== -1) {
			const index = newLineIndex + 1;
			return content.slice(0, index) + prefix + content.slice(index);
		}
		return content + "\n" + prefix;
	};
}
//#endregion
//#region src/query.js
/**
* @typedef {{
*  extensionsList: string[];
*  filenameRegex: RegExp;
* }} ExtMatcher
*
* @typedef {{
*  template: (extMatcher: ExtMatcher) => boolean;
*  script: (extMatcher: ExtMatcher) => boolean;
*  style: (extMatcher: ExtMatcher) => boolean;
* }} ViteQueryIs
*/
/**
* @see https://github.com/vitejs/vite/blob/364aae13f0826169e8b1c5db41ac6b5bb2756958/packages/plugin-vue/src/utils/query.ts - source of inspiration
* @example
* '/absolute/path/src/App.vue' // Can contain combined template&script -> template: true, script: true, style: false
* '/absolute/path/src/App.vue?vue&type=script&lang.js' // Only contains script -> template: false, script: true, style: false
* '/absolute/path/src/App.vue?vue&type=style&lang.sass' // Only contains style -> template: false, script: false, style: true
* '/absolute/path/src/script.js' // Only contains script -> template: false, script: true, style: false
* '/absolute/path/src/index.scss' // Only contains style -> template: false, script: false, style: true
*
* @param {string} id
* @returns {{ filename: string; query: { [key: string]: string; }; is: ViteQueryIs }}
*/
function parseViteRequest(id) {
	const [filename, rawQuery] = id.split("?", 2);
	const query = Object.fromEntries(new URLSearchParams(rawQuery));
	if (query.raw !== void 0) return {
		template: () => false,
		script: () => false,
		style: () => false
	};
	return query.vue !== void 0 ? {
		template: () => query.type === void 0 || query.type === "template" || query.type === "script" && (query["lang.ts"] !== void 0 || query["lang.tsx"] !== void 0),
		script: (matcher) => (query.type === void 0 || query.type === "script") && matcher.extensionsList.some((ext) => query[`lang.${ext}`] !== void 0),
		style: (matcher) => query.type === "style" && matcher.extensionsList.some((ext) => query[`lang.${ext}`] !== void 0)
	} : {
		template: (matcher) => matcher.filenameRegex.test(filename),
		script: (matcher) => matcher.filenameRegex.test(filename),
		style: (matcher) => matcher.filenameRegex.test(filename)
	};
}
function createExtMatcher(extensionsList) {
	return {
		extensionsList,
		filenameRegex: new RegExp(`\\.(${extensionsList.join("|")})$`)
	};
}
//#endregion
//#region src/plugin.js
const defaultOptions = {
	runMode: "web-client",
	sassVariables: true,
	devTreeshaking: false,
	autoImportComponentCase: "kebab",
	autoImportVueExtensions: ["vue"],
	autoImportScriptExtensions: [
		"js",
		"jsx",
		"ts",
		"tsx"
	]
};
const defaultOptionsKeys = Object.keys(defaultOptions);
function parsePluginOptions(userOpts = {}) {
	const opts = { ...userOpts };
	for (const key of defaultOptionsKeys) if (opts[key] === void 0) opts[key] = defaultOptions[key];
	return opts;
}
function getConfigPlugin(opts) {
	return {
		name: "vite:quasar:vite-conf",
		configResolved(viteConf) {
			if (viteConf.plugins.find((entry) => entry.name === "vite:vue") === void 0) {
				console.error("\n\n[Quasar] Error: In your Vite config file, please add the Quasar plugin ** after ** the Vue one\n\n");
				process.exit(1);
			}
		},
		config(viteConf, { mode }) {
			return getViteConfig(opts.runMode, mode, viteConf);
		}
	};
}
const scssMatcher = createExtMatcher(["scss", "module.scss"]);
const sassMatcher = createExtMatcher(["sass", "module.sass"]);
function getScssTransformsPlugin(opts) {
	const sassVariables = typeof opts.sassVariables === "string" ? (0, vite.normalizePath)(opts.sassVariables) : opts.sassVariables;
	const scssTransform = createScssTransform("scss", sassVariables);
	const sassTransform = createScssTransform("sass", sassVariables);
	return {
		name: "vite:quasar:scss",
		enforce: "pre",
		transform(src, id) {
			const is = parseViteRequest(id);
			if (is.style(scssMatcher)) return {
				code: scssTransform(src),
				map: null
			};
			if (is.style(sassMatcher)) return {
				code: sassTransform(src),
				map: null
			};
			return null;
		}
	};
}
function getScriptTransformsPlugin(opts) {
	let useTreeshaking = true;
	const vueMatcher = createExtMatcher(opts.autoImportVueExtensions);
	const scriptMatcher = createExtMatcher(opts.autoImportScriptExtensions);
	return {
		name: "vite:quasar:script",
		configResolved(resolvedConfig) {
			if (!opts.devTreeshaking && resolvedConfig.mode !== "production") useTreeshaking = false;
			else loadQuasarImportMap();
		},
		transform(src, id) {
			const is = parseViteRequest(id);
			if (is.template(vueMatcher)) return {
				code: vueTransform(src, opts.autoImportComponentCase, useTreeshaking),
				map: null
			};
			if (useTreeshaking && is.script(scriptMatcher)) return {
				code: mapQuasarImports(src),
				map: null
			};
			return null;
		}
	};
}
function quasarPlugin(userOpts) {
	const opts = parsePluginOptions(userOpts);
	const plugins = [getConfigPlugin(opts)];
	if (opts.sassVariables) plugins.push(getScssTransformsPlugin(opts));
	if (opts.runMode !== "ssr-server") plugins.push(getScriptTransformsPlugin(opts));
	return plugins;
}
//#endregion
//#region src/index.js
const transformAssetUrls = JSON.parse((0, node_fs.readFileSync)((0, node_path.join)(quasarPath, "dist/transforms/loader-asset-urls.json"), "utf8"));
//#endregion
exports.quasar = quasarPlugin;
exports.transformAssetUrls = transformAssetUrls;
