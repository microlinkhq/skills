---
name: optimo
description: Optimize and convert images using the optimo CLI and API on top of ImageMagick. Use when the user mentions reducing image size, image compression, batch image optimization, converting formats (jpeg/png/webp/avif/heic/jxl), resizing by percentage/dimensions/max-size, or running optimo in scripts.
---

# optimo

`optimo` aggressively reduces image size with format-specific ImageMagick presets.

## Prerequisites

ImageMagick must be installed and available as `magick`. If `magick` is missing, `optimo` throws: `ImageMagick is not installed`.

## Quick Start (CLI)

Use `npx` for one-off runs:

```bash
npx -y optimo public/media
```

Optimize a single file:

```bash
npx -y optimo public/media/banner.png
```

Run a dry run (no file changes):

```bash
npx -y optimo public/media/banner.png --dry-run # long version
npx -y optimo public/media/banner.png -d # short version
```

Convert and optimize to a new format:

```bash
npx -y optimo public/media/banner.png --format jpeg # long version
npx -y optimo public/media/banner.png -f jpeg # short version
```

Resize by percentage:

```bash
npx -y optimo public/media/banner.png --resize 50% # long version
npx -y optimo public/media/banner.png -r 50% # short version
```

Resize to a target max file size:

```bash
npx -y optimo public/media/banner.png --resize 100kB # long version
npx -y optimo public/media/banner.png -r 100kB # short version
```

Resize by width:

```bash
npx -y optimo public/media/banner.png --resize w960 # long version
npx -y optimo public/media/banner.png -r w960 # short version
```

Resize by height:

```bash

npx -y optimo public/media/banner.png --resize h480 # long version
npx -y optimo public/media/banner.png -r h480 # short version
```

## Recommended Workflow

1. Start with `--dry-run` to confirm target files.
2. Run optimization on a file first, then on directories.
3. Use `--format` only when conversion is intended.
4. Use `--resize` when you need explicit dimension/size control.
5. Verify outputs in version control before committing.

## CLI Options

- `-d`, `--dry-run`: Show what would change without writing files.
- `-f`, `--format`: Convert output format (`jpeg`, `webp`, `avif`, etc.).
- `-r`, `--resize`: Resize using percentage (`50%`), max file size (`100kB`), width (`w960`), or height (`h480`).
- `-s`, `--silent`: Suppress per-file logs.

## Programmatic API

```js
const optimo = require('optimo')

await optimo.file('/absolute/path/image.jpg', {
  dryRun: false,
  format: 'webp',
  resize: '50%',
  onLogs: console.log
})

await optimo.file('/absolute/path/image.jpg', {
  resize: '100kB',
  onLogs: console.log
})

await optimo.file('/absolute/path/image.jpg', {
  resize: 'w960',
  onLogs: console.log
})

const result = await optimo.dir('/absolute/path/images')
console.log(result)
// { originalSize, optimizedSize, savings }
```

## Behavior Notes

- For non-conversion runs, if the optimized file is not smaller, the original file is kept.
- During conversion, output uses the new extension and the original source file is removed (unless `--dry-run`).
- Hidden files and folders (names starting with `.`) are skipped in directory mode.
- Unsupported files are reported as `[unsupported]` and ignored.
