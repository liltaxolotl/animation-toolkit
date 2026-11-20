// The app's full source as one string: animation_app.html with every <script src="app/..."> pulled in, in page order.
// Tests use it to cut out the /*NAME-START*/ ... /*NAME-END*/ math blocks, wherever they now live.
import fs from 'node:fs';
import path from 'node:path';

export function appSource(root) {
  const html = fs.readFileSync(path.join(root, 'animation_app.html'), 'utf8');
  return html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) =>
    /^app\//.test(src) ? '<script>\n' + fs.readFileSync(path.join(root, src), 'utf8') + '</script>' : m);
}
