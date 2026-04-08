import { mkdir, mkdtemp, cp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crx3 from "crx3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function getReleaseVersion() {
    const packageJson = requireEnv("npm_package_version");
    const tagName = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || "";

    if (tagName && tagName !== `v${packageJson}`) {
        throw new Error(`Release tag ${tagName} does not match package version v${packageJson}.`);
    }

    return packageJson;
}

async function stageExtension(outputDir) {
    await mkdir(outputDir, { recursive: true });
    await cp(path.join(repoRoot, "manifest.json"), path.join(outputDir, "manifest.json"));
    await cp(path.join(repoRoot, "src"), path.join(outputDir, "src"), { recursive: true });
    await cp(path.join(repoRoot, "assets"), path.join(outputDir, "assets"), { recursive: true });
}

async function main() {
    const version = getReleaseVersion();
    const packageName = requireEnv("npm_package_name");
    const keyPem = requireEnv("EXTENSION_PRIVATE_KEY_PEM");

    const distDir = path.join(repoRoot, "dist", "release");
    const stageDir = path.join(distDir, `${packageName}-v${version}`);
    const artifactBase = path.join(distDir, `${packageName}-v${version}`);

    await rm(distDir, { recursive: true, force: true });
    await stageExtension(stageDir);

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wingman-release-key-"));
    const keyPath = path.join(tempDir, "extension-release-key.pem");

    try {
        await writeFile(keyPath, keyPem, "utf8");
        await crx3([path.join(stageDir, "manifest.json")], {
            keyPath,
            crxPath: `${artifactBase}.crx`,
            zipPath: `${artifactBase}.zip`
        });
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }

    process.stdout.write(
        JSON.stringify(
            {
                version,
                stageDir,
                crxPath: `${artifactBase}.crx`,
                zipPath: `${artifactBase}.zip`
            },
            null,
            2
        )
    );
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
