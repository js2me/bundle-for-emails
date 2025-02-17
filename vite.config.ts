import fs from "node:fs";
import path from "path";
import { defineConfig } from "vite";
import sharp from 'sharp';
import replaceAsync from 'string-replace-async'; // Импортируем string-replace-async
import * as minfierTerserModule from 'html-minifier-terser'; // Импортируем html-minifier-terser как default
import { ProxyOptions } from "vite";
import juice from "juice";

const minify = (minfierTerserModule as any).minify 

// Список HTML файлов
const htmlFiles = fs.readdirSync(path.resolve('./src'))
  .filter(file => file.endsWith('.html'))
  .map((file) => ({
    entry: `src/${file}`,
    template: `src/${file}`, 
    filename: file,
  }));

// Функция для оптимизации изображений перед встраиванием
function optimizeAndInlineImages(): any {
  return {
    name: 'optimize-and-inline-images',
    async transform(code, id) {
      if (!id.endsWith('.html')) return null; // Пропускаем не-HTML файлы

      try {
        // Регулярное выражение для поиска <img> тегов с атрибутом src
        const regex = /<img[^>]+src=["']([^"']+\.(png|jpe?g|webp))["'][^>]*>/gi;

        let result = await replaceAsync(code, regex, async (match, url) => {
          const filePath = path.resolve(__dirname, url);

          try {
            if (!fs.existsSync(filePath)) {
              console.warn(`File not found: ${filePath}`);
              return match;
            }

            const buffer = fs.readFileSync(filePath);

            const ext = path.extname(url).toLowerCase();
            const optimizedBuffer = await sharp(buffer)
              .resize({ withoutEnlargement: true })
              .toFormat(ext.slice(1) as any, { quality: 80 })
              .toBuffer();

            const base64 = optimizedBuffer.toString('base64');
            const mimeType = getMimeType(url);

            return match.replace(url, `data:${mimeType};base64,${base64}`);
          } catch (error) {
            console.error(`Error processing image: ${filePath}`, error);
            return match;
          }
        });

        return result || code;
      } catch (error) {
        console.error('Error during image optimization:', error);
        return code;
      }
    },
  };
}

function customHtmlPlugin() {
  return {
    name: 'custom-html-plugin',
    async transformIndexHtml(html) {
      let resultHtml = html;
      try {
        resultHtml = await minify(html, {
          collapseWhitespace: true,
          removeComments: true,
          minifyCSS: true,
          minifyJS: true,
          removeAttributeQuotes: true,
        });
        resultHtml = juice(resultHtml, {
          removeStyleTags: true,
          resolveCSSVariables: true,
        });

        while(resultHtml.includes('<style>')) {
          const [left, other] = resultHtml.split('<style>', 2)
          const [,right] = other.split('</style>', 2)
          resultHtml = `${left}${right}`
        }

        resultHtml = resultHtml.replace(/ class="[^"]*"/g, '');
        resultHtml = resultHtml.replace(/ class='[^']*'/g, '');
      } catch (error) {
        console.error('Error during styles inlining:', error);
      }

      return resultHtml;
    },
  };
}

function getMimeType(url: string): string {
  const ext = path.extname(url).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    default: return 'application/octet-stream';
  }
}

export default defineConfig(({ mode }) => {
  const port = Number(process.env.PORT) || 5173

  if (mode === 'development') {
    console.info('allowed email templates')
    console.info(htmlFiles.map(file => `http://localhost:${port}/${file.filename.replace('.html', '')}`).join('\n'));
  }

  return {
    base: '/',
    build: {
      assetsInlineLimit: Number.MAX_SAFE_INTEGER, 
      cssMinify: false,
      minify: true,
      rollupOptions: {
        input: htmlFiles.reduce((acc, file) => {
          acc[file.filename] = file.entry;
          return acc;
        }, {}),
      },
      outDir: 'dist',
      emptyOutDir: true,
      copyPublicDir: false,
    },
    server: {
      port,
      proxy: Object.assign(
        {
          ['/src/assets']: {
            target: `http://localhost:${port}`,
            changeOrigin: true,
            rewrite: (path) => `${path.replace('/src', '')}`,
          } satisfies ProxyOptions
        },
        ...htmlFiles.map((file) => ({
          [`/${file.filename}`]: {
            target: `http://localhost:${port}`,
            changeOrigin: true,
            rewrite: (path) => `/src${path}`,
          } satisfies ProxyOptions,
          [`/${file.filename.replace('.html', '')}`]: {
            target: `http://localhost:${port}`,
            changeOrigin: true,
            rewrite: (path) => `/src${path}.html`,
          } satisfies ProxyOptions
        }))
      ),
    },
    plugins: [
      customHtmlPlugin(),
      optimizeAndInlineImages(),
    ],
  };
});