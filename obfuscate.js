const fs = require("fs");
const path = require("path");
const JavaScriptObfuscator = require("javascript-obfuscator");

const rootDirectory = process.argv[2];

if (!rootDirectory) {
  console.error("사용법: node obfuscate.js <배포 디렉터리>");
  process.exit(1);
}

const absoluteRootDirectory = path.resolve(rootDirectory);

if (!fs.existsSync(absoluteRootDirectory)) {
  console.error(`대상 디렉터리가 없습니다: ${absoluteRootDirectory}`);
  process.exit(1);
}

const excludedDirectories = new Set([
  path.resolve(absoluteRootDirectory, "site"),
  path.resolve(absoluteRootDirectory, "node_modules"),
  path.resolve(absoluteRootDirectory, ".git")
]);

const excludedFiles = new Set([
  "sw.js"
]);

function isInsideDirectory(filePath, directoryPath) {
  const relative = path.relative(directoryPath, filePath);

  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function isExcluded(filePath) {
  const absoluteFilePath = path.resolve(filePath);

  for (const directory of excludedDirectories) {
    if (isInsideDirectory(absoluteFilePath, directory)) {
      return true;
    }
  }

  return excludedFiles.has(path.basename(absoluteFilePath));
}

function collectJavaScriptFiles(directory) {
  const files = [];

  for (const entry of fs.readdirSync(directory, {
    withFileTypes: true
  })) {
    const entryPath = path.join(directory, entry.name);

    if (isExcluded(entryPath)) {
      console.log(
        `건너뜀: ${path.relative(
          absoluteRootDirectory,
          entryPath
        )}`
      );
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(entryPath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!entry.name.endsWith(".js")) {
      continue;
    }

    if (
      entry.name.endsWith(".min.js") ||
      entry.name.endsWith(".obfuscated.js")
    ) {
      console.log(
        `이미 처리된 파일 건너뜀: ${path.relative(
          absoluteRootDirectory,
          entryPath
        )}`
      );
      continue;
    }

    files.push(entryPath);
  }

  return files;
}

const javaScriptFiles = collectJavaScriptFiles(
  absoluteRootDirectory
);

if (javaScriptFiles.length === 0) {
  console.log("난독화할 JavaScript 파일이 없습니다.");
  process.exit(0);
}

const options = {
  compact: true,

  // 브라우저용 출력
  target: "browser",

  identifierNamesGenerator: "hexadecimal",

  // ES module의 파일 간 이름 계약을 최대한 보존
  renameGlobals: false,
  renameProperties: false,

  stringArray: true,
  stringArrayThreshold: 0.7,
  stringArrayEncoding: ["base64"],
  rotateStringArray: true,
  shuffleStringArray: true,

  splitStrings: true,
  splitStringsChunkLength: 8,

  numbersToExpressions: true,
  simplify: true,

  // 모바일 실시간 영상 앱에서는 성능 비용이 큰 옵션을 끔
  controlFlowFlattening: false,
  deadCodeInjection: false,

  // Service Worker, 모듈 로딩, Safari에서 문제 가능성이 있어 끔
  selfDefending: false,
  debugProtection: false,
  debugProtectionInterval: 0,

  disableConsoleOutput: false,

  sourceMap: false
};

let successCount = 0;

for (const filePath of javaScriptFiles) {
  const relativePath = path.relative(
    absoluteRootDirectory,
    filePath
  );

  console.log(`난독화 중: ${relativePath}`);

  let sourceCode = fs.readFileSync(filePath, "utf8");

  if (sourceCode.charCodeAt(0) === 0xfeff) {
    sourceCode = sourceCode.slice(1);
  }

  try {
    const result = JavaScriptObfuscator.obfuscate(
      sourceCode,
      options
    );

    const obfuscatedCode = result.getObfuscatedCode();

    if (!obfuscatedCode?.trim()) {
      throw new Error("난독화 결과가 비어 있습니다.");
    }

    fs.writeFileSync(
      filePath,
      `${obfuscatedCode}\n`,
      "utf8"
    );

    successCount += 1;
    console.log(`완료: ${relativePath}`);
  } catch (error) {
    console.error(`실패: ${relativePath}`);
    console.error(error?.stack || error);
    process.exit(1);
  }
}

console.log(
  `JavaScript 난독화 완료: ${successCount}개`
);
