"""Build the offline HTML from the editable sources; standard library only."""
from pathlib import Path

root = Path(__file__).resolve().parent
html = (root / 'index.html').read_text()
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>' + (root / 'style.css').read_text() + '</style>')
for name in ('vendor/gsap.min.js', 'app.js'):
    html = html.replace(f'<script defer src="{name}"></script>', '')
scripts = ''.join('<script>' + (root / name).read_text().replace('</script', '<\\/script') + '</script>' for name in ('vendor/gsap.min.js', 'app.js'))
(root / 'liquid-glass.html').write_text(html.replace('</body>', scripts + '</body>'))
print('Built liquid-glass.html')
