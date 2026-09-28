#!/usr/bin/env python3
"""HTML -> plain text, one block per line, so a quoted sentence can be grepped.

Usage: totext.py page.html [more.html ...]   (writes page.txt beside each)
"""
import html  # noqa: F401  (HTMLParser unescapes entities itself)
import re
import sys
from html.parser import HTMLParser

BLOCK = ('p', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'br', 'pre', 'table', 'dt', 'dd')
SKIP = ('script', 'style', 'nav', 'header', 'footer')


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.out = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in SKIP:
            self.skip += 1
        if tag in BLOCK:
            self.out.append('\n')
        if tag in ('td', 'th'):
            self.out.append(' | ')
        if tag in ('h1', 'h2', 'h3', 'h4'):
            self.out.append('#' * int(tag[1]) + ' ')
        if tag == 'li':
            self.out.append('- ')

    def handle_endtag(self, tag):
        if tag in SKIP:
            self.skip = max(0, self.skip - 1)
        if tag in BLOCK:
            self.out.append('\n')

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


for path in sys.argv[1:]:
    parser = Text()
    with open(path, encoding='utf-8', errors='replace') as fh:
        parser.feed(fh.read())
    text = ''.join(parser.out)
    text = re.sub(r'[ \t\r\f\v]+', ' ', text)
    text = re.sub(r'\n\s*\n+', '\n', text)
    out = path.rsplit('.', 1)[0] + '.txt'
    with open(out, 'w', encoding='utf-8') as fh:
        fh.write(text)
    print(f'{out}  {len(text)} chars')
