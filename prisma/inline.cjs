const fs   = require('fs');
const path = require('path');
const src  = path.resolve(__dirname, '../node_modules/.prisma/client');
const dst  = path.resolve(__dirname, '../node_modules/@prisma/client');

fs.readdirSync(src)
  .filter(f => f.endsWith('.js'))
  .forEach(f => fs.copyFileSync(path.join(src, f), path.join(dst, f)));

const srcPkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
const dstPkg = JSON.parse(fs.readFileSync(path.join(dst, 'package.json'), 'utf8'));
dstPkg.imports = srcPkg.imports;
fs.writeFileSync(path.join(dst, 'package.json'), JSON.stringify(dstPkg, null, 2));
