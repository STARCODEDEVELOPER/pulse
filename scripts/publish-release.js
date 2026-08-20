const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const projectUrl = process.env.SUPABASE_PROJECT_URL || 'https://cmvlzrkeumwysigcfklk.supabase.co';
let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const temporarySecretPath = path.join(__dirname, '..', '.release-secret.tmp');
const packageJson = require('../package.json');
const distDir = path.join(__dirname, '..', 'dist');

async function loadServiceKey(){
  if(serviceKey) return serviceKey;
  try{
    serviceKey = (await fs.readFile(temporarySecretPath, 'utf8')).trim();
    return serviceKey;
  }catch{
    console.error('Не задан SUPABASE_SERVICE_ROLE_KEY. Передай service-role key только через переменную окружения.');
    process.exit(1);
  }
}

async function uploadObject(name, body, contentType){
  const endpoint = `${projectUrl}/storage/v1/object/releases/${encodeURIComponent(name)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body,
  });
  if(!response.ok) throw new Error(`Supabase upload ${name}: HTTP ${response.status} ${await response.text()}`);
}

async function main(){
  await loadServiceKey();
  const files = (await fs.readdir(distDir)).filter(file => /^Pulse-Setup-.*\.exe$/i.test(file));
  if(!files.length) throw new Error('В dist не найден Pulse-Setup-*.exe. Сначала выполни npm run dist.');
  const installerName = files.sort().at(-1);
  const installerPath = path.join(distDir, installerName);
  const installer = await fs.readFile(installerPath);
  const sha256 = crypto.createHash('sha256').update(installer).digest('hex');
  const version = packageJson.version;
  const publicUrl = `${projectUrl}/storage/v1/object/public/releases/${encodeURIComponent(installerName)}`;
  const manifest = {
    product: 'Pulse',
    version,
    releasedAt: new Date().toISOString(),
    notes: `Pulse ${version}`,
    windows: { url: publicUrl, sha256, size: installer.length, filename: installerName },
  };
  await uploadObject(installerName, installer, 'application/octet-stream');
  await uploadObject('latest.json', JSON.stringify(manifest, null, 2), 'application/json; charset=utf-8');
  console.log(`Опубликован Pulse ${version}`);
  console.log(publicUrl);
  console.log(`SHA-256: ${sha256}`);
}

main().catch(error => { console.error(error.message); process.exit(1); }).finally(async () => {
  await fs.rm(temporarySecretPath, { force:true }).catch(() => {});
});
