import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";
//#region src/native-cli.ts
function manifest(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return;
	}
}
function samePath(left, right) {
	try {
		return realpathSync(left) === realpathSync(right);
	} catch {
		return false;
	}
}
const MNEMON_NPM_PACKAGE = "@mnemon-dev/mnemon";
/** Execute JavaScript with the Host binary even when it is Electron's GUI executable. */
function nodeLauncherEnvironment(environment = process.env) {
	return {
		...Object.fromEntries(Object.entries(environment).filter(([key]) => key.toUpperCase() !== "ELECTRON_RUN_AS_NODE")),
		ELECTRON_RUN_AS_NODE: "1"
	};
}
function mnemonNpmLauncher(command) {
	let realCommand = command;
	try {
		realCommand = realpathSync(command);
	} catch {}
	const root = dirname(dirname(realCommand));
	if (manifest(join(root, "package.json"))?.name === MNEMON_NPM_PACKAGE && samePath(realCommand, join(root, "bin/mnemon.js"))) return realCommand;
	if (/\.cmd$/i.test(command)) {
		const launcher = join(dirname(command), "node_modules", MNEMON_NPM_PACKAGE, "bin/mnemon.js");
		try {
			if (manifest(join(dirname(dirname(launcher)), "package.json"))?.name === MNEMON_NPM_PACKAGE && existsSync(launcher) && readFileSync(command, "utf8").replaceAll("\\", "/").includes("node_modules/@mnemon-dev/mnemon/bin/mnemon.js")) return launcher;
		} catch {}
	}
}
const UNIX_COMMON_CLI_PATHS = [
	"~/.local/bin/mnemon",
	"/opt/homebrew/bin/mnemon",
	"/usr/local/bin/mnemon",
	"/usr/bin/mnemon"
];
function pathApi(platform) {
	return platform === "win32" ? win32 : posix;
}
function expandHome(path, home = homedir(), platform = process.platform) {
	if (path === "~") return home;
	return path.startsWith("~/") || path.startsWith("~\\") ? pathApi(platform).join(home, path.slice(2)) : path;
}
function envValue(env, name, platform) {
	if (platform !== "win32") return env[name];
	const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
	return key === void 0 ? void 0 : env[key];
}
function isMnemonExecutable(path, platform = process.platform) {
	if (platform === "win32" && win32.extname(path).toLowerCase() !== ".exe" && mnemonNpmLauncher(path) === void 0) return false;
	try {
		accessSync(path, platform === "win32" ? constants.F_OK : constants.X_OK);
		return statSync(path).isFile();
	} catch {
		return false;
	}
}
function windowsCommonCliPaths(env, home) {
	const candidates = [];
	const goBin = envValue(env, "GOBIN", "win32")?.trim();
	if (goBin !== void 0 && win32.isAbsolute(goBin)) candidates.push(win32.join(goBin, "mnemon.exe"));
	const goInstallRoot = (envValue(env, "GOPATH", "win32")?.trim())?.split(win32.delimiter).map((candidate) => candidate.trim()).find((candidate) => candidate !== "" && win32.isAbsolute(candidate)) ?? win32.join(home, "go");
	candidates.push(win32.join(goInstallRoot, "bin", "mnemon.exe"));
	const localAppData = envValue(env, "LOCALAPPDATA", "win32")?.trim();
	if (localAppData !== void 0 && win32.isAbsolute(localAppData)) candidates.push(win32.join(localAppData, "Programs", "mnemon", "mnemon.exe"));
	const programFiles = envValue(env, "ProgramFiles", "win32")?.trim();
	if (programFiles !== void 0 && win32.isAbsolute(programFiles)) candidates.push(win32.join(programFiles, "mnemon", "mnemon.exe"));
	return [...new Set(candidates)];
}
function commonCliPaths(platform, env, home) {
	if (platform === "win32") return windowsCommonCliPaths(env, home);
	return UNIX_COMMON_CLI_PATHS.map((candidate) => expandHome(candidate, home, platform));
}
/** Locate the local Mnemon binary without invoking a shell. */
function findMnemonCommand(config, options = {}) {
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	const home = options.home ?? homedir();
	const isExecutable = options.isExecutable ?? ((path) => isMnemonExecutable(path, platform));
	const paths = pathApi(platform);
	const resolveCommand = (command) => {
		const expanded = expandHome(command, home, platform);
		if (expanded.includes("/") || expanded.includes("\\")) return expanded;
		const names = platform === "win32" && paths.extname(expanded) === "" ? [`${expanded}.exe`, `${expanded}.cmd`] : [expanded];
		for (const directory of (envValue(env, "PATH", platform) ?? "").split(paths.delimiter)) {
			if (directory === "") continue;
			for (const name of names) {
				const path = paths.join(directory, name);
				if (/\.cmd$/i.test(name) && mnemonNpmLauncher(path) === void 0) continue;
				if (isExecutable(path)) return path;
			}
		}
	};
	if (config.cliPath !== void 0) return resolveCommand(config.cliPath);
	const envPath = envValue(env, "MNEMON_CLI_PATH", platform)?.trim();
	if (envPath !== void 0 && envPath !== "") {
		const path = resolveCommand(envPath);
		if (path !== void 0 && isExecutable(path)) return path;
	}
	const fromPath = resolveCommand("mnemon");
	if (fromPath !== void 0) return fromPath;
	for (const path of commonCliPaths(platform, env, home)) if (isExecutable(path)) return path;
}
//#endregion
export { findMnemonCommand, isMnemonExecutable, mnemonNpmLauncher, nodeLauncherEnvironment };
