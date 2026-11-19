# The roadmap picture's check, run by scripts/housekeeping-push.sh (python3 -I, standard library only) on
# the file the no-key `refresh` job made, before it may reach main. It parses the file as XML, as a browser
# does an SVG shown through <img>, and passes only an SVG that holds nothing that runs or loads: UTF-8, no
# DOCTYPE or ENTITY (refused in the raw bytes, before the parser sees them), no processing instruction,
# only the SVG elements the generator writes (ELEMENTS; docs.yml checks its live output on every PR),
# attributes only unprefixed or in xlink (no xml:base), no on... attribute, no href and no url( but to a
# #fragment, no style attribute, and a <style> only when its text is scripts/lib/roadmap-style.css byte for
# byte (the file generate-roadmap.mjs writes it from). On a refusal it prints the reason and exits 1.
# docs/decisions/0003-tracking-and-hygiene.md
import os
import re
import sys
import xml.parsers.expat

SVG = 'http://www.w3.org/2000/svg'
XLINK = 'http://www.w3.org/1999/xlink'
ELEMENTS = {'svg', 'title', 'desc', 'style', 'g', 'rect', 'path', 'text', 'tspan'}


class Refused(Exception):
    pass


with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'roadmap-style.css'), encoding='utf-8') as f:
    STYLE = f.read()
URL = re.compile(r'url\(\s*([\'"]?)\s*(?!#)', re.I)


def check(data):
    try:
        data.decode('utf-8')
    except UnicodeDecodeError:
        raise Refused('is not UTF-8')
    if re.search(rb'<!(DOCTYPE|ENTITY)', data, re.I):
        raise Refused('has a DOCTYPE or ENTITY')
    if not re.match(rb'(<\?xml[^>]*\?>\s*)?<svg[\s>]', data):
        raise Refused('does not start with <svg (after an optional XML declaration)')
    p = xml.parsers.expat.ParserCreate(namespace_separator=' ')
    stack = []
    styles = []

    def refuse(why):
        def handler(*_):
            raise Refused(why)
        return handler

    p.StartDoctypeDeclHandler = refuse('has a DOCTYPE')
    p.EntityDeclHandler = refuse('declares an entity')
    p.ProcessingInstructionHandler = refuse('has a processing instruction')
    p.ExternalEntityRefHandler = refuse('refers to an external entity')

    def start(name, attrs):
        ns, _, local = name.rpartition(' ')
        if not stack and (ns, local) != (SVG, 'svg'):
            raise Refused(f'its root is {local!r}, not an SVG svg')
        stack.append(local)
        if ns != SVG:
            raise Refused(f'holds {local!r}, not an SVG element')
        if local not in ELEMENTS:
            raise Refused(f'holds {local!r}, not one of the roadmap\'s elements')
        for key, value in attrs.items():
            attr_ns, _, attr = key.rpartition(' ')
            if attr_ns not in ('', XLINK):
                raise Refused(f'has an attribute {attr!r} in {attr_ns}, outside SVG and xlink')
            if attr.lower().startswith('on'):
                raise Refused(f'has an {attr!r} attribute')
            if attr.lower() == 'href' and not value.startswith('#'):
                raise Refused(f'has an href to {value!r}, not a #fragment')
            if URL.search(value):
                raise Refused(f'has a url( to something but a #fragment in {attr!r}')
            if '\\' in value:
                raise Refused(f'has a backslash (a CSS escape) in {attr!r}')
            if attr == 'style':
                raise Refused('has a style attribute')
            judged = value.strip().lower()
            if attr == 'attributeName' and (judged.startswith('on') or judged.endswith('href')):
                raise Refused(f'animates {value!r}')
        if local == 'style':
            styles.append([])

    def text(t):
        if stack and stack[-1] == 'style':
            styles[-1].append(t)

    p.StartElementHandler = start
    p.EndElementHandler = lambda _: stack.pop()
    p.CharacterDataHandler = text
    try:
        p.Parse(data, True)
    except xml.parsers.expat.ExpatError as e:
        raise Refused(f'is not well-formed XML ({e})')
    for css in (''.join(t) for t in styles):
        if css != STYLE:
            raise Refused('has a <style> that is not scripts/lib/roadmap-style.css')


if __name__ == '__main__':
    with open(sys.argv[1], 'rb') as f:
        data = f.read()
    try:
        check(data)
    except Refused as e:
        print(e)
        sys.exit(1)
