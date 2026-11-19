# The roadmap picture's check, run by scripts/housekeeping-push.sh (python3 -I, standard library only) on
# the file the no-key `refresh` job made, before it may reach main. It parses the file as XML, as a browser
# does an SVG shown through <img>, and passes only an SVG that holds nothing that runs or loads: UTF-8, no
# DOCTYPE or ENTITY (refused in the raw bytes, before the parser sees them), no processing instruction,
# only SVG elements, no script or foreignObject, no on... attribute, no href and no url( but to a
# #fragment, and <style> only as the generator writes it: CSS custom properties, var() and one
# prefers-color-scheme query, nothing else that takes ( or @ or \ (so nothing CSS could load).
# On a refusal it prints the reason and exits 1.
# docs/decisions/0003-tracking-and-hygiene.md
import re
import sys
import xml.parsers.expat

SVG = 'http://www.w3.org/2000/svg'


class Refused(Exception):
    pass


# The CSS the generator writes, once these are taken out, holds no ( @ or \.
CSS_ALLOWED = re.compile(r'var\(--[a-z-]+\)|@media \(prefers-color-scheme: (dark|light)\)')
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
        if local.lower() in ('script', 'foreignobject'):
            raise Refused(f'holds {local!r}')
        for key, value in attrs.items():
            attr = key.rpartition(' ')[2]
            if attr.lower().startswith('on'):
                raise Refused(f'has an {attr!r} attribute')
            if attr.lower() == 'href' and not value.startswith('#'):
                raise Refused(f'has an href to {value!r}, not a #fragment')
            if URL.search(value):
                raise Refused(f'has a url( to something but a #fragment in {attr!r}')
            if '\\' in value:
                raise Refused(f'has a backslash (a CSS escape) in {attr!r}')
            if attr == 'style' and re.search(r'[(@]', CSS_ALLOWED.sub('', value)):
                raise Refused('has a style attribute with CSS beyond custom properties and var()')
            if attr == 'attributeName' and (value.lower().startswith('on') or value.lower().endswith('href')):
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
        if re.search(r'[(@\\]', CSS_ALLOWED.sub('', css)):
            raise Refused('has a <style> with CSS beyond custom properties, var() and prefers-color-scheme')


if __name__ == '__main__':
    with open(sys.argv[1], 'rb') as f:
        data = f.read()
    try:
        check(data)
    except Refused as e:
        print(e)
        sys.exit(1)
