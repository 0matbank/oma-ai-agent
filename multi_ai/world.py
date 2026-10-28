"""
World feed for the Oma window (Sat-Link globe + Today Headlines) and the daily brief. No AI tokens: public RSS feeds,
place names matched to coordinates, cached for 20 minutes in headlines.json.
"""
import json
import os
import re
import time
import urllib.request
import xml.etree.ElementTree as ET

HOME = os.path.expanduser('~')
DIR = os.environ.get('ATTICUS_DIR') or os.path.join(os.environ.get('APPDATA') or os.path.join(HOME, '.config'), 'Atticus')
CACHE = os.path.join(DIR, 'headlines.json')
FEEDS = [('BBC World', 'https://feeds.bbci.co.uk/news/world/rss.xml'), ('Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml')]
TTL = 20 * 60
ALERT = re.compile(r'\b(attack|attacks|killed|kills|dead|deaths?|war|strikes?|missile|drone|bomb|shelling|earthquake|flood|cyclone|hurricane|'
                   r'typhoon|wildfire|explosion|clashes|coup|crisis|famine|outbreak|shooting|hostage|invasion)\b', re.I)
# name or demonym -> (lat, lon); first match in a title wins
PLACES = {
    'ukrain': (49, 32), 'kharkiv': (50, 36.2), 'kherson': (46.6, 32.6), 'odesa': (46.5, 30.7), 'russia': (61, 90), 'moscow': (55.8, 37.6), 'kyiv': (50.4, 30.5), 'iran': (32, 53), 'tehran': (35.7, 51.4),
    'israel': (31.4, 35), 'gaza': (31.4, 34.4), 'palestin': (31.9, 35.2), 'west bank': (31.9, 35.3), 'lebanon': (33.9, 35.9), 'syria': (35, 38),
    'iraq': (33, 44), 'yemen': (15.5, 48), 'saudi': (24, 45), 'qatar': (25.3, 51.2), 'egypt': (26.8, 30.8), 'sudan': (15.5, 30),
    'ethiopia': (9, 39.5), 'somalia': (5, 46), 'kenya': (0, 38), 'nigeria': (9, 8), 'congo': (-2.9, 23.6), 'south africa': (-29, 24),
    'libya': (27, 17), 'tigray': (14, 39), 'sahel': (15, 2), 'mali': (17, -4), 'niger': (17, 8), 'chad': (15, 19), 'zambia': (-13, 28),
    'afghan': (34, 66), 'pakistan': (30, 70), 'india': (21, 78), 'delhi': (28.6, 77.2), 'bangladesh': (23.7, 90.4), 'dhaka': (23.8, 90.4),
    'myanmar': (21, 96), 'sri lanka': (7.9, 80.7), 'nepal': (28.4, 84.1), 'china': (35, 104), 'beijing': (39.9, 116.4), 'taiwan': (23.7, 121),
    'hong kong': (22.3, 114.2), 'japan': (36, 138), 'tokyo': (35.7, 139.7), 'korea': (36.5, 127.8), 'philippine': (12.9, 122), 'indonesia': (-2.5, 118),
    'vietnam': (16, 107.8), 'thailand': (15.8, 100.9), 'malaysia': (4, 102), 'australia': (-25.3, 133.8), 'new zealand': (-41, 174),
    'united states': (39.8, -98.6), 'u.s.': (39.8, -98.6), 'america': (39.8, -98.6), 'washington': (38.9, -77), 'trump': (38.9, -77),
    'canada': (56, -106), 'mexico': (23.6, -102.5), 'cuba': (21.5, -78), 'haiti': (19, -72.3), 'venezuela': (7, -66), 'colombia': (4.6, -74),
    'brazil': (-10, -52), 'argentina': (-34, -64), 'chile': (-35.7, -71.5), 'peru': (-9.2, -75), 'ecuador': (-1.8, -78.2), 'hawaii': (20.8, -156.3),
    'uk': (54, -2), 'britain': (54, -2), 'london': (51.5, -0.1), 'france': (46.2, 2.2), 'paris': (48.9, 2.35), 'germany': (51.2, 10.4),
    'italy': (42.8, 12.8), 'spain': (40.4, -3.7), 'poland': (52, 19), 'turkey': (39, 35), 'greece': (39, 22), 'netherlands': (52.1, 5.3),
    'sweden': (62, 15), 'norway': (61, 8), 'hungary': (47.2, 19.5), 'serbia': (44, 21), 'belarus': (53.7, 28), 'georgia': (42.3, 43.4),
    'armenia': (40.1, 45), 'azerbaijan': (40.1, 47.6), 'europe': (50, 10), 'nato': (50.8, 4.4), 'brussels': (50.8, 4.4),
}


def _fetch(url, ua='Mozilla/5.0 (Windows NT 10.0; Win64; x64) Oma-AI'):
    req = urllib.request.Request(url, headers={'User-Agent': ua})
    with urllib.request.urlopen(req, timeout=12) as r:
        return r.read()


_RX = [(k, v, re.compile(r'(?<![a-z])' + re.escape(k) + (r'(?![a-z])' if len(k) <= 4 else ''))) for k, v in PLACES.items()]   # 'uk' is not 'ukraine'   # word start: 'ukrain' matches Ukrainian, 'india' not Indiana's 'indian'... close enough


def place(title, more=''):
    """The place named first in the title (else in the summary)."""
    for t in (title.lower(), more.lower()):
        hits = [(m.start(), k, v) for k, v, rx in _RX for m in [rx.search(t)] if m]
        if hits:
            _, k, v = min(hits)
            return k, v
    return '', None


def parse(source, xml):
    out = []
    for it in ET.fromstring(xml).iter('item'):
        title = (it.findtext('title') or '').strip()
        if not title:
            continue
        name, ll = place(title, (it.findtext('description') or '')[:200])
        out.append({'title': title, 'link': (it.findtext('link') or '').strip(), 'source': source, 'at': (it.findtext('pubDate') or '').strip(),
                    'place': name, 'lat': ll[0] if ll else None, 'lon': ll[1] if ll else None, 'alert': bool(ALERT.search(title))})
    return out


def headlines(refresh=False, limit=40):
    try:
        c = json.load(open(CACHE, encoding='utf-8'))
        if not refresh and time.time() - c.get('at', 0) < TTL:
            return c
    except Exception:
        c = None
    items, errors = [], []
    for src, url in FEEDS:
        try:
            items += parse(src, _fetch(url))[:limit // len(FEEDS) + 5]
        except Exception as e:
            errors.append(f'{src}: {str(e)[:80]}')
    if not items and c:   # offline: keep the last good list, marked stale
        c['stale'] = True
        c['errors'] = errors
        return c
    seen, uniq = set(), []
    for i in items:
        k = i['title'].lower()[:60]
        if k not in seen:
            seen.add(k); uniq.append(i)
    uniq.sort(key=lambda i: (not i['alert'], i['lat'] is None))
    d = {'at': time.time(), 'items': uniq[:limit], 'errors': errors, 'sources': [s for s, _ in FEEDS]}
    try:
        os.makedirs(DIR, exist_ok=True)
        json.dump(d, open(CACHE + '.tmp', 'w', encoding='utf-8'), ensure_ascii=False)
        os.replace(CACHE + '.tmp', CACHE)
    except Exception:
        pass
    return d


def weather(city=''):
    """One line from wttr.in (no key). City from me.json when known, else wttr.in's own IP location."""
    try:
        q = urllib.request.quote(city) if city else ''
        return (city + ': ' if city else '') + _fetch(f'https://wttr.in/{q}?format=%C+%t&m', ua='curl/8').decode('utf-8', 'ignore').strip()[:120]
    except Exception:
        return ''
