const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const sizes = [256, 48, 32, 16];
const svgPath = path.join(__dirname, '..', 'icon.svg');
const pngPath = path.join(__dirname, '..', 'icon.png');
const icoPath = path.join(__dirname, '..', 'icon.ico');
const tmpDir = path.join(__dirname, '..', 'icon-tmp');

async function generate() {
    fs.mkdirSync(tmpDir, { recursive: true });

    const svg = fs.readFileSync(svgPath);

    // Generate 256x256 PNG for general use
    await sharp(svg).resize(256, 256).png().toFile(pngPath);
    console.log('✓ icon.png (256x256)');

    // Generate PNGs at each ICO size
    const tmpFiles = [];
    for (const size of sizes) {
        const tmpFile = path.join(tmpDir, `${size}.png`);
        await sharp(svg).resize(size, size).png().toFile(tmpFile);
        tmpFiles.push(tmpFile);
    }

    // Use png-to-ico's default export with file paths
    const { default: pngToIco } = await import('png-to-ico');
    const ico = await pngToIco(tmpFiles);
    fs.writeFileSync(icoPath, ico);
    console.log('✓ icon.ico (multi-size)');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
}

generate().catch(err => {
    console.error(err);
    process.exit(1);
});
