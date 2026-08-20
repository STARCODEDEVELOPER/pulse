const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const packageJson = require(path.join(root, 'package.json'));
const distDir = path.join(root, 'dist');
const repository = process.env.GITHUB_REPOSITORY || 'STARCODEDEVELOPER/pulse';

async function main() {
  const files = (await fs.readdir(distDir)).filter((file) => /^Pulse-Setup-.*\.exe$/i.test(file));
  if (!files.length) throw new Error('В dist не найден Pulse-Setup-*.exe. Сначала выполни npm run dist.');
  const installerName = files.sort().at(-1);
  const installerPath = path.join(distDir, installerName);
  const installer = await fs.readFile(installerPath);
  const sha256 = crypto.createHash('sha256').update(installer).digest('hex');
  const version = packageJson.version;
  const manifest = {
    product: 'Pulse',
    version,
    releasedAt: new Date().toISOString(),
    notes: `Pulse ${version}`,
    windows: {
      url: `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(installerName)}`,
      sha256,
      size: installer.length,
      filename: installerName,
    },
  };
  await fs.writeFile(path.join(root, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Создан latest.json для Pulse ${version}`);
  console.log(`SHA-256: ${sha256}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

module.exports = { main };

// Keep this file self-contained for local builds and GitHub Actions.
