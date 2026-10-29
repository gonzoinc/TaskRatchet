'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const shared = ['lib/engine.cjs', 'lib/storage.cjs', 'settings.default.json'];
function crc32(data) {
  let crc = -1;
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ -1) >>> 0;
}
// Minimal deterministic uncompressed ZIP, no dependency/global packaging install.
function zip(entries) {
  const chunks = [], central = []; let offset = 0;
  for (const [name, bytes] of entries) {
    const filename = Buffer.from(name), crc = crc32(bytes), head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x800, 6); head.writeUInt16LE(33, 12);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(bytes.length, 18); head.writeUInt32LE(bytes.length, 22); head.writeUInt16LE(filename.length, 26);
    chunks.push(head, filename, bytes);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(33, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(bytes.length, 20); c.writeUInt32LE(bytes.length, 24); c.writeUInt16LE(filename.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, filename); offset += head.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}
function build(repo) {
  const hashes = {}, policy = shared.map(name => {
    const bytes = fs.readFileSync(path.join(repo, name)); hashes[name] = hash(bytes);
    return [`extension/shared/${name}`, bytes];
  });
  const metadata = { source: 'TaskRatchet shared policy (unchanged build-time copies)', hashes };
  const files = ['package.json', 'extension.cjs', 'README.md', 'src/policy.cjs', 'src/ipc.cjs', 'src/controller.cjs', 'src/bridge.cjs', 'src/guard.cjs', 'scripts/request.cjs', 'AGENT-BRIDGE.md'];
  const manifest = `<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="taskratchet-companion-prototype" Version="0.0.1" Publisher="gonzoinc"/><DisplayName>TaskRatchet Companion (Experimental)</DisplayName><Description xml:space="preserve">Windows-local private API experiment; Codex 26.1021.22027 only.</Description><Tags>experimental</Tags><Categories>Other</Categories><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.96.0"/><Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui"/></Properties><License>extension/LICENSE</License></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" Version="[1.96.0,)"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/></Assets></PackageManifest>`;
  const contentTypes = `<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="vsixmanifest" ContentType="text/xml"/><Override PartName="/extension/LICENSE" ContentType="text/plain"/></Types>`;
  const entries = [['[Content_Types].xml', Buffer.from(contentTypes)], ['extension.vsixmanifest', Buffer.from(manifest)], ...files.map(x => [`extension/${x}`, fs.readFileSync(path.join(root, x))]), ['extension/LICENSE', fs.readFileSync(path.join(repo, 'LICENSE'))], ['extension/shared/source-hashes.json', Buffer.from(JSON.stringify(metadata, null, 2) + '\n')], ...policy];
  const bytes = zip(entries), output = path.join(repo, 'dist', 'taskratchet-companion-0.0.1.vsix');
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, bytes);
  const result = { output, bytes: bytes.length, members: entries.length, sha256: hash(bytes), shared: metadata };
  const evidence = path.join(repo, '.codex/vscode-integration/build.json');
  fs.mkdirSync(path.dirname(evidence), { recursive: true }); fs.writeFileSync(evidence, JSON.stringify(result, null, 2) + '\n'); return result;
}
if (require.main === module) console.log(JSON.stringify(build(path.resolve(process.argv[2] || path.join(root, '..'))), null, 2));
module.exports = { build, zip, crc32 };
